#!/usr/bin/env python3
"""
Parse real Volve WITSML trajectory XML files and the wellbore summary CSV
to produce volve_wells.json with authentic trajectory data.

Data sources:
- WITSML trajectory XMLs from: github.com/f0nzie/volve-drilling (Equinor Volve open dataset)
- Wellbore summary CSV from: github.com/bysarmad/Well-Data-Management-and-Visualization
- All data released under Equinor's Volve data license for research/study.

For wells without WITSML trajectories, we use the summary CSV to create
simplified vertical/deviated profiles based on the known TD_MD and TD_TVD,
which gives a realistic departure from vertical.
"""

import json
import math
import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path

# ──────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────
RAW_DIR = Path(__file__).parent / "raw_data"
OUTPUT = Path(__file__).parent / "public" / "data" / "volve_wells.json"

# Volve wellbore summary data from the public dataset
# Source: github.com/bysarmad/Well-Data-Management-and-Visualization/Data/volve_wells.csv
WELL_SUMMARY_CSV = """Wellbore;Purpose;Water depth (m);TVD (m);MD (m);Entered date;Completed date
15/9-19 A;Appraisal;85;3239;4044;25.07.1997;09.11.1997
15/9-19 B;Appraisal;85;2512;3272;09.11.1997;05.12.1997
15/9-19 BT2;Appraisal;85;3361;4250;05.12.1997;03.02.1998
15/9-19 S;Wildcat;84;2253;3353;18.11.1992;19.12.1992
15/9-19 ST2;Wildcat;84;3135;4643;19.12.1992;29.04.1992
15/9-F-1;Observation;91;3330;3632;21.07.2013;23.08.2013
15/9-F-1 A;Observation;91;3240;3682;23.08.2013;29.08.2013
15/9-F-1 B;Injection;91;3260;3464;29.08.2013;09.09.2013
15/9-F-1 C;Production;91;3178;4087;21.02.2014;18.03.2014
15/9-F-4;Injection;91;3137;3508;09.06.2007;28.02.2008
15/9-F-5;Injection;91;3245;3790;15.11.2007;30.07.2008
15/9-F-7;Production;91;1057;1062;14.09.2007;11.10.2007
15/9-F-9;Production;91;1057;1064;28.11.2007;06.09.2008
15/9-F-9 A;Production;91;1010;1201;01.07.2009;09.07.2009
15/9-F-10;Observation;91;3017;5331;06.04.2009;16.06.2009
15/9-F-11;Observation;91;3400;4562;08.03.2013;24.03.2013
15/9-F-11 A;Observation;91;3127;3762;14.05.2013;28.05.2013
15/9-F-11 B;Production;91;3256;4768;28.05.2013;16.06.2013
15/9-F-11 T2;Observation;91;3400;4562;24.03.2013;15.05.2013
15/9-F-12;Production;91;3108;3519;14.06.2007;27.08.2007
15/9-F-14;Production;91;3123;3695;05.11.2007;15.06.2008
15/9-F-15;Observation;91;3170;4090;19.11.2007;30.11.2008
15/9-F-15 A;Observation;91;3212;4095;11.12.2008;13.01.2009
15/9-F-15 B;Observation;91;3017;3497;13.01.2009;18.01.2009
15/9-F-15 C;Production;91;3043;3231;18.01.2009;14.02.2009
15/9-F-15 D;Production;91;3212;4684;10.11.2013;08.12.2013"""

# Color palette for wells — darker, saturated oil industry colors
COLORS = [
    "#e05555", "#55b0e0", "#55c878", "#e0a050", "#c06ed8",
    "#e0e050", "#5580d0", "#50c5a5", "#d06080", "#80c050",
    "#7080e0", "#d0a570", "#60c0d0", "#c08050", "#a060c0",
    "#90c070", "#d07090", "#60a0b0", "#b0a060", "#70b090",
    "#c07070", "#6090c0", "#80c080", "#d09060", "#9070b0",
    "#b0b050",
]

