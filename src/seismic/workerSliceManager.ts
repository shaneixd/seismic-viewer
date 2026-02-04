/**
 * Worker Slice Manager
 * 
 * Manages the Web Worker for off-main-thread slice extraction.
 * Handles brick fetching, worker communication, and prefetching.
 */

import type { BrickManifest, BrickManager } from './brickManager';

export interface SliceResult {
    rgbaData: Uint8ClampedArray;
    width: number;
    height: number;
}

interface PendingRequest {
    resolve: (result: SliceResult) => void;
    reject: (error: Error) => void;
}

export class WorkerSliceManager {
    private worker: Worker | null = null;
    private brickManager: BrickManager;
    private colormap: Uint8Array;
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private readyPromise: Promise<void>;
    private readyResolve!: () => void;

    // Prefetch state
    private prefetchQueue: Array<{ type: 'inline' | 'crossline' | 'time'; index: number; level: number }> = [];
    private prefetchCache: Map<string, SliceResult> = new Map();
    private maxCacheSize = 20; // Keep last 20 slices
    private isPrefetching = false;

    constructor(brickManager: BrickManager, colormap: Uint8Array) {
        this.brickManager = brickManager;
        this.colormap = colormap;

        this.readyPromise = new Promise((resolve) => {
            this.readyResolve = resolve;
        });

        this.initWorker();
    }

    private initWorker(): void {
        // Create worker from the sliceWorker.ts file
        this.worker = new Worker(
            new URL('./sliceWorker.ts', import.meta.url),
            { type: 'module' }
        );

        this.worker.onmessage = (e) => {
            const msg = e.data;

            if (msg.type === 'ready') {
                // Worker is ready
                this.readyResolve();
                console.log('[Worker] Slice worker ready');
                return;
            }

            if (msg.type === 'sliceResult') {
                const key = `${msg.sliceType}_${msg.sliceIndex}_${msg.level}`;
                const pending = this.pendingRequests.get(key);

                if (pending) {
                    pending.resolve({
                        rgbaData: msg.rgbaData,
                        width: msg.width,
                        height: msg.height
                    });
                    this.pendingRequests.delete(key);
                }

                // Also cache the result
                this.cacheResult(key, {
                    rgbaData: msg.rgbaData,
                    width: msg.width,
                    height: msg.height
                });
            }
        };

        this.worker.onerror = (e) => {
            console.error('[Worker] Error:', e);
        };
    }

    private cacheResult(key: string, result: SliceResult): void {
        // Add to cache
        this.prefetchCache.set(key, result);

        // Evict oldest if over limit
        if (this.prefetchCache.size > this.maxCacheSize) {
            const firstKey = this.prefetchCache.keys().next().value;
            if (firstKey) {
                this.prefetchCache.delete(firstKey);
            }
        }
    }

    async waitForReady(): Promise<void> {
        return this.readyPromise;
    }

    /**
     * Get a slice, using cache if available, otherwise extracting via worker
     */
    async getSlice(
        type: 'inline' | 'crossline' | 'time',
        index: number,
        level: number
    ): Promise<SliceResult> {
        const key = `${type}_${index}_${level}`;

        // Check cache first
        const cached = this.prefetchCache.get(key);
        if (cached) {
            console.log(`[Worker] Cache hit: ${key}`);
            return cached;
        }

        // Extract via worker
        return this.extractSlice(type, index, level);
    }

    /**
     * Extract a slice using the Web Worker
     */
    private async extractSlice(
        type: 'inline' | 'crossline' | 'time',
        index: number,
        level: number
    ): Promise<SliceResult> {
        if (!this.worker) {
            throw new Error('Worker not initialized');
        }

        await this.waitForReady();

        const manifest = this.brickManager.getManifest();
        if (!manifest) {
            throw new Error('Manifest not loaded');
        }

        const levelInfo = manifest.levels.find((l: { level: number }) => l.level === level);
        if (!levelInfo) {
            throw new Error(`Level ${level} not found`);
        }

        // Collect the bricks needed for this slice
        const bricks = await this.collectBricksForSlice(type, index, level, manifest);

        // Create the request key
        const key = `${type}_${index}_${level}`;

        // Create promise for the result
        const resultPromise = new Promise<SliceResult>((resolve, reject) => {
            this.pendingRequests.set(key, { resolve, reject });
        });

        // Send to worker
        const message = {
            type: 'extractSlice' as const,
            sliceType: type,
            sliceIndex: index,
            level,
            levelDimensions: levelInfo.dimensions as [number, number, number],
            brickSize: manifest.brick_size as [number, number, number],
            numBricks: levelInfo.num_bricks as [number, number, number],
            bricks,
            colormap: this.colormap
        };

        // Transfer brick ArrayBuffers for zero-copy transfer
        const transfers = bricks.map(b => b.data);
        this.worker.postMessage(message, transfers);

        return resultPromise;
    }

