#!/usr/bin/env python3
"""
Extract real well trajectories from Volve WITSML-as-CSV depth files.
Reads MWD realtime log data, extracts rows with valid inclination & azimuth,
computes northing/easting via minimum curvature, and updates volve_wells.json.
"""

import csv
import json
import math
import os
import re
import sys

DATA_DIR = os.path.expanduser("~/Downloads/VolveWITSMLasCSV")
OUTPUT = "public/data/volve_wells.json"

# Column name candidates (varies by file / service company)
# Tuples of (column_name, is_radians)
MD_COLS = [
    ("Measured Depth m", False),
    ("0 Depth Hole m", False),
    ("1 Depth Hole m", False),
]
INC_COLS = [
    ("MWD Continuous Inclination dega", False),
    ("MWD Continuous Inclination ", False),
    ("CRS Continuous Inclination dega", False),
    ("PowerDrive Inclination dega", False),
    ("PowerDrive Inclination ", False),
    ("RAB Inclination ", False),
    ("Inclination - Sag Corrected rad", True),
    ("Inclination - Non-Rotating rad", True),
    ("Motor Inclination rad", True),
    ("43 Inclination - Non-Rotating deg", False),
    ("81 Inclination - Non-Rotating deg", False),
    ("45 Inclination - Non-Rotating deg", False),
    ("80 Inclination - Non-Rotating deg", False),
    ("Gyro True Inclination rad", True),
]
AZI_COLS = [
    ("MWD Continuous Azimuth dega", False),
    ("MWD Continuous Azimuth ", False),
    ("CRS Continuous Azimuth dega", False),
    ("PowerDrive Azimuth Low Resolution dega", False),
    ("PowerDrive Azimuth Low Resolution ", False),
    ("Azimuth Corrected rad", True),
    ("Azimuth rad", True),
    ("Azimuth True Rotating rad", True),
    ("Gyro True Azimuth rad", True),
]
TVD_COLS = [
    ("Hole Depth (TVD) m", False),
    ("Extrapolated Hole TVD m", False),
    ("40 True Vertical Depth m", False),
    ("39 True Vertical Depth m", False),
    ("Vertical Depth m", False),
    ("73 True Vertical Depth m", False),
]


def find_col(headers, candidates):
    """Find the first matching column name from candidates. Returns (col_name, is_radians)."""
    for col_name, is_rad in candidates:
        if col_name in headers:
            return col_name, is_rad
    return None, False


def safe_float(val):
    try:
        v = float(val)
        return v if math.isfinite(v) else None
    except (ValueError, TypeError):
        return None


