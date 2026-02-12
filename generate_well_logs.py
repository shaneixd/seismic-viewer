#!/usr/bin/env python3
"""
Generate synthetic but geologically-plausible well log data for F3 Netherlands wells.
Produces GR (Gamma Ray), DT (Sonic), and RHOB (Density) curves aligned to
the existing formation tops in f3_wells.json.

Output: public/data/f3_well_logs.json
"""

import json
import numpy as np
from pathlib import Path

# Seed for reproducibility
np.random.seed(42)

# Formation-specific log properties (typical North Sea values)
# Each entry: (GR_mean, GR_std, DT_mean, DT_std, RHOB_mean, RHOB_std)
FORMATION_PROPERTIES = {
    # Code: (gr_mean, gr_std, dt_mean, dt_std, rhob_mean, rhob_std)
    "NU":     (50,  15,  110, 8,   2.05, 0.08),   # Upper North Sea - unconsolidated sands/clays
    "NM":     (65,  20,  100, 10,  2.15, 0.10),   # Middle North Sea - mixed clastics
    "NLFFC":  (90,  12,   85, 6,   2.30, 0.06),   # Dongen Clay - high GR clay
    "NLFFT":  (40,  10,   75, 5,   2.55, 0.05),   # Dongen Tuffite - volcanic, dense
    "NLLFC":  (85,  10,   82, 5,   2.35, 0.05),   # Landen Clay - shale
    "CKEK":   (15,   8,   55, 4,   2.60, 0.04),   # Ekofisk - clean chalk
    "CKGR":   (20,  10,   50, 5,   2.65, 0.05),   # Ommelanden - chalk
    "KNGL":   (30,  12,   65, 6,   2.50, 0.06),   # Holland Fm
    "KNNC":   (80,  10,   80, 5,   2.40, 0.05),   # Vlieland Claystone
    "SGKI":   (75,  18,   78, 7,   2.38, 0.07),   # Kimmeridge Clay
    "SLCU":   (70,  15,   75, 6,   2.42, 0.06),   # Upper Graben
    "ZECP":   (25,   8,   55, 4,   2.70, 0.04),   # Zechstein caprock - anhydrite
    "ZESA":   (10,   5,   67, 3,   2.17, 0.03),   # Zechstein salt - very low GR
    "NN":     (60,  20,   80, 10,  2.35, 0.10),   # Not Interpreted - generic
}

# Default properties for unknown formations
DEFAULT_PROPS = (60, 18, 85, 8, 2.30, 0.08)

SAMPLE_INTERVAL = 0.5  # meters


def add_depth_trend(values: np.ndarray, depth_start: float, depth_end: float,
                    trend_per_km: float) -> np.ndarray:
    """Add a compaction trend to log values."""
    depths = np.linspace(depth_start, depth_end, len(values))
    trend = trend_per_km * (depths / 1000.0)
    return values + trend


def smooth_curve(values: np.ndarray, window: int = 5) -> np.ndarray:
    """Apply simple moving average smoothing."""
    kernel = np.ones(window) / window
    smoothed = np.convolve(values, kernel, mode='same')
    # Fix edges
    half = window // 2
    smoothed[:half] = values[:half]
    smoothed[-half:] = values[-half:]
    return smoothed


def generate_transition(n_samples: int, from_val: float, to_val: float,
                        transition_width: int = 10) -> np.ndarray:
    """Generate smooth transition between formation boundaries."""
    transition = np.zeros(n_samples)
    # Use sigmoid-like transition
    if n_samples <= transition_width * 2:
        return np.linspace(from_val, to_val, n_samples)
    x = np.linspace(-3, 3, transition_width)
    sigmoid = 1 / (1 + np.exp(-x))
    transition[:transition_width] = from_val + (to_val - from_val) * sigmoid
    transition[transition_width:] = to_val
    return transition


