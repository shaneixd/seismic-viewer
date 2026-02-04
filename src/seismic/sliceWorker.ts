/**
 * Slice Extraction Web Worker
 * 
 * Handles slice extraction from brick data and colormap application
 * in a background thread to keep the main thread responsive.
 */

interface BrickData {
    data: Float32Array;
    actualSize: [number, number, number];
}

interface ExtractSliceMessage {
    type: 'extractSlice';
    sliceType: 'inline' | 'crossline' | 'time';
    sliceIndex: number;
    level: number;
    levelDimensions: [number, number, number];
    brickSize: [number, number, number];
    numBricks: [number, number, number];
    bricks: { key: string; data: ArrayBuffer; actualSize: [number, number, number] }[];
    colormap: Uint8Array;
}

interface SliceResultMessage {
    type: 'sliceResult';
    sliceType: 'inline' | 'crossline' | 'time';
    sliceIndex: number;
    level: number;
    rgbaData: Uint8ClampedArray;
    width: number;
    height: number;
}

// Apply colormap to a value
function applyColormap(value: number, colormap: Uint8Array): [number, number, number, number] {
    // Map from -1,1 to 0,255
    const idx = Math.floor(((value + 1) / 2) * 255);
    const clampedIdx = Math.max(0, Math.min(255, idx));

    return [
        colormap[clampedIdx * 3],
        colormap[clampedIdx * 3 + 1],
        colormap[clampedIdx * 3 + 2],
        255 // Alpha
    ];
}

function extractInlineSlice(
    inlineIdx: number,
    _nx: number, ny: number, nz: number,
    brickSizeX: number, brickSizeY: number, brickSizeZ: number,
    _numBricksX: number, numBricksY: number, numBricksZ: number,
    bricks: Map<string, BrickData>,
    colormap: Uint8Array
): { rgbaData: Uint8ClampedArray; width: number; height: number } {
    // Result: width = crossline (ny), height = time (nz)
    const width = ny;
    const height = nz;
    const rgbaData = new Uint8ClampedArray(width * height * 4);

    const brickX = Math.floor(inlineIdx / brickSizeX);
    const localX = inlineIdx % brickSizeX;

    for (let by = 0; by < numBricksY; by++) {
        for (let bz = 0; bz < numBricksZ; bz++) {
            const key = `${brickX}_${by}_${bz}`;
            const brick = bricks.get(key);
            if (!brick) continue;

            const [actualX, actualY, actualZ] = brick.actualSize;
            if (localX >= actualX) continue;

            for (let ly = 0; ly < actualY; ly++) {
                for (let lz = 0; lz < actualZ; lz++) {
                    const globalY = by * brickSizeY + ly;
                    const globalZ = bz * brickSizeZ + lz;

                    if (globalY >= ny || globalZ >= nz) continue;

                    const brickIdx = localX * brickSizeY * brickSizeZ + ly * brickSizeZ + lz;
                    const value = brick.data[brickIdx];

                    // Result index: row = time (z), col = crossline (y)
                    const resultIdx = (globalZ * width + globalY) * 4;
                    const [r, g, b, a] = applyColormap(value, colormap);
                    rgbaData[resultIdx] = r;
                    rgbaData[resultIdx + 1] = g;
                    rgbaData[resultIdx + 2] = b;
                    rgbaData[resultIdx + 3] = a;
                }
            }
        }
    }

    return { rgbaData, width, height };
}

function extractCrosslineSlice(
    crosslineIdx: number,
    nx: number, _ny: number, nz: number,
    brickSizeX: number, brickSizeY: number, brickSizeZ: number,
    numBricksX: number, _numBricksY: number, numBricksZ: number,
    bricks: Map<string, BrickData>,
    colormap: Uint8Array
): { rgbaData: Uint8ClampedArray; width: number; height: number } {
    // Result: width = inline (nx), height = time (nz)
    const width = nx;
    const height = nz;
    const rgbaData = new Uint8ClampedArray(width * height * 4);

    const brickY = Math.floor(crosslineIdx / brickSizeY);
    const localY = crosslineIdx % brickSizeY;

    for (let bx = 0; bx < numBricksX; bx++) {
        for (let bz = 0; bz < numBricksZ; bz++) {
            const key = `${bx}_${brickY}_${bz}`;
            const brick = bricks.get(key);
            if (!brick) continue;

            const [actualX, actualY, actualZ] = brick.actualSize;
            if (localY >= actualY) continue;

            for (let lx = 0; lx < actualX; lx++) {
                for (let lz = 0; lz < actualZ; lz++) {
                    const globalX = bx * brickSizeX + lx;
                    const globalZ = bz * brickSizeZ + lz;

                    if (globalX >= nx || globalZ >= nz) continue;

                    const brickIdx = lx * brickSizeY * brickSizeZ + localY * brickSizeZ + lz;
                    const value = brick.data[brickIdx];

                    // Result index: row = time (z), col = inline (x)
                    const resultIdx = (globalZ * width + globalX) * 4;
                    const [r, g, b, a] = applyColormap(value, colormap);
                    rgbaData[resultIdx] = r;
                    rgbaData[resultIdx + 1] = g;
                    rgbaData[resultIdx + 2] = b;
                    rgbaData[resultIdx + 3] = a;
                }
            }
        }
    }

    return { rgbaData, width, height };
}