def extract_trajectory(filepath):
    """Extract trajectory stations from a depth-indexed CSV."""
    with open(filepath, "r", errors="replace") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []

        md_col, _ = find_col(headers, MD_COLS)
        inc_col, inc_rad = find_col(headers, INC_COLS)
        azi_col, azi_rad = find_col(headers, AZI_COLS)
        tvd_col, _ = find_col(headers, TVD_COLS)

        if not md_col:
            return None, "no MD column found"

        # Collect rows — try inc/azi primary, also collect MD/TVD pairs as fallback
        raw_inc = []  # Rows with MD + inclination
        raw_tvd = []  # Rows with MD + TVD (fallback)
        for row in reader:
            md = safe_float(row.get(md_col, ""))
            if md is None:
                continue

            inc = safe_float(row.get(inc_col, "")) if inc_col else None
            azi = safe_float(row.get(azi_col, "")) if azi_col else None
            tvd = safe_float(row.get(tvd_col, "")) if tvd_col else None

            # Convert radians to degrees if needed
            if inc is not None and inc_rad:
                inc = math.degrees(inc)
            if azi is not None and azi_rad:
                azi = math.degrees(azi)

            if inc is not None:
                if azi is None:
                    azi = 0.0
                raw_inc.append({"md": md, "inc": inc, "azi": azi, "tvd": tvd})

            if tvd is not None:
                raw_tvd.append({"md": md, "tvd": tvd})

    # Use inclination-based data if sufficient
    if len(raw_inc) >= 5:
        raw = raw_inc
        mode = "inc"
    elif len(raw_tvd) >= 10:
        # Fallback: derive inclination from MD/TVD gradient
        raw_tvd.sort(key=lambda r: r["md"])
        # Dedupe
        deduped = [raw_tvd[0]]
        for r in raw_tvd[1:]:
            if r["md"] > deduped[-1]["md"] + 0.5:
                deduped.append(r)
        raw_tvd = deduped

        raw = []
        for i, r in enumerate(raw_tvd):
            if i == 0:
                inc = 0.0
            else:
                dmd = r["md"] - raw_tvd[i - 1]["md"]
                dtvd = r["tvd"] - raw_tvd[i - 1]["tvd"]
                if dmd > 0:
                    cos_inc = max(-1, min(1, dtvd / dmd))
                    inc = math.degrees(math.acos(cos_inc))
                else:
                    inc = 0.0
            raw.append({"md": r["md"], "inc": inc, "azi": 0.0, "tvd": r["tvd"]})
        mode = "tvd"
    else:
        return None, f"insufficient data (inc={len(raw_inc)}, tvd={len(raw_tvd)})"

    if len(raw) < 5:
        return None, f"only {len(raw)} valid rows"

    # Sort by MD and dedupe
    raw.sort(key=lambda r: r["md"])
    deduped = [raw[0]]
    for r in raw[1:]:
        if r["md"] > deduped[-1]["md"] + 0.01:
            deduped.append(r)
    raw = deduped

    # Downsample to ~100 stations max (keep first, last, and evenly spaced)
    MAX_STATIONS = 100
    if len(raw) > MAX_STATIONS:
        indices = set([0, len(raw) - 1])
        step = (len(raw) - 1) / (MAX_STATIONS - 2)
        for i in range(1, MAX_STATIONS - 1):
            indices.add(int(round(i * step)))
        raw = [raw[i] for i in sorted(indices)]

    # Compute northing/easting via minimum curvature if not provided
    stations = []
    north, east, tvd_calc = 0.0, 0.0, 0.0

    for i, r in enumerate(raw):
        if i == 0:
            tvd_val = r["tvd"] if r["tvd"] is not None else 0.0
            stations.append({
                "md": round(r["md"], 2),
                "tvd": round(tvd_val, 2),
                "inclination": round(r["inc"], 2),
                "azimuth": round(r["azi"], 2),
                "northing": 0.0,
                "easting": 0.0,
            })
            tvd_calc = tvd_val
            continue

        prev = raw[i - 1]
        dmd = r["md"] - prev["md"]
        if dmd <= 0:
            continue

        inc1 = math.radians(prev["inc"])
        inc2 = math.radians(r["inc"])
        azi1 = math.radians(prev["azi"])
        azi2 = math.radians(r["azi"])

        # Minimum curvature dogleg angle
        cos_dl = (
            math.cos(inc2 - inc1)
            - math.sin(inc1) * math.sin(inc2) * (1 - math.cos(azi2 - azi1))
        )
        cos_dl = max(-1, min(1, cos_dl))
        dl = math.acos(cos_dl)

        if dl < 1e-7:
            rf = 1.0
        else:
            rf = (2 / dl) * math.tan(dl / 2)

        dN = (dmd / 2) * (math.sin(inc1) * math.cos(azi1) + math.sin(inc2) * math.cos(azi2)) * rf
        dE = (dmd / 2) * (math.sin(inc1) * math.sin(azi1) + math.sin(inc2) * math.sin(azi2)) * rf
        dV = (dmd / 2) * (math.cos(inc1) + math.cos(inc2)) * rf

        north += dN
        east += dE
        tvd_calc += dV

        tvd_val = r["tvd"] if r["tvd"] is not None else round(tvd_calc, 2)

        stations.append({
            "md": round(r["md"], 2),
            "tvd": round(tvd_val, 2),
            "inclination": round(r["inc"], 2),
            "azimuth": round(r["azi"], 2),
            "northing": round(north, 2),
            "easting": round(east, 2),
        })

    return stations, f"{len(stations)} stations ({mode})"


