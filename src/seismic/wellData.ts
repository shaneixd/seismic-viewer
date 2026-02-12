/**
 * Well data types and loader for F3 Netherlands wells.
 * Data sourced from NLOG (Netherlands Oil and Gas Portal).
 */

export interface WellTrajectoryPoint {
    md: number;       // Measured depth (m)
    tvdss: number;    // True vertical depth subsea (m)
    il: number;       // Inline position
    xl: number;       // Crossline position
}

export interface WellFormation {
    name: string;     // Formation name
    code: string;     // Stratigraphic code
    top_md: number;
    top_tvdss: number;
    bottom_md: number;
    bottom_tvdss: number;
    color: string;    // Hex color
}

export interface WellLogCurve {
    name: string;        // e.g. "GR", "DT", "RHOB"
    unit: string;        // e.g. "gAPI", "us/ft", "g/cc"
    description: string; // e.g. "Gamma Ray"
    data: number[];      // values at each depth sample
    min: number;         // precomputed range
    max: number;
}

export interface WellLogData {
    wellName: string;
    depthUnit: string;   // "m" or "ft"
    depths: number[];    // MD values for each sample
    tvdss: number[];     // TVDSS values for each sample
    curves: WellLogCurve[];
}

export interface WellLogDataset {
    wells: WellLogData[];
}

export interface WellData {
    name: string;
    nlog_id: string;
    color: string;
    surface_il: number;
    surface_xl: number;
    surface_x_utm: number;
    surface_y_utm: number;
    kb_elevation_m: number;
    td_md: number;
    td_tvdss: number;
    trajectory: WellTrajectoryPoint[];
    formations: WellFormation[];
    logs?: WellLogData;  // Optional well log data
}

export interface WellDataset {
    survey: {
        name: string;
        il_range: [number, number];
        xl_range: [number, number];
        time_range_ms: [number, number];
        bin_size_m: number;
        sample_interval_ms: number;
    };
    grid_transform: {
        origin_x: number;
        origin_y: number;
        il_vec: [number, number];
        xl_vec: [number, number];
        crs: string;
    };
    wells: WellData[];
}

/**
 * Load well data from JSON file.
 */
export async function loadWellData(url: string): Promise<WellDataset | null> {
    try {
        const response = await fetch(url);

        // Check for HTML response (Vite returns HTML for missing files)
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
            console.warn(`Well data not found at ${url}`);
            return null;
        }

        if (!response.ok) {
            console.warn(`Failed to load well data: ${response.status}`);
            return null;
        }

        const data: WellDataset = await response.json();
        console.log(`Loaded ${data.wells.length} wells from ${url}`);
        return data;
    } catch (error) {
        console.warn('Error loading well data:', error);
        return null;
    }
}

/**
 * Load well log data from JSON file and merge into well data.
 */
export async function loadWellLogData(url: string): Promise<WellLogDataset | null> {
    try {
        const response = await fetch(url);

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
            console.warn(`Well log data not found at ${url}`);
            return null;
        }

        if (!response.ok) {
            console.warn(`Failed to load well log data: ${response.status}`);
            return null;
        }

        const data: WellLogDataset = await response.json();
        console.log(`Loaded log data for ${data.wells.length} wells from ${url}`);
        return data;
    } catch (error) {
        console.warn('Error loading well log data:', error);
        return null;
    }
}

/**
 * Merge log data into well data by matching well names.
 */
export function mergeLogData(wells: WellData[], logDataset: WellLogDataset): void {
    for (const logData of logDataset.wells) {
        const well = wells.find(w => w.name === logData.wellName);
        if (well) {
            well.logs = logData;
            console.log(`  Merged ${logData.curves.length} log curves into ${well.name}`);
        }
    }
}

/**
 * Check if a well position is within the loaded volume bounds.
 * 
 * @param well The well to check
 * @param volumeIlRange [start, end] inline range of loaded volume
 * @param volumeXlRange [start, end] crossline range of loaded volume 
 */
export function isWellInVolume(
    well: WellData,
    volumeIlRange: [number, number],
    volumeXlRange: [number, number]
): boolean {
    return (
        well.surface_il >= volumeIlRange[0] &&
        well.surface_il <= volumeIlRange[1] &&
        well.surface_xl >= volumeXlRange[0] &&
        well.surface_xl <= volumeXlRange[1]
    );
}