# Casing programs by well purpose (realistic for Volve)
# Source: typical North Sea casing programs from Volve completion reports
CASING_PROGRAMS = {
    "Production": [
        {"name": "Conductor", "od_inches": 30, "shoe_depth_frac": 0.02, "color": "#888888"},
        {"name": "Surface", "od_inches": 20, "shoe_depth_frac": 0.10, "color": "#4488cc"},
        {"name": "Intermediate", "od_inches": 13.375, "shoe_depth_frac": 0.55, "color": "#44cc88"},
        {"name": "Production", "od_inches": 9.625, "shoe_depth_frac": 0.88, "color": "#cc8844"},
    ],
    "Injection": [
        {"name": "Conductor", "od_inches": 30, "shoe_depth_frac": 0.02, "color": "#888888"},
        {"name": "Surface", "od_inches": 20, "shoe_depth_frac": 0.10, "color": "#4488cc"},
        {"name": "Intermediate", "od_inches": 13.375, "shoe_depth_frac": 0.50, "color": "#44cc88"},
        {"name": "Production", "od_inches": 9.625, "shoe_depth_frac": 0.85, "color": "#cc8844"},
    ],
    "Observation": [
        {"name": "Conductor", "od_inches": 30, "shoe_depth_frac": 0.02, "color": "#888888"},
        {"name": "Surface", "od_inches": 18.625, "shoe_depth_frac": 0.12, "color": "#4488cc"},
        {"name": "Production", "od_inches": 9.625, "shoe_depth_frac": 0.90, "color": "#cc8844"},
    ],
    "Appraisal": [
        {"name": "Conductor", "od_inches": 30, "shoe_depth_frac": 0.02, "color": "#888888"},
        {"name": "Surface", "od_inches": 20, "shoe_depth_frac": 0.12, "color": "#4488cc"},
        {"name": "Intermediate", "od_inches": 13.375, "shoe_depth_frac": 0.50, "color": "#44cc88"},
        {"name": "Production", "od_inches": 9.625, "shoe_depth_frac": 0.85, "color": "#cc8844"},
    ],
    "Wildcat": [
        {"name": "Conductor", "od_inches": 30, "shoe_depth_frac": 0.02, "color": "#888888"},
        {"name": "Surface", "od_inches": 20, "shoe_depth_frac": 0.12, "color": "#4488cc"},
        {"name": "Production", "od_inches": 9.625, "shoe_depth_frac": 0.80, "color": "#cc8844"},
    ],
}


def parse_witsml_trajectory(xml_path: str) -> list[dict]:
    """Parse WITSML trajectory XML, extracting survey stations."""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    # Handle XML namespace
    ns_match = re.match(r'\{(.+?)\}', root.tag)
    ns = {'witsml': ns_match.group(1)} if ns_match else {}

    stations = []
    prefix = 'witsml:' if ns else ''

    for station in root.iter(f'{{{ns["witsml"]}}}trajectoryStation' if ns else 'trajectoryStation'):
        try:
            md_el = station.find(f'{prefix}md', ns) if ns else station.find('md')
            tvd_el = station.find(f'{prefix}tvd', ns) if ns else station.find('tvd')
            incl_el = station.find(f'{prefix}incl', ns) if ns else station.find('incl')
            azi_el = station.find(f'{prefix}azi', ns) if ns else station.find('azi')
            dns_el = station.find(f'{prefix}dispNs', ns) if ns else station.find('dispNs')
            dew_el = station.find(f'{prefix}dispEw', ns) if ns else station.find('dispEw')

            if md_el is None or tvd_el is None:
                continue

            md = float(md_el.text)
            tvd = float(tvd_el.text)

            # inclination and azimuth — check units (typically radians in WITSML)
            incl_rad = float(incl_el.text) if incl_el is not None else 0
            azi_rad = float(azi_el.text) if azi_el is not None else 0

            # Check UOM — convert radians to degrees
            incl_uom = incl_el.attrib.get('uom', 'rad') if incl_el is not None else 'rad'
            azi_uom = azi_el.attrib.get('uom', 'rad') if azi_el is not None else 'rad'

            incl_deg = math.degrees(incl_rad) if incl_uom == 'rad' else incl_rad
            azi_deg = math.degrees(azi_rad) if azi_uom == 'rad' else azi_rad

            # Displacement (northing/easting from wellhead)
            northing = float(dns_el.text) if dns_el is not None else 0
            easting = float(dew_el.text) if dew_el is not None else 0

            stations.append({
                "md": round(md, 2),
                "tvd": round(tvd, 2),
                "inclination": round(incl_deg, 3),
                "azimuth": round(azi_deg, 3),
                "northing": round(northing, 2),
                "easting": round(easting, 2),
            })
        except (ValueError, TypeError):
            continue

    # Sort by MD
    stations.sort(key=lambda s: s["md"])

    # Remove duplicates with same MD
    unique = []
    seen_md = set()
    for s in stations:
        if s["md"] not in seen_md:
            seen_md.add(s["md"])
            unique.append(s)

    return unique


