/**
 * Brick Manager for progressive loading of multi-resolution seismic data.
 * 
 * Loads coarse data first, then progressively refines to higher resolution
 * as the user explores the volume.
 */

interface BrickInfo {
  level: number;
  x: number;
  y: number;
  z: number;
  filename: string;
  byte_size: number;
}

interface LevelInfo {
  level: number;
  scale_factor: number;
  dimensions: [number, number, number];
  brick_size: [number, number, number];
  num_bricks: [number, number, number];
  total_bricks: number;
}

interface BrickManifest {
  version: string;
  original_dimensions: [number, number, number];
  brick_size: [number, number, number];
  num_levels: number;
  levels: LevelInfo[];
  bricks: BrickInfo[];
  total_size_bytes: number;
}

interface LoadedBrick {
  data: Float32Array;
  actualSize: [number, number, number];
  level: number;
  x: number;
  y: number;
  z: number;
}

type LoadingCallback = (progress: number, level: number) => void;

export class BrickManager {
  private manifest: BrickManifest | null = null;
  private basePath: string;
  private brickCache: Map<string, LoadedBrick> = new Map();
  private loadingPromises: Map<string, Promise<LoadedBrick>> = new Map();
  private onProgress: LoadingCallback | null = null;

  constructor(basePath: string = '/data/bricks') {
    this.basePath = basePath;
  }

  /**
   * Set progress callback for loading updates
   */
  setProgressCallback(callback: LoadingCallback): void {
    this.onProgress = callback;
  }

  /**
   * Load the manifest file describing the bricked volume
   */
  async loadManifest(): Promise<BrickManifest> {
    const response = await fetch(`${this.basePath}/manifest.json`);
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status}`);
    }
    this.manifest = await response.json();
    return this.manifest!;
  }

  /**
   * Get manifest (must call loadManifest first)
   */
  getManifest(): BrickManifest | null {
    return this.manifest;
  }

  /**
   * Get the dimensions at a specific level
   */
  getLevelDimensions(level: number): [number, number, number] | null {
    if (!this.manifest) return null;
    const levelInfo = this.manifest.levels.find(l => l.level === level);
    return levelInfo ? levelInfo.dimensions : null;
  }

  /**
   * Get original (full resolution) dimensions
   */
  getOriginalDimensions(): [number, number, number] | null {
    return this.manifest?.original_dimensions ?? null;
  }

  /**
   * Convert original coordinates to level coordinates
   */
  originalToLevelCoords(
    x: number, y: number, z: number,
    level: number
  ): [number, number, number] {
    const factor = Math.pow(2, level);
    return [
      Math.floor(x / factor),
      Math.floor(y / factor),
      Math.floor(z / factor)
    ];
  }

  /**
   * Find which brick contains a given position at a level
   */
  getBrickForPosition(
    x: number, y: number, z: number,
    _level: number
  ): { bx: number; by: number; bz: number } | null {
    if (!this.manifest) return null;

    const [brickSizeX, brickSizeY, brickSizeZ] = this.manifest.brick_size;

    return {
      bx: Math.floor(x / brickSizeX),
      by: Math.floor(y / brickSizeY),
      bz: Math.floor(z / brickSizeZ)
    };
  }

  /**
   * Generate cache key for a brick
   */
  private getBrickKey(level: number, x: number, y: number, z: number): string {
    return `${level}_${x}_${y}_${z}`;
  }

  /**
   * Load a single brick
   */
  async loadBrick(level: number, x: number, y: number, z: number): Promise<LoadedBrick> {
    const key = this.getBrickKey(level, x, y, z);

    // Return cached brick
    if (this.brickCache.has(key)) {
      return this.brickCache.get(key)!;
    }

    // Return in-progress promise
    if (this.loadingPromises.has(key)) {
      return this.loadingPromises.get(key)!;
    }

    // Start loading
    const promise = this.fetchBrick(level, x, y, z);
    this.loadingPromises.set(key, promise);

    try {
      const brick = await promise;
      this.brickCache.set(key, brick);
      return brick;
    } finally {
      this.loadingPromises.delete(key);
    }
  }

  /**
   * Fetch brick data from server
   */
  private async fetchBrick(level: number, x: number, y: number, z: number): Promise<LoadedBrick> {
    const filename = `level_${level}/brick_${x}_${y}_${z}.bin`;
    const response = await fetch(`${this.basePath}/${filename}`);

    if (!response.ok) {
      throw new Error(`Failed to load brick ${filename}: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();

