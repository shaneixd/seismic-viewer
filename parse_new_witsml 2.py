#!/usr/bin/env python3
"""
Parse real WITSML trajectory XML files from the Volve dataset.

Finds trajectory folders, picks the deepest/most complete actual trajectory
for each well, and extracts MD/TVD/Inc/Azi/N/E survey data.

Updates volve_wells.json with real trajectory data.
"""

import json
import glob
import os
import xml.etree.ElementTree as ET
import math

BASE_DIR = "public/data/All Volve Wells"
OUTPUT = "public/data/volve_wells.json"
NS = {"w": "http://www.witsml.org/schemas/1series"}


def parse_trajectory_xml(filepath):
    """
    Parse a single WITSML trajectory XML file.
    
    Returns dict with trajectory metadata and stations, or None on failure.
    """
    tree = ET.parse(filepath)
    root = tree.getroot()
    
    traj = root.find(".//w:trajectory", NS)
    if traj is None:
        return None
    
    name_el = traj.find("w:name", NS)
    name = name_el.text if name_el is not None else "Unknown"
    
    # Skip planned trajectories — we want actual
    if "Plan" in name or "plan" in name:
        return None
    
    well_name_el = traj.find("w:nameWell", NS)
    well_name = well_name_el.text if well_name_el is not None else "?"
    
    md_min_el = traj.find("w:mdMn", NS)
    md_max_el = traj.find("w:mdMx", NS)
    md_min = float(md_min_el.text) if md_min_el is not None else 0
    md_max = float(md_max_el.text) if md_max_el is not None else 0
    
    stations = []
    for stn in traj.findall(".//w:trajectoryStation", NS):
        md = stn.find("w:md", NS)
        tvd = stn.find("w:tvd", NS)
        incl = stn.find("w:incl", NS)
        azi = stn.find("w:azi", NS)
        ns_disp = stn.find("w:dispNs", NS)
        ew_disp = stn.find("w:dispEw", NS)
        dls = stn.find("w:dls", NS)
        
        if md is None or tvd is None:
            continue
        
        station = {
            "md": round(float(md.text), 2),
            "tvd": round(float(tvd.text), 2),
            "inclination": round(float(incl.text), 2) if incl is not None else 0.0,
            "azimuth": round(float(azi.text), 2) if azi is not None else 0.0,
            "northing": round(float(ns_disp.text), 2) if ns_disp is not None else 0.0,
            "easting": round(float(ew_disp.text), 2) if ew_disp is not None else 0.0,
        }
        stations.append(station)
    
    if not stations:
        return None
    
    # Sort by MD
    stations.sort(key=lambda s: s["md"])
    
    return {
        "well_name": well_name,
        "traj_name": name,
        "md_min": md_min,
        "md_max": md_max,
        "stations": stations,
        "filepath": filepath,
    }


def find_best_trajectory(traj_dir):
    """
    Given a trajectory directory with multiple XML files,
    pick the one with the most complete (deepest) actual trajectory.
    """
    candidates = []
    for xml_path in sorted(glob.glob(os.path.join(traj_dir, "*.xml"))):
        result = parse_trajectory_xml(xml_path)
        if result and len(result["stations"]) >= 2:
            candidates.append(result)
    
    if not candidates:
        return None
    
    # Pick the trajectory with the highest max MD and good station count
    # Prefer: deepest coverage, most stations
    candidates.sort(key=lambda c: (c["md_max"], len(c["stations"])), reverse=True)
    return candidates[0]


def normalize_well_name(name):
    """Normalize WITSML well name to match volve_wells.json format."""
    name = name.strip()
    # Strip country/operator prefixes like "NO "
    if name.startswith("NO "):
        name = name[3:]
    return name


def detect_sidetrack_relationships(parsed_wells):
    """
    Detect parent-child relationships from well naming conventions.
    
    Norwegian convention:
    - 15/9-F-9     = parent well
    - 15/9-F-9 A   = first sidetrack from F-9
    - 15/9-F-11 B  = second sidetrack from F-11
    - 15/9-19 BT2  = re-entry of sidetrack B on well 19
    - 15/9-19 ST2  = re-entry of sidetrack S on well 19
    """
    relationships = {}
    for name in parsed_wells:
        parts = name.rsplit(" ", 1)
        if len(parts) == 2:
            base, suffix = parts
            # Check if suffix looks like a sidetrack letter (A, B, C, etc.)
            # or T2/ST2 (re-entries)
            if suffix in ("A", "B", "C", "D") or suffix.startswith("T") or suffix.startswith("ST"):
                parent = base
                relationships[name] = {
                    "parent": parent,
                    "suffix": suffix,
                }
    return relationships


