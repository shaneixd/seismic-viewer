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

/**
 * Generate N colors that contrast maximally with the given colormap LUT.
 * 
 * Algorithm:
 * 1. Sample the LUT, convert each RGB to HSL
 * 2. Skip near-achromatic colors (low saturation grays/whites/blacks)
 * 3. Build a histogram of hue usage on the 0-360° color wheel
 * 4. Find the largest "gap" arcs where no colormap hues exist
 * 5. Place N well colors evenly within those gaps
 * 6. Use high saturation (85%) and medium-high lightness (55%) for visibility
 */
export function generateContrastColors(lut: Uint8Array, count: number): string[] {
    // Step 1: Sample the LUT and extract hues
    const hues: number[] = [];
    const step = Math.max(1, Math.floor(256 / 32)); // Sample ~32 points

    for (let i = 0; i < 256; i += step) {
        const r = lut[i * 3] / 255;
        const g = lut[i * 3 + 1] / 255;
        const b = lut[i * 3 + 2] / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        const lightness = (max + min) / 2;
        const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

        // Skip achromatic colors (grays, whites, blacks) — they occupy no hue
        if (saturation < 0.15 || lightness < 0.08 || lightness > 0.92) continue;

        let hue = 0;
        if (delta !== 0) {
            if (max === r) hue = ((g - b) / delta) % 6;
            else if (max === g) hue = (b - r) / delta + 2;
            else hue = (r - g) / delta + 4;
            hue = ((hue * 60) + 360) % 360;
        }
        hues.push(hue);
    }

    // Step 2: If colormap is fully achromatic (e.g., greys), use a default spread
    if (hues.length === 0) {
        return generateEvenlySpacedColors(count, 0);
    }

    // Step 3: Sort hues and find gaps on the circular color wheel
    hues.sort((a, b) => a - b);

    interface Gap { start: number; end: number; size: number; center: number }
    const gaps: Gap[] = [];

    for (let i = 0; i < hues.length - 1; i++) {
        const gapSize = hues[i + 1] - hues[i];
        if (gapSize > 10) { // Minimum meaningful gap
            gaps.push({
                start: hues[i],
                end: hues[i + 1],
                size: gapSize,
                center: hues[i] + gapSize / 2
            });
        }
    }

    // Wrap-around gap (last hue to first hue through 360°)
    const wrapGap = (360 - hues[hues.length - 1]) + hues[0];
    if (wrapGap > 10) {
        const center = (hues[hues.length - 1] + wrapGap / 2) % 360;
        gaps.push({
            start: hues[hues.length - 1],
            end: hues[0] + 360,
            size: wrapGap,
            center
        });
    }

    // Sort gaps by size, largest first
    gaps.sort((a, b) => b.size - a.size);

    // Step 4: Distribute colors across the largest gaps
    const colors: string[] = [];
    let remaining = count;
    let gapIdx = 0;

    while (remaining > 0 && gapIdx < gaps.length) {
        const gap = gaps[gapIdx];
        // Allocate colors proportional to gap size, at least 1
        const allocate = Math.min(remaining, Math.max(1, Math.ceil(count * gap.size / 360)));

        for (let i = 0; i < allocate && remaining > 0; i++) {
            // Spread evenly within the gap with padding from edges
            const padding = gap.size * 0.15;
            const usableSize = gap.size - 2 * padding;
            const hue = allocate === 1
                ? gap.center
                : (gap.start + padding + (usableSize * i / (allocate - 1))) % 360;

            colors.push(hslToHex(hue, 85, 55));
            remaining--;
        }
        gapIdx++;
    }

    // If we still need more (very unlikely), fill with evenly spaced starting from the largest gap
    while (colors.length < count) {
        const offset = gaps.length > 0 ? gaps[0].center : 0;
        const hue = (offset + (colors.length * 137.508)) % 360; // Golden angle
        colors.push(hslToHex(hue, 85, 55));
    }

    return colors;
}

/**
 * Generate N evenly-spaced colors starting from a given hue offset.
 */
function generateEvenlySpacedColors(count: number, startHue: number): string[] {
    const colors: string[] = [];
    for (let i = 0; i < count; i++) {
        const hue = (startHue + (i * 360 / count)) % 360;
        colors.push(hslToHex(hue, 85, 55));
    }
    return colors;
}

/**
 * Convert HSL (h: 0-360, s: 0-100, l: 0-100) to hex color string.
 */
function hslToHex(h: number, s: number, l: number): string {
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    const toHex = (v: number) => {
        const hex = Math.round((v + m) * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