def generate_well_logs(well: dict) -> dict:
    """Generate synthetic log curves for a single well."""
    formations = well["formations"]
    if not formations:
        return None

    # Determine total depth range
    min_md = max(formations[0]["top_md"], 50)  # Start logs at 50m or formation top
    max_md = well["td_md"]

    # Generate depth array
    depths_md = np.arange(min_md, max_md + SAMPLE_INTERVAL, SAMPLE_INTERVAL)
    n_total = len(depths_md)

    # Initialize log arrays
    gr = np.zeros(n_total)
    dt = np.zeros(n_total)
    rhob = np.zeros(n_total)

    # Build lookup: which formation is each sample in?
    for i, md in enumerate(depths_md):
        fm_code = "NU"  # default to shallowest
        for fm in formations:
            if fm["top_md"] <= md < fm["bottom_md"]:
                fm_code = fm["code"]
                break
        else:
            # Past last formation
            if md >= formations[-1]["bottom_md"]:
                fm_code = formations[-1]["code"]

        props = FORMATION_PROPERTIES.get(fm_code, DEFAULT_PROPS)
        gr_mean, gr_std, dt_mean, dt_std, rhob_mean, rhob_std = props

        # Generate with noise
        gr[i] = np.random.normal(gr_mean, gr_std)
        dt[i] = np.random.normal(dt_mean, dt_std)
        rhob[i] = np.random.normal(rhob_mean, rhob_std)

    # Add compaction trends
    gr = add_depth_trend(gr, min_md, max_md, -5)   # GR slightly decreases with depth
    dt = add_depth_trend(dt, min_md, max_md, -15)   # Sonic decreases (faster velocity)
    rhob = add_depth_trend(rhob, min_md, max_md, 0.1)  # Density increases

    # Smooth to make more realistic
    gr = smooth_curve(gr, window=7)
    dt = smooth_curve(dt, window=5)
    rhob = smooth_curve(rhob, window=5)

    # Add subtle boundary effects at formation tops
    for fm in formations:
        idx = np.argmin(np.abs(depths_md - fm["top_md"]))
        boundary_width = min(20, n_total - idx)  # ~10m transition
        if idx > 0 and idx < n_total - boundary_width:
            # Add a spike pattern near boundaries (common in real logs)
            spike = np.random.normal(0, 3, boundary_width)
            gr[idx:idx+boundary_width] += spike * 2
            dt[idx:idx+boundary_width] += spike
            rhob[idx:idx+boundary_width] -= spike * 0.02

    # Final smoothing pass
    gr = smooth_curve(gr, window=3)
    dt = smooth_curve(dt, window=3)
    rhob = smooth_curve(rhob, window=3)

    # Clamp to physical ranges
    gr = np.clip(gr, 0, 200)
    dt = np.clip(dt, 30, 180)
    rhob = np.clip(rhob, 1.5, 3.0)

    # Compute TVDSS from MD using trajectory interpolation
    traj = well["trajectory"]
    traj_md = [p["md"] for p in traj]
    traj_tvdss = [p["tvdss"] for p in traj]

    # Extrapolate if needed
    if traj_md[0] > min_md:
        # Assume vertical above first trajectory point
        offset = traj_md[0] - traj_tvdss[0]
        traj_md.insert(0, 0)
        traj_tvdss.insert(0, -offset)

    depths_tvdss = np.interp(depths_md, traj_md, traj_tvdss)

    # Round for reasonable file size
    return {
        "wellName": well["name"],
        "depthUnit": "m",
        "depths": [round(float(d), 1) for d in depths_md],
        "tvdss": [round(float(d), 1) for d in depths_tvdss],
        "curves": [
            {
                "name": "GR",
                "unit": "gAPI",
                "description": "Gamma Ray",
                "data": [round(float(v), 1) for v in gr],
                "min": round(float(np.min(gr)), 1),
                "max": round(float(np.max(gr)), 1),
            },
            {
                "name": "DT",
                "unit": "us/ft",
                "description": "Sonic",
                "data": [round(float(v), 1) for v in dt],
                "min": round(float(np.min(dt)), 1),
                "max": round(float(np.max(dt)), 1),
            },
            {
                "name": "RHOB",
                "unit": "g/cc",
                "description": "Bulk Density",
                "data": [round(float(v), 2) for v in rhob],
                "min": round(float(np.min(rhob)), 2),
                "max": round(float(np.max(rhob)), 2),
            },
        ],
    }


def main():
    # Load existing well data
    wells_path = Path(__file__).parent / "public" / "data" / "f3_wells.json"
    with open(wells_path) as f:
        well_dataset = json.load(f)

    logs = []
    for well in well_dataset["wells"]:
        print(f"Generating logs for {well['name']}...")
        log_data = generate_well_logs(well)
        if log_data:
            n_samples = len(log_data["depths"])
            depth_range = f"{log_data['depths'][0]}-{log_data['depths'][-1]}m"
            print(f"  {n_samples} samples, {depth_range}")
            for curve in log_data["curves"]:
                print(f"  {curve['name']}: {curve['min']}-{curve['max']} {curve['unit']}")
            logs.append(log_data)

    output = {"wells": logs}

    # Write output
    output_path = Path(__file__).parent / "public" / "data" / "f3_well_logs.json"
    with open(output_path, "w") as f:
        json.dump(output, f, separators=(',', ':'))

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"\nWrote {output_path} ({size_mb:.2f} MB)")
    print(f"Generated logs for {len(logs)} wells")


if __name__ == "__main__":
    main()
