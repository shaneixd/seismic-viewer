/**
 * Colormap types for seismic visualization
 */
export type ColormapType = 'seismic' | 'grayscale' | 'viridis';

/**
 * RGB color tuple
 */
export type RGB = [number, number, number];

/**
 * Create a colormap lookup table (256 entries)
 */
export function createColormap(type: ColormapType): Uint8Array {
    const lut = new Uint8Array(256 * 3);

    for (let i = 0; i < 256; i++) {
        const t = i / 255; // 0 to 1
        let rgb: RGB;

        switch (type) {
            case 'seismic':
                rgb = seismicColormap(t);
                break;
            case 'grayscale':
                rgb = grayscaleColormap(t);
                break;
            case 'viridis':
                rgb = viridisColormap(t);
                break;
            default:
                rgb = seismicColormap(t);
        }

        lut[i * 3] = rgb[0];
        lut[i * 3 + 1] = rgb[1];
        lut[i * 3 + 2] = rgb[2];
    }

    return lut;
}

/**
 * Seismic colormap: Blue (negative) -> White (zero) -> Red (positive)
 */
function seismicColormap(t: number): RGB {
    // t: 0 = negative (blue), 0.5 = zero (white), 1 = positive (red)
    if (t < 0.5) {
        // Blue to white
        const s = t * 2;
        return [
            Math.round(s * 255),
            Math.round(s * 255),
            255
        ];
    } else {
        // White to red
        const s = (t - 0.5) * 2;
        return [
            255,
            Math.round((1 - s) * 255),
            Math.round((1 - s) * 255)
        ];
    }
}

/**
 * Grayscale colormap: Black to White
 */
function grayscaleColormap(t: number): RGB {
    const v = Math.round(t * 255);
    return [v, v, v];
}

/**
 * Viridis colormap (approximation)
 */
function viridisColormap(t: number): RGB {
    // Simplified viridis approximation
    const colors: RGB[] = [
        [68, 1, 84],
        [72, 35, 116],
        [64, 67, 135],
        [52, 94, 141],
        [41, 120, 142],
        [32, 144, 140],
        [34, 167, 132],
        [68, 190, 112],
        [121, 209, 81],
        [189, 222, 38],
        [253, 231, 37]
    ];

    const idx = t * (colors.length - 1);
    const i = Math.floor(idx);
    const f = idx - i;

    if (i >= colors.length - 1) {
        return colors[colors.length - 1];
    }

    const c1 = colors[i];
    const c2 = colors[i + 1];

    return [
        Math.round(c1[0] + f * (c2[0] - c1[0])),
        Math.round(c1[1] + f * (c2[1] - c1[1])),
        Math.round(c1[2] + f * (c2[2] - c1[2]))
    ];
}

/**
 * Apply colormap to a normalized value (-1 to 1) and return RGB
 */
export function applyColormap(value: number, colormap: Uint8Array): RGB {
    // Map from -1,1 to 0,255
    const idx = Math.floor(((value + 1) / 2) * 255);
    const clampedIdx = Math.max(0, Math.min(255, idx));

    return [
        colormap[clampedIdx * 3],
        colormap[clampedIdx * 3 + 1],
        colormap[clampedIdx * 3 + 2]
    ];
}