    /**
     * Collect brick data needed for a slice
     */
    private async collectBricksForSlice(
        type: 'inline' | 'crossline' | 'time',
        index: number,
        level: number,
        manifest: BrickManifest
    ): Promise<Array<{ key: string; data: ArrayBuffer; actualSize: [number, number, number] }>> {
        const levelInfo = manifest.levels.find((l: { level: number }) => l.level === level);
        if (!levelInfo) return [];

        const [brickSizeX, brickSizeY, brickSizeZ] = manifest.brick_size;
        const [numBricksX, numBricksY, numBricksZ] = levelInfo.num_bricks;

        const bricks: Array<{ key: string; data: ArrayBuffer; actualSize: [number, number, number] }> = [];

        switch (type) {
            case 'inline': {
                const brickX = Math.floor(index / brickSizeX);
                for (let by = 0; by < numBricksY; by++) {
                    for (let bz = 0; bz < numBricksZ; bz++) {
                        const brick = await this.brickManager.loadBrick(level, brickX, by, bz);
                        const key = `${brickX}_${by}_${bz}`;
                        // Clone the data since we'll transfer it
                        const dataCopy = brick.data.slice().buffer;
                        bricks.push({ key, data: dataCopy, actualSize: brick.actualSize });
                    }
                }
                break;
            }
            case 'crossline': {
                const brickY = Math.floor(index / brickSizeY);
                for (let bx = 0; bx < numBricksX; bx++) {
                    for (let bz = 0; bz < numBricksZ; bz++) {
                        const brick = await this.brickManager.loadBrick(level, bx, brickY, bz);
                        const key = `${bx}_${brickY}_${bz}`;
                        const dataCopy = brick.data.slice().buffer;
                        bricks.push({ key, data: dataCopy, actualSize: brick.actualSize });
                    }
                }
                break;
            }
            case 'time': {
                const brickZ = Math.floor(index / brickSizeZ);
                for (let bx = 0; bx < numBricksX; bx++) {
                    for (let by = 0; by < numBricksY; by++) {
                        const brick = await this.brickManager.loadBrick(level, bx, by, brickZ);
                        const key = `${bx}_${by}_${brickZ}`;
                        const dataCopy = brick.data.slice().buffer;
                        bricks.push({ key, data: dataCopy, actualSize: brick.actualSize });
                    }
                }
                break;
            }
        }

        return bricks;
    }

    /**
     * Schedule prefetching for adjacent slices
     */
    prefetchAdjacent(
        type: 'inline' | 'crossline' | 'time',
        currentIndex: number,
        level: number,
        maxIndex: number
    ): void {
        const offsets = [-2, -1, 1, 2];

        for (const offset of offsets) {
            const index = currentIndex + offset;
            if (index < 0 || index >= maxIndex) continue;

            const key = `${type}_${index}_${level}`;
            if (this.prefetchCache.has(key)) continue; // Already cached
            if (this.pendingRequests.has(key)) continue; // Already loading

            this.prefetchQueue.push({ type, index, level });
        }

        this.processPrefetchQueue();
    }

    private async processPrefetchQueue(): Promise<void> {
        if (this.isPrefetching || this.prefetchQueue.length === 0) return;

        this.isPrefetching = true;

        while (this.prefetchQueue.length > 0) {
            const item = this.prefetchQueue.shift();
            if (!item) break;

            const key = `${item.type}_${item.index}_${item.level}`;
            if (this.prefetchCache.has(key)) continue;

            try {
                await this.extractSlice(item.type, item.index, item.level);
                console.log(`[Worker] Prefetched: ${key}`);
            } catch (err) {
                console.warn(`[Worker] Prefetch failed: ${key}`, err);
            }
        }

        this.isPrefetching = false;
    }

    /**
     * Update colormap for future extractions
     */
    setColormap(colormap: Uint8Array): void {
        this.colormap = colormap;
        // Clear cache since colors will change
        this.prefetchCache.clear();
        this.prefetchQueue = [];
    }

    /**
     * Clear cache for a specific level
     */
    clearLevelCache(level: number): void {
        for (const key of this.prefetchCache.keys()) {
            if (key.endsWith(`_${level}`)) {
                this.prefetchCache.delete(key);
            }
        }
    }

    /**
     * Dispose of the worker
     */
    dispose(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.prefetchCache.clear();
        this.prefetchQueue = [];
        this.pendingRequests.clear();
    }
}