def well_name_from_filename(filename):
    """Extract well name like '15/9-F-4' from the CSV filename."""
    # Pattern: 15_$47$_9-F-XX (where $47$ is /)
    match = re.search(r"15_\$47\$_9-(.+?)\s*(depth|time)", filename)
    if match:
        suffix = match.group(1).strip()
        return f"15/9-{suffix}"
    return None


def main():
    if not os.path.isdir(DATA_DIR):
        print(f"Error: {DATA_DIR} not found")
        sys.exit(1)

    # Load existing wells JSON
    with open(OUTPUT) as f:
        data = json.load(f)

    # Find all depth CSV files
    depth_files = sorted([
        f for f in os.listdir(DATA_DIR)
        if "depth" in f.lower() and f.endswith(".csv")
    ])

    print(f"Found {len(depth_files)} depth CSV files\n")

    # Map well names to trajectory data
    extracted = {}
    for fname in depth_files:
        well_name = well_name_from_filename(fname)
        if not well_name:
            print(f"  ? Could not parse well name from: {fname}")
            continue

        filepath = os.path.join(DATA_DIR, fname)
        stations, info = extract_trajectory(filepath)

        if stations:
            # Map CSV well names to JSON well names
            # CSV might have "F-1 C 0" → JSON has "15/9-F-1 C"
            extracted[well_name] = stations
            print(f"  ✓ {well_name}: {info}")
        else:
            print(f"  ✗ {well_name}: {info}")

    # Update wells in JSON (skip wells that already have WITSML survey data)
    updated = 0
    for well in data["wells"]:
        wn = well["name"]
        if wn in extracted and well.get("data_source") != "witsml":
            well["trajectory"] = extracted[wn]
            well["data_source"] = "mwd_csv"
            updated += 1

    # Also try matching CSV names to JSON well names
    # Build a mapping of CSV names that weren't exact matches
    json_names = set(w["name"] for w in data["wells"])
    unmatched_csv = {k: v for k, v in extracted.items() if k not in json_names}
    
    # Explicit name mapping for known mismatches
    NAME_MAP = {
        "15/9-F-1 C 0": "15/9-F-1 C",
        "15/9-F-1 C A": "15/9-F-1 A",
        "15/9-F-1 C B": "15/9-F-1 B",
        "15/9-F-1 C C": "15/9-F-1 C",
        "15/9-F-15S": "15/9-F-15",
        "15/9-F-15A": "15/9-F-15 A",
        "15/9-F-15B": "15/9-F-15 B",
    }
    for well in data["wells"]:
        if well["data_source"] in ("mwd_csv", "witsml"):
            continue
        wn = well["name"]
        for csv_name, stations in unmatched_csv.items():
            mapped = NAME_MAP.get(csv_name)
            if mapped == wn:
                well["trajectory"] = stations
                well["data_source"] = "mwd_csv"
                updated += 1
                print(f"  → Mapped {csv_name} → {wn}")
                break

    # Write updated JSON
    with open(OUTPUT, "w") as f:
        json.dump(data, f, indent=2)

    witsml = sum(1 for w in data["wells"] if w["data_source"] == "witsml")
    mwd = sum(1 for w in data["wells"] if w["data_source"] == "mwd_csv")
    synth = sum(1 for w in data["wells"] if w["data_source"] == "synthesized")
    total_pts = sum(len(w["trajectory"]) for w in data["wells"])

    print(f"\n{'='*50}")
    print(f"Updated {updated} wells from CSV depth logs")
    print(f"  {witsml} WITSML  |  {mwd} MWD CSV  |  {synth} synthesized")
    print(f"  Total trajectory points: {total_pts}")
    print(f"  Output: {OUTPUT}")


if __name__ == "__main__":
    main()