def stitch_sidetrack(parent_stations, child_stations):
    """
    For a sidetrack that starts at non-zero MD, prepend the parent's
    trajectory from surface to just before the kickoff point.
    
    Returns the stitched trajectory.
    """
    if not child_stations or not parent_stations:
        return child_stations
    
    child_start_md = child_stations[0]["md"]
    if child_start_md <= 0:
        return child_stations  # Already starts from surface
    
    # Get parent stations up to the kickoff point
    parent_prefix = [s for s in parent_stations if s["md"] < child_start_md]
    
    if not parent_prefix:
        return child_stations
    
    return parent_prefix + child_stations


def main():
    # Find all trajectory directories
    traj_dirs = sorted(glob.glob(os.path.join(BASE_DIR, "*/1/trajectory")))
    
    if not traj_dirs:
        print("No trajectory directories found!")
        return
    
    print(f"Found {len(traj_dirs)} wells with trajectory data\n")
    
    # Parse each well's trajectory
    parsed_wells = {}
    for traj_dir in traj_dirs:
        well_dir = os.path.dirname(os.path.dirname(traj_dir))
        folder_name = os.path.basename(well_dir)
        
        best = find_best_trajectory(traj_dir)
        if best:
            well_name = normalize_well_name(best["well_name"])
            best["well_name"] = well_name
            parsed_wells[well_name] = best
            
            last_stn = best["stations"][-1]
            departure = math.sqrt(last_stn["northing"]**2 + last_stn["easting"]**2)
            max_inc = max(s["inclination"] for s in best["stations"])
            kickoff_note = f"  ⚡ kickoff@{best['md_min']:.0f}m" if best["md_min"] > 10 else ""
            
            print(f"  ✓ {well_name:20s}  {len(best['stations']):3d} stn  "
                  f"MD=[{best['md_min']:.0f}-{best['md_max']:.0f}]  "
                  f"maxInc={max_inc:5.1f}°  depart={departure:7.0f}m  "
                  f"\"{best['traj_name'][:50]}\""
                  f"{kickoff_note}")
        else:
            print(f"  ✗ {folder_name}: no valid trajectory found")
    
    # Load existing well data (needed for parent trajectory lookup during stitching)
    with open(OUTPUT) as f:
        data = json.load(f)
    
    # Build lookup of existing trajectories from JSON
    existing_trajectories = {}
    for w in data["wells"]:
        if w.get("trajectory") and w.get("data_source") == "witsml":
            existing_trajectories[w["name"]] = w["trajectory"]
    
    # Detect sidetrack relationships and stitch
    relationships = detect_sidetrack_relationships(parsed_wells)
    # Also check ALL wells in volve_wells.json for sidetrack naming
    all_well_names = [w["name"] for w in data["wells"]]
    for wn in all_well_names:
        parts = wn.rsplit(" ", 1)
        if len(parts) == 2 and wn not in relationships:
            base, suffix = parts
            if suffix in ("A", "B", "C", "D") or suffix.startswith("T") or suffix.startswith("ST"):
                relationships[wn] = {"parent": base, "suffix": suffix}
    
    if relationships:
        print(f"\nSidetrack relationships detected:")
        for child, info in relationships.items():
            parent = info["parent"]
            child_traj = parsed_wells.get(child)
            
            if not child_traj or child_traj["md_min"] <= 10:
                if child_traj:
                    print(f"  ○ {child} is sidetrack of {parent} (starts from surface)")
                continue
            
            # Look for parent trajectory: first in parsed_wells, then in existing JSON
            parent_stations = None
            if parent in parsed_wells:
                parent_stations = parsed_wells[parent]["stations"]
            elif parent in existing_trajectories:
                parent_stations = existing_trajectories[parent]
            
            if parent_stations:
                # Stitch parent trajectory prefix
                stitched = stitch_sidetrack(parent_stations, child_traj["stations"])
                old_count = len(child_traj["stations"])
                child_traj["stations"] = stitched
                print(f"  ⚡ {child} branches from {parent} at MD={child_traj['md_min']:.0f}m"
                      f" — stitched {old_count} → {len(stitched)} stations")
            else:
                print(f"  ⚠ {child} branches from {parent} at MD={child_traj['md_min']:.0f}m"
                      f" — but parent trajectory not available")
    
    # Update wells with real trajectory data
    print(f"\nUpdating {OUTPUT}...")
    updated = 0
    for well in data["wells"]:
        wn = well["name"]
        if wn in parsed_wells:
            traj = parsed_wells[wn]
            well["trajectory"] = traj["stations"]
            well["data_source"] = "witsml"
            updated += 1
            print(f"  ✓ Updated {wn} ({len(traj['stations'])} stations)")
    
    # Write output
    with open(OUTPUT, "w") as f:
        json.dump(data, f, indent=2)
    
    witsml_count = sum(1 for w in data["wells"] if w.get("data_source") == "witsml")
    other_count = len(data["wells"]) - witsml_count
    
    print(f"\n{'='*60}")
    print(f"Updated {updated} wells with real WITSML trajectory data")
    print(f"Total: {witsml_count} WITSML + {other_count} other = {len(data['wells'])} wells")
    print(f"Output: {OUTPUT}")


if __name__ == "__main__":
    main()