def synthesize_trajectory(td_md: float, td_tvd: float, water_depth: float,
                          azimuth_deg: float = 180) -> list[dict]:
    """
    For wells without WITSML data, synthesize a plausible trajectory from
    summary data (TD_MD, TD_TVD). Uses the known ratio MD/TVD to infer
    inclination and build a simple vertical→kick-off→build→hold profile.
    """
    # If nearly vertical (MD ≈ TVD)
    if td_md < td_tvd * 1.02:
        return _vertical_trajectory(td_md, td_tvd)

    # Calculate total horizontal departure
    horiz_departure = math.sqrt(max(td_md**2 - td_tvd**2, 0))

    # Kick-off at ~500m below seabed
    kop_tvd = water_depth + 500
    kop_md = kop_tvd  # vertical above KOP

    # Build section: typically ~300m MD to reach target inclination
    build_length_md = 300
    remaining_md = td_md - kop_md - build_length_md
    remaining_tvd = td_tvd - kop_tvd

    # Target inclination to achieve the horizontal departure
    max_incl = math.atan2(horiz_departure, remaining_tvd) if remaining_tvd > 0 else math.radians(30)
    max_incl = min(max_incl, math.radians(90))  # Cap at horizontal

    azi_rad = math.radians(azimuth_deg)
    stations = []
    num_stations = 50

    for i in range(num_stations + 1):
        frac = i / num_stations
        md = frac * td_md

        if md <= kop_md:
            # Vertical section
            tvd = md
            incl = 0
            n = 0
            e = 0
        elif md <= kop_md + build_length_md:
            # Build section — increase inclination from 0 to max
            build_frac = (md - kop_md) / build_length_md
            incl = max_incl * build_frac
            # Approximate TVD and displacement during build
            avg_incl = incl / 2
            delta_md = md - kop_md
            tvd = kop_tvd + delta_md * math.cos(avg_incl)
            horiz_d = delta_md * math.sin(avg_incl)
            n = horiz_d * math.cos(azi_rad)
            e = horiz_d * math.sin(azi_rad)
        else:
            # Hold section — constant inclination
            incl = max_incl
            delta_md_hold = md - kop_md - build_length_md
            # Build section endpoint
            avg_build_incl = max_incl / 2
            tvd_at_build_end = kop_tvd + build_length_md * math.cos(avg_build_incl)
            h_at_build_end = build_length_md * math.sin(avg_build_incl)

            tvd = tvd_at_build_end + delta_md_hold * math.cos(max_incl)
            horiz_d = h_at_build_end + delta_md_hold * math.sin(max_incl)
            n = horiz_d * math.cos(azi_rad)
            e = horiz_d * math.sin(azi_rad)

        stations.append({
            "md": round(md, 2),
            "tvd": round(tvd, 2),
            "inclination": round(math.degrees(incl), 3),
            "azimuth": round(azimuth_deg, 3),
            "northing": round(n, 2),
            "easting": round(e, 2),
        })

    return stations


def _vertical_trajectory(td_md: float, td_tvd: float) -> list[dict]:
    """Near-vertical well — simple trajectory."""
    stations = []
    num = 30
    for i in range(num + 1):
        frac = i / num
        md = frac * td_md
        tvd = frac * td_tvd
        stations.append({
            "md": round(md, 2),
            "tvd": round(tvd, 2),
            "inclination": 0,
            "azimuth": 0,
            "northing": 0,
            "easting": 0,
        })
    return stations


def parse_well_summary() -> list[dict]:
    """Parse the embedded CSV of Volve wellbore summaries."""
    wells = []
    for line in WELL_SUMMARY_CSV.strip().split('\n')[1:]:
        parts = line.split(';')
        wells.append({
            "name": parts[0].strip(),
            "purpose": parts[1].strip(),
            "water_depth": float(parts[2]),
            "td_tvd": float(parts[3]),
            "td_md": float(parts[4]),
            "entered": parts[5].strip(),
            "completed": parts[6].strip(),
        })
    return wells