    // Parse header (3 x int32 = 12 bytes for actual dimensions)
    const header = new DataView(buffer);
    const actualSizeX = header.getInt32(0, true);
    const actualSizeY = header.getInt32(4, true);
    const actualSizeZ = header.getInt32(8, true);

    // Extract float data
    const data = new Float32Array(buffer, 12);

    return {
      data,
      actualSize: [actualSizeX, actualSizeY, actualSizeZ],
      level,
      x,
      y,
      z
    };
  }

  /**
   * Load all bricks for a given level (for coarse overview)
   */
  async loadLevel(level: number): Promise<LoadedBrick[]> {
    if (!this.manifest) {
      throw new Error('Manifest not loaded');
    }

    const levelInfo = this.manifest.levels.find(l => l.level === level);
    if (!levelInfo) {
      throw new Error(`Level ${level} not found`);
    }

    const bricks: LoadedBrick[] = [];
    const [numX, numY, numZ] = levelInfo.num_bricks;
    const totalBricks = numX * numY * numZ;
    let loaded = 0;

    for (let x = 0; x < numX; x++) {
      for (let y = 0; y < numY; y++) {
        for (let z = 0; z < numZ; z++) {
          const brick = await this.loadBrick(level, x, y, z);
          bricks.push(brick);
          loaded++;

          if (this.onProgress) {
            this.onProgress(loaded / totalBricks, level);
          }
        }
      }
    }

    return bricks;
  }

  /**
   * Get a slice of data across bricks at a specific level.
   * Returns a 2D Float32Array for the slice.
   * For inline slice: width = crossline (ny), height = time (nz) - time is vertical
   */
  async getInlineSlice(
    inlineIdx: number,
    level: number
  ): Promise<{ data: Float32Array; width: number; height: number }> {
    if (!this.manifest) {
      throw new Error('Manifest not loaded');
    }

    const levelInfo = this.manifest.levels.find(l => l.level === level);
    if (!levelInfo) {
      throw new Error(`Level ${level} not found`);
    }

    const [_nx, ny, nz] = levelInfo.dimensions;
    const [brickSizeX, brickSizeY, brickSizeZ] = this.manifest.brick_size;

    // Which brick row contains this inline?
    const brickX = Math.floor(inlineIdx / brickSizeX);
    const localX = inlineIdx % brickSizeX;

    // Result: width = crossline (ny), height = time (nz)
    const result = new Float32Array(ny * nz);
    const [_numBricksX, numBricksY, numBricksZ] = levelInfo.num_bricks;

    // Load all bricks in this inline plane
    for (let by = 0; by < numBricksY; by++) {
      for (let bz = 0; bz < numBricksZ; bz++) {
        const brick = await this.loadBrick(level, brickX, by, bz);
        const [actualX, actualY, actualZ] = brick.actualSize;

        if (localX >= actualX) continue; // This brick doesn't contain our inline

        // Copy relevant data from brick to result
        // Result is indexed as [time * width + crossline] so time is vertical
        for (let ly = 0; ly < actualY; ly++) {
          for (let lz = 0; lz < actualZ; lz++) {
            const globalY = by * brickSizeY + ly;
            const globalZ = bz * brickSizeZ + lz;

            if (globalY >= ny || globalZ >= nz) continue;

            // Brick data indexing: x-major (same as original volume)
            const brickIdx = localX * brickSizeY * brickSizeZ + ly * brickSizeZ + lz;
            // Result index: row = time (z), col = crossline (y)
            const resultIdx = globalZ * ny + globalY;

            result[resultIdx] = brick.data[brickIdx];
          }
        }
      }
    }

    return { data: result, width: ny, height: nz };
  }

  /**
   * Get a crossline slice
   * For crossline slice: width = inline (nx), height = time (nz) - time is vertical
   */
  async getCrosslineSlice(
    crosslineIdx: number,
    level: number
  ): Promise<{ data: Float32Array; width: number; height: number }> {
    if (!this.manifest) {
      throw new Error('Manifest not loaded');
    }

    const levelInfo = this.manifest.levels.find(l => l.level === level);
    if (!levelInfo) {
      throw new Error(`Level ${level} not found`);
    }

    const [nx, _ny, nz] = levelInfo.dimensions;
    const [brickSizeX, brickSizeY, brickSizeZ] = this.manifest.brick_size;

    const brickY = Math.floor(crosslineIdx / brickSizeY);
    const localY = crosslineIdx % brickSizeY;

    // Result: width = inline (nx), height = time (nz)
    const result = new Float32Array(nx * nz);
    const [numBricksX, _numBricksY, numBricksZ] = levelInfo.num_bricks;

    for (let bx = 0; bx < numBricksX; bx++) {
      for (let bz = 0; bz < numBricksZ; bz++) {
        const brick = await this.loadBrick(level, bx, brickY, bz);
        const [actualX, actualY, actualZ] = brick.actualSize;

        if (localY >= actualY) continue;

        for (let lx = 0; lx < actualX; lx++) {
          for (let lz = 0; lz < actualZ; lz++) {
            const globalX = bx * brickSizeX + lx;
            const globalZ = bz * brickSizeZ + lz;

            if (globalX >= nx || globalZ >= nz) continue;

            const brickIdx = lx * brickSizeY * brickSizeZ + localY * brickSizeZ + lz;
            // Result index: row = time (z), col = inline (x)
            const resultIdx = globalZ * nx + globalX;

            result[resultIdx] = brick.data[brickIdx];
          }
        }
      }
    }

    return { data: result, width: nx, height: nz };
  }

  /**
   * Get a time (depth) slice
   */
  async getTimeSlice(
    timeIdx: number,
    level: number
  ): Promise<{ data: Float32Array; width: number; height: number }> {
    if (!this.manifest) {
      throw new Error('Manifest not loaded');
    }

    const levelInfo = this.manifest.levels.find(l => l.level === level);
    if (!levelInfo) {
      throw new Error(`Level ${level} not found`);
    }

    const [nx, ny, _nz] = levelInfo.dimensions;
    const [brickSizeX, brickSizeY, brickSizeZ] = this.manifest.brick_size;

    const brickZ = Math.floor(timeIdx / brickSizeZ);
    const localZ = timeIdx % brickSizeZ;

    const result = new Float32Array(nx * ny);
    const [numBricksX, numBricksY, _numBricksZ] = levelInfo.num_bricks;

    for (let bx = 0; bx < numBricksX; bx++) {
      for (let by = 0; by < numBricksY; by++) {
        const brick = await this.loadBrick(level, bx, by, brickZ);
        const [actualX, actualY, actualZ] = brick.actualSize;

        if (localZ >= actualZ) continue;

        for (let lx = 0; lx < actualX; lx++) {
          for (let ly = 0; ly < actualY; ly++) {
            const globalX = bx * brickSizeX + lx;
            const globalY = by * brickSizeY + ly;

            if (globalX >= nx || globalY >= ny) continue;

            const brickIdx = lx * brickSizeY * brickSizeZ + ly * brickSizeZ + localZ;
            const resultIdx = globalX * ny + globalY;

            result[resultIdx] = brick.data[brickIdx];
          }
        }
      }
    }

    return { data: result, width: ny, height: nx };
  }

  /**
   * Clear the brick cache
   */
  clearCache(): void {
    this.brickCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { numBricks: number; estimatedSizeMB: number } {
    let totalSize = 0;
    for (const brick of this.brickCache.values()) {
      totalSize += brick.data.byteLength;
    }
    return {
      numBricks: this.brickCache.size,
      estimatedSizeMB: totalSize / 1024 / 1024
    };
  }
}
