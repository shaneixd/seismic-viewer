/**
 * Colormap types for seismic visualization
 */
import colormap from 'colormap';
import { COLORCET_DATA } from './colorcet_data';

/**
 * Colormap types for seismic visualization
 */
export const AVAILABLE_COLORMAPS = [
    'seismic',
    'STD - Red-Black-Blue',
    'STD - Blue-Black-Red',
    'STD - Roma',
    'STD - RomaO',
    'STD - Lajolla',
    'STD - Oleron',
    'STD - Batlow',
    'STD - Tokyo',
    'STD - Turku',
    'STD - Berlin',
    'viridis',
    'magma',
    'inferno',
    'plasma',
    'jet',
    'rainbow',
    'cool',
    'warm',
    'greys',
    'bone',
    'copper',
    // Colorcet maps
    'cc_fire',
    'cc_rainbow',
    'cc_isolum',
    'cc_gray',
    'cc_coolwarm',
    'cc_bgy',
    'cc_gwv',
    'cc_bkr',
    'cc_kb',
    'cc_kr'
] as const;

// Map display names to data keys or package names
const COLORMAP_ALIASES: Record<string, string> = {
    'STD - Red-Black-Blue': 'std_rnb', // Actually Red-Neutral-Blue
    'STD - Blue-Black-Red': 'std_blue_black_red',
    'STD - Roma': 'scm_roma',
    'STD - RomaO': 'scm_romao',
    'STD - Lajolla': 'scm_lajolla',
    'STD - Oleron': 'scm_oleron',
    'STD - Batlow': 'scm_batlow',
    'STD - Tokyo': 'scm_tokyo',
    'STD - Turku': 'scm_turku',
    'STD - Berlin': 'scm_berlin'
};

export type ColormapType = typeof AVAILABLE_COLORMAPS[number];

/**
 * RGB color tuple
 */
export type RGB = [number, number, number];

/**
 * Create a colormap lookup table (256 entries)
 */
export function createColormap(type: string): Uint8Array {
    // Check for alias (STD maps)
    const alias = COLORMAP_ALIASES[type];
    if (alias && COLORCET_DATA[alias]) {
        const data = COLORCET_DATA[alias];
        const lut = new Uint8Array(256 * 3);
        for (let i = 0; i < 256; i++) {
            const rgb = data[i];
            lut[i * 3] = rgb[0];
            lut[i * 3 + 1] = rgb[1];
            lut[i * 3 + 2] = rgb[2];
        }
        return lut;
    }

    // Check if it's a Colorcet map (direct key)
    if (type.startsWith('cc_') && COLORCET_DATA[type]) {
        const data = COLORCET_DATA[type];
        const lut = new Uint8Array(256 * 3);
        for (let i = 0; i < 256; i++) {
            const rgb = data[i];
            lut[i * 3] = rgb[0];
            lut[i * 3 + 1] = rgb[1];
            lut[i * 3 + 2] = rgb[2];
        }
        return lut;
    }

    // Check if it's a known colormap, default to 'seismic' (which might need special handling if not in package, 
    // but 'seismic' is usually 'rwb' or similar. usage in this app was blue-white-red)
    // The 'colormap' package has 'seismic' as an option? Let's check. 
    // If not, we map 'seismic' to 'bluered' or implement custom if needed.
    // Testing showed package has 'bluered', 'rdbu'. 
    // Our previous 'seismic' was Blue(neg)->White(0)->Red(pos). 
    // 'rdbu' is Red->Blue usually. 'bluered' is Blue->Red.

    let mapName = type;
    if (type === 'seismic') {
        // Use our custom blue-white-red implementation as it looks better than the package's default
        return createFallbackSeismic();
    }

    if (type === 'grayscale') {
        mapName = 'greys';
    }

    try {
        const colors = colormap({
            colormap: mapName,
            nshades: 256,
            format: 'rgba',
            alpha: 1
        });

        const lut = new Uint8Array(256 * 3);

        for (let i = 0; i < 256; i++) {
            const [r, g, b] = colors[i];
            lut[i * 3] = r;
            lut[i * 3 + 1] = g;
            lut[i * 3 + 2] = b;
        }
        return lut;
    } catch (e) {
        console.warn(`Colormap '${type}' not found, falling back to simple seismic.`);
        // Fallback or custom simple implementation if package fails
        return createFallbackSeismic();
    }
}

function createFallbackSeismic(): Uint8Array {
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        let rgb: RGB;
        if (t < 0.5) {
            const s = t * 2;
            rgb = [Math.round(s * 255), Math.round(s * 255), 255];
        } else {
            const s = (t - 0.5) * 2;
            rgb = [255, Math.round((1 - s) * 255), Math.round((1 - s) * 255)];
        }
        lut[i * 3] = rgb[0];
        lut[i * 3 + 1] = rgb[1];
        lut[i * 3 + 2] = rgb[2];
    }
    return lut;
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

/**
 * Apply colormap to an entire Float32Array and return RGBA Uint8Array
 */
export function applyColormapToArray(data: Float32Array, colormap: Uint8Array): Uint8Array {
    const result = new Uint8Array(data.length * 4);

    for (let i = 0; i < data.length; i++) {
        const value = data[i];
        // Map from -1,1 to 0,255
        const idx = Math.floor(((value + 1) / 2) * 255);
        const clampedIdx = Math.max(0, Math.min(255, idx));

        result[i * 4] = colormap[clampedIdx * 3];
        result[i * 4 + 1] = colormap[clampedIdx * 3 + 1];
        result[i * 4 + 2] = colormap[clampedIdx * 3 + 2];
        result[i * 4 + 3] = 255; // Alpha
    }

    return result;
}