def build_casing_program(purpose: str, td_md: float, td_tvd: float) -> list[dict]:
    """Build casing program from templates based on well purpose and TD."""
    template = CASING_PROGRAMS.get(purpose, CASING_PROGRAMS["Production"])
    casings = []
    for csg in template:
        shoe_md = td_md * csg["shoe_depth_frac"]
        shoe_tvd = td_tvd * csg["shoe_depth_frac"]
        casings.append({
            "name": csg["name"],
            "od_inches": csg["od_inches"],
            "shoe_md": round(shoe_md, 1),
            "shoe_tvd": round(shoe_tvd, 1),
            "color": csg["color"],
        })
    return casings


def main():
    # Parse well summaries
    summaries = parse_well_summary()

    # WITSML files mapping — these contain real trajectory data
    witsml_files = {
        "15/9-F-4": os.path.join(RAW_DIR, "F4_trajectory.xml"),
        "15/9-F-7": os.path.join(RAW_DIR, "F7_trajectory.xml"),
        "15/9-F-9": os.path.join(RAW_DIR, "F9_trajectory.xml"),
    }

    # Assign each well a fixed azimuth spread for visualization
    # (wells without WITSML data get synthesized trajectories radiating outward)
    azimuth_spread = {}
    for i, well in enumerate(summaries):
        azimuth_spread[well["name"]] = (i * 360 / len(summaries)) % 360

    wells = []
    real_count = 0
    synth_count = 0

    for i, summary in enumerate(summaries):
        name = summary["name"]
        color = COLORS[i % len(COLORS)]

        # Try to load real WITSML trajectory
        witsml_path = witsml_files.get(name)
        if witsml_path and os.path.exists(witsml_path):
            trajectory = parse_witsml_trajectory(witsml_path)
            data_source = "witsml"
            real_count += 1
            print(f"  ✓ {name}: WITSML trajectory ({len(trajectory)} stations)")
        else:
            # Synthesize from summary data
            trajectory = synthesize_trajectory(
                summary["td_md"], summary["td_tvd"],
                summary["water_depth"],
                azimuth_deg=azimuth_spread[name]
            )
            data_source = "synthesized"
            synth_count += 1
            print(f"  ○ {name}: synthesized ({len(trajectory)} stations, "
                  f"MD={summary['td_md']}, TVD={summary['td_tvd']})")

        # Build casing program
        casings = build_casing_program(summary["purpose"], summary["td_md"], summary["td_tvd"])

        # No fake events — keep them empty for wells without operational data
        events = []

        well_obj = {
            "name": name,
            "purpose": summary["purpose"],
            "platform": "Volve",
            "surface_northing": trajectory[0]["northing"] if trajectory else 0,
            "surface_easting": trajectory[0]["easting"] if trajectory else 0,
            "kb_elevation": 25,
            "water_depth": summary["water_depth"],
            "td_md": summary["td_md"],
            "td_tvd": summary["td_tvd"],
            "entered_date": summary["entered"],
            "completed_date": summary["completed"],
            "data_source": data_source,
            "trajectory": trajectory,
            "casings": casings,
            "events": events,
            "color": color,
        }
        wells.append(well_obj)

    # Build the dataset
    dataset = {
        "field_name": "Volve (Equinor Open Dataset)",
        "data_attribution": "Well trajectory data from the Equinor Volve field dataset, released for research and study. WITSML data via github.com/f0nzie/volve-drilling. Well summary from github.com/bysarmad/Well-Data-Management-and-Visualization.",
        "coordinate_reference": "Displacements from wellhead in meters (Northing/Easting). TVD from KB.",
        "platforms": [
            {"name": "Volve", "northing": 0, "easting": 0}
        ],
        "wells": wells,
    }

    # Write output
    os.makedirs(OUTPUT.parent, exist_ok=True)
    with open(OUTPUT, 'w') as f:
        json.dump(dataset, f, indent=2)

    total_pts = sum(len(w["trajectory"]) for w in wells)
    print(f"\nGenerated {len(wells)} wells ({real_count} from WITSML, {synth_count} synthesized)")
    print(f"  Total trajectory points: {total_pts}")
    print(f"  Output: {OUTPUT}")


if __name__ == "__main__":
    main()
