/**
 * Well Field data types and JSON loader.
 * Represents wells with 3D trajectories, casing programs, and drilling events.
 */

export interface WellFieldTrajectoryPoint {
    md: number;          // Measured depth (m)
    tvd: number;         // True vertical depth (m) — positive downward from KB
    northing: number;    // Meters from field center (N+)
    easting: number;     // Meters from field center (E+)
    inclination: number; // Degrees from vertical
    azimuth: number;     // Degrees from north
}

export interface CasingString {
    name: string;        // "Conductor", "Surface", "Intermediate", "Production"
    od_inches: number;   // Outer diameter
    shoe_md: number;     // Casing shoe measured depth (m)
    shoe_tvd: number;    // Casing shoe true vertical depth (m)
    color: string;       // Hex color for rendering
}

export interface DrillingEvent {
    md: number;          // Measured depth where event occurred
    tvd: number;         // True vertical depth
    type: string;        // e.g. "stuck_pipe", "mud_losses", "kick"
    severity: 'warning' | 'critical';
    description: string; // Human-readable event description
}

export interface WellFieldWell {
    name: string;
    purpose: string;     // "Production", "Injection", "Observation", etc.
    platform: string;
    surface_northing: number;
    surface_easting: number;
    kb_elevation: number;
    water_depth: number;
    td_md: number;
    td_tvd: number;
    data_source: string; // "witsml" for real data, "synthesized" for derived
    entered_date?: string;
    completed_date?: string;
    trajectory: WellFieldTrajectoryPoint[];
    casings: CasingString[];
    events: DrillingEvent[];
    color: string;
}

export interface PlatformInfo {
    name: string;
    northing: number;
    easting: number;
}

export interface WellFieldDataset {
    field_name: string;
    data_attribution?: string;
    coordinate_reference?: string;
    platforms: PlatformInfo[];
    wells: WellFieldWell[];
}

/**
 * Load well field data from a JSON URL.
 */
export async function loadWellFieldData(url: string): Promise<WellFieldDataset | null> {
    try {
        const response = await fetch(url);
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
            console.warn(`Well field data not found at ${url}`);
            return null;
        }
        if (!response.ok) {
            console.warn(`Failed to load well field data: ${response.status}`);
            return null;
        }
        const data: WellFieldDataset = await response.json();
        console.log(`Loaded ${data.wells.length} wells from ${url}`);
        return data;
    } catch (error) {
        console.warn('Error loading well field data:', error);
        return null;
    }
}