function extractTimeSlice(
    timeIdx: number,
    nx: number, ny: number, _nz: number,
    brickSizeX: number, brickSizeY: number, brickSizeZ: number,
    numBricksX: number, numBricksY: number, _numBricksZ: number,
    bricks: Map<string, BrickData>,
    colormap: Uint8Array
): { rgbaData: Uint8ClampedArray; width: number; height: number } {
    // Result: width = inline (nx), height = crossline (ny)
    const width = nx;
    const height = ny;
    const rgbaData = new Uint8ClampedArray(width * height * 4);

    const brickZ = Math.floor(timeIdx / brickSizeZ);
    const localZ = timeIdx % brickSizeZ;

    for (let bx = 0; bx < numBricksX; bx++) {
        for (let by = 0; by < numBricksY; by++) {
            const key = `${bx}_${by}_${brickZ}`;
            const brick = bricks.get(key);
            if (!brick) continue;

            const [actualX, actualY, actualZ] = brick.actualSize;
            if (localZ >= actualZ) continue;

            for (let lx = 0; lx < actualX; lx++) {
                for (let ly = 0; ly < actualY; ly++) {
                    const globalX = bx * brickSizeX + lx;
                    const globalY = by * brickSizeY + ly;

                    if (globalX >= nx || globalY >= ny) continue;

                    const brickIdx = lx * brickSizeY * brickSizeZ + ly * brickSizeZ + localZ;
                    const value = brick.data[brickIdx];

                    const resultIdx = (globalY * width + globalX) * 4;
                    const [r, g, b, a] = applyColormap(value, colormap);
                    rgbaData[resultIdx] = r;
                    rgbaData[resultIdx + 1] = g;
                    rgbaData[resultIdx + 2] = b;
                    rgbaData[resultIdx + 3] = a;
                }
            }
        }
    }

    return { rgbaData, width, height };
}

// Handle messages from main thread
self.onmessage = (e: MessageEvent<ExtractSliceMessage>) => {
    const msg = e.data;

    if (msg.type !== 'extractSlice') return;

    // Convert brick data from ArrayBuffers to Float32Arrays
    const bricks = new Map<string, BrickData>();
    for (const brick of msg.bricks) {
        bricks.set(brick.key, {
            data: new Float32Array(brick.data),
            actualSize: brick.actualSize
        });
    }

    const [nx, ny, nz] = msg.levelDimensions;
    const [brickSizeX, brickSizeY, brickSizeZ] = msg.brickSize;
    const [numBricksX, numBricksY, numBricksZ] = msg.numBricks;

    let result: { rgbaData: Uint8ClampedArray; width: number; height: number };

    switch (msg.sliceType) {
        case 'inline':
            result = extractInlineSlice(
                msg.sliceIndex, nx, ny, nz,
                brickSizeX, brickSizeY, brickSizeZ,
                numBricksX, numBricksY, numBricksZ,
                bricks, msg.colormap
            );
            break;
        case 'crossline':
            result = extractCrosslineSlice(
                msg.sliceIndex, nx, ny, nz,
                brickSizeX, brickSizeY, brickSizeZ,
                numBricksX, numBricksY, numBricksZ,
                bricks, msg.colormap
            );
            break;
        case 'time':
            result = extractTimeSlice(
                msg.sliceIndex, nx, ny, nz,
                brickSizeX, brickSizeY, brickSizeZ,
                numBricksX, numBricksY, numBricksZ,
                bricks, msg.colormap
            );
            break;
        default:
            return;
    }

    const response: SliceResultMessage = {
        type: 'sliceResult',
        sliceType: msg.sliceType,
        sliceIndex: msg.sliceIndex,
        level: msg.level,
        rgbaData: result.rgbaData,
        width: result.width,
        height: result.height
    };

    // Transfer the buffer to avoid copying
    (self as unknown as Worker).postMessage(response, [result.rgbaData.buffer]);
};

// Signal that worker is ready
self.postMessage({ type: 'ready' });

export { }; // Make this a module
