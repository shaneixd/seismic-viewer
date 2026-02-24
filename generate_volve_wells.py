#!/usr/bin/env python3
"""
Generate realistic Volve-inspired well field data for the 3D Well Field Viewer.

Creates ~30 wells radiating from a few platform locations with:
- Complex J/S-curve 3D trajectories (minimum curvature method)
- Casing programs (conductor, surface, intermediate, production)
- Drilling events/warnings (stuck pipe, mud losses, kicks, etc.)

Output: public/data/volve_wells.json
"""

import json
import math
import random
import os

# Seed for reproducibility
random.seed(42)

# ── Field Configuration ──
FIELD_NAME = "Volve (Inspired)"
WATER_DEPTH = 80.0  # meters
KB_ELEVATION = 25.0  # meters above sea level

# Platform locations (Northing, Easting) relative to field center
PLATFORMS = [
    {"name": "Platform A", "northing": 0.0, "easting": 0.0},
    {"name": "Platform B", "northing": 120.0, "easting": -200.0},
    {"name": "Platform C", "northing": -80.0, "easting": 250.0},
]

# Well slot assignments — each well is drilled from a platform slot
WELL_CONFIGS = [
    # Platform A — central platform, 12 wells fanning out
    {"name": "F-1",  "platform": "Platform A", "target_az": 0,   "target_dist": 800,  "td": 3200, "curve": "J"},
    {"name": "F-2",  "platform": "Platform A", "target_az": 30,  "target_dist": 1200, "td": 3800, "curve": "S"},
    {"name": "F-3",  "platform": "Platform A", "target_az": 60,  "target_dist": 600,  "td": 2800, "curve": "J"},
    {"name": "F-4",  "platform": "Platform A", "target_az": 90,  "target_dist": 1500, "td": 4200, "curve": "S"},
    {"name": "F-5",  "platform": "Platform A", "target_az": 120, "target_dist": 900,  "td": 3400, "curve": "J"},
    {"name": "F-6",  "platform": "Platform A", "target_az": 150, "target_dist": 1100, "td": 3600, "curve": "S"},
    {"name": "F-7",  "platform": "Platform A", "target_az": 180, "target_dist": 700,  "td": 2900, "curve": "J"},
    {"name": "F-8",  "platform": "Platform A", "target_az": 210, "target_dist": 1300, "td": 4000, "curve": "S"},
    {"name": "F-9",  "platform": "Platform A", "target_az": 240, "target_dist": 1000, "td": 3500, "curve": "J"},
    {"name": "F-10", "platform": "Platform A", "target_az": 270, "target_dist": 850,  "td": 3100, "curve": "J"},
    {"name": "F-11", "platform": "Platform A", "target_az": 300, "target_dist": 1400, "td": 4100, "curve": "S"},
    {"name": "F-12", "platform": "Platform A", "target_az": 330, "target_dist": 950,  "td": 3300, "curve": "J"},

    # Platform B — 10 wells, tighter cluster
    {"name": "G-1",  "platform": "Platform B", "target_az": 45,  "target_dist": 700,  "td": 2800, "curve": "J"},
    {"name": "G-2",  "platform": "Platform B", "target_az": 90,  "target_dist": 1100, "td": 3600, "curve": "S"},
    {"name": "G-3",  "platform": "Platform B", "target_az": 135, "target_dist": 900,  "td": 3200, "curve": "J"},
    {"name": "G-4",  "platform": "Platform B", "target_az": 180, "target_dist": 1300, "td": 3900, "curve": "S"},
    {"name": "G-5",  "platform": "Platform B", "target_az": 225, "target_dist": 600,  "td": 2600, "curve": "J"},
    {"name": "G-6",  "platform": "Platform B", "target_az": 270, "target_dist": 1000, "td": 3400, "curve": "J"},
    {"name": "G-7",  "platform": "Platform B", "target_az": 315, "target_dist": 800,  "td": 3000, "curve": "S"},
    {"name": "G-8",  "platform": "Platform B", "target_az": 0,   "target_dist": 1200, "td": 3700, "curve": "S"},
    {"name": "G-9",  "platform": "Platform B", "target_az": 160, "target_dist": 1500, "td": 4300, "curve": "S"},
    {"name": "G-10", "platform": "Platform B", "target_az": 200, "target_dist": 500,  "td": 2400, "curve": "J"},

    # Platform C — 8 wells
    {"name": "H-1",  "platform": "Platform C", "target_az": 30,  "target_dist": 900,  "td": 3300, "curve": "J"},
    {"name": "H-2",  "platform": "Platform C", "target_az": 100, "target_dist": 1400, "td": 4000, "curve": "S"},
    {"name": "H-3",  "platform": "Platform C", "target_az": 170, "target_dist": 700,  "td": 2700, "curve": "J"},
    {"name": "H-4",  "platform": "Platform C", "target_az": 240, "target_dist": 1100, "td": 3500, "curve": "S"},
    {"name": "H-5",  "platform": "Platform C", "target_az": 310, "target_dist": 1000, "td": 3200, "curve": "J"},
    {"name": "H-6",  "platform": "Platform C", "target_az": 60,  "target_dist": 1600, "td": 4500, "curve": "S"},
    {"name": "H-7",  "platform": "Platform C", "target_az": 200, "target_dist": 800,  "td": 3000, "curve": "J"},
    {"name": "H-8",  "platform": "Platform C", "target_az": 280, "target_dist": 1200, "td": 3800, "curve": "S"},
]

# Well colors — distinct colors for easy visual identification
WELL_COLORS = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
    "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
    "#F0B27A", "#82E0AA", "#F1948A", "#85929E", "#73C6B6",
    "#E59866", "#5DADE2", "#58D68D", "#AF7AC5", "#EB984E",
    "#48C9B0", "#F4D03F", "#CD6155", "#5499C7", "#52BE80",
    "#DC7633", "#2ECC71", "#E74C3C", "#3498DB", "#9B59B6",
]

# ── Drilling Event Templates ──
EVENT_TEMPLATES = [
    {"type": "stuck_pipe", "severity": "critical", "desc": "Differential sticking at {md:.0f}m MD. Required jarring operations."},
    {"type": "mud_losses", "severity": "warning", "desc": "Partial mud losses ({loss:.0f} bbl/hr) at {md:.0f}m MD. LCM treatment applied."},
    {"type": "mud_losses", "severity": "critical", "desc": "Total mud losses at {md:.0f}m MD. Lost {loss:.0f} bbl before regaining circulation."},
    {"type": "kick", "severity": "critical", "desc": "Gas kick detected at {md:.0f}m MD. Well shut in, circulated out."},
    {"type": "tight_hole", "severity": "warning", "desc": "Tight hole at {md:.0f}m MD. Required reaming and wiper trip."},
    {"type": "wellbore_instability", "severity": "warning", "desc": "Shale instability observed at {md:.0f}m MD. Increased mud weight to {mw:.1f} ppg."},
    {"type": "equipment_failure", "severity": "warning", "desc": "MWD tool failure at {md:.0f}m MD. Tripped for replacement."},
    {"type": "gas_influx", "severity": "warning", "desc": "Background gas increase to {gas:.0f} units at {md:.0f}m MD."},
    {"type": "casing_wear", "severity": "warning", "desc": "Casing wear detected at {md:.0f}m MD. Caliper log shows {wear:.1f}% wall loss."},
    {"type": "formation_pressure", "severity": "critical", "desc": "Abnormal pressure encountered at {md:.0f}m MD. Pore pressure {pp:.1f} ppg."},
]

# ── Casing Program ──
def generate_casing_program(td_md: float, td_tvd: float) -> list:
    """Generate a realistic casing program for a well."""
    casings = []

    # Conductor — always shallow
    conductor_shoe_md = random.uniform(50, 80)
    casings.append({
        "name": "Conductor",
        "od_inches": 30,
        "shoe_md": round(conductor_shoe_md, 1),
        "shoe_tvd": round(conductor_shoe_md, 1),  # Vertical at this depth
        "color": "#888888"
    })

    # Surface casing — set below any shallow hazards
    surface_shoe_md = random.uniform(400, 600)
    surface_shoe_tvd = round(surface_shoe_md * random.uniform(0.95, 1.0), 1)
    casings.append({
        "name": "Surface",
        "od_inches": 20,
        "shoe_md": round(surface_shoe_md, 1),
        "shoe_tvd": surface_shoe_tvd,
        "color": "#E74C3C"  # Red
    })

    # Intermediate casing
    int_shoe_md = random.uniform(td_md * 0.45, td_md * 0.6)
    int_shoe_tvd = round(int_shoe_md * random.uniform(0.75, 0.9), 1)
    casings.append({
        "name": "Intermediate",
        "od_inches": 13.375,
        "shoe_md": round(int_shoe_md, 1),
        "shoe_tvd": int_shoe_tvd,
        "color": "#3498DB"  # Blue
    })

    # Production casing/liner
    prod_shoe_md = td_md - random.uniform(20, 100)
    prod_shoe_tvd = td_tvd - random.uniform(10, 60)
    casings.append({
        "name": "Production",
        "od_inches": 9.625,
        "shoe_md": round(prod_shoe_md, 1),
        "shoe_tvd": round(prod_shoe_tvd, 1),
        "color": "#2ECC71"  # Green
    })

    return casings


def generate_events(td_md: float) -> list:
    """Generate 0-4 realistic drilling events for a well."""
    n_events = random.choices([0, 1, 2, 3, 4], weights=[15, 30, 30, 15, 10])[0]
    events = []

    for _ in range(n_events):
        template = random.choice(EVENT_TEMPLATES)
        md = random.uniform(td_md * 0.2, td_md * 0.9)

        desc = template["desc"].format(
            md=md,
            loss=random.uniform(10, 200),
            mw=random.uniform(10, 16),
            gas=random.uniform(50, 500),
            wear=random.uniform(5, 25),
            pp=random.uniform(11, 17),
        )

        events.append({
            "md": round(md, 1),
            "tvd": 0,  # Will be filled in after trajectory generation
            "type": template["type"],
            "severity": template["severity"],
            "description": desc
        })

    # Sort by MD
    events.sort(key=lambda e: e["md"])
    return events


# ── Trajectory Generation (Minimum Curvature) ──
def generate_trajectory(config: dict, platform: dict) -> list:
    """
    Generate a realistic 3D well trajectory using the minimum curvature method.

    For J-curve: vertical → build → hold tangent to TD
    For S-curve: vertical → build → hold → drop → vertical/low-angle to TD
    """
    td_md = config["td"]
    target_az = config["target_az"] + random.uniform(-5, 5)  # slight randomness
    target_dist = config["target_dist"] + random.uniform(-50, 50)
    curve_type = config["curve"]

    # Survey station spacing
    station_spacing = 30.0  # meters

    # Build rate: 2-4 deg/30m (realistic)
    build_rate = random.uniform(2.0, 4.0)  # deg per station_spacing

    # Kick-off depth (below surface casing)
    kop = random.uniform(500, 700)

    # Maximum inclination
    if curve_type == "J":
        max_inc = random.uniform(30, 75)
    else:  # S-curve
        max_inc = random.uniform(40, 80)

    # Generate survey stations as (MD, inclination, azimuth)
    surveys = []
    md = 0
    inc = 0
    az = target_az

    # Phase 1: Vertical section (surface to KOP)
    while md < kop:
        surveys.append((md, 0.0, az))
        md += station_spacing

    # Phase 2: Build section
    build_end_md = md
    while inc < max_inc and md < td_md * 0.6:
        inc = min(inc + build_rate, max_inc)
        # Add slight azimuth walk (realistic)
        az += random.uniform(-0.5, 0.5)
        surveys.append((md, inc, az))
        md += station_spacing
        build_end_md = md

    if curve_type == "J":
        # Phase 3 (J-curve): Hold tangent to TD
        while md < td_md:
            # Slight natural variation
            inc += random.uniform(-0.3, 0.3)
            inc = max(0, min(inc, 90))
            az += random.uniform(-0.3, 0.3)
            surveys.append((md, inc, az))
            md += station_spacing
    else:
        # Phase 3 (S-curve): Hold tangent
        hold_end = td_md * random.uniform(0.55, 0.7)
        while md < hold_end:
            inc += random.uniform(-0.3, 0.3)
            inc = max(0, min(inc, 90))
            az += random.uniform(-0.3, 0.3)
            surveys.append((md, inc, az))
            md += station_spacing

        # Phase 4 (S-curve): Drop section
        drop_rate = random.uniform(2.0, 3.5)
        target_final_inc = random.uniform(0, 15)
        while inc > target_final_inc and md < td_md * 0.9:
            inc = max(inc - drop_rate, target_final_inc)
            az += random.uniform(-0.3, 0.3)
            surveys.append((md, inc, az))
            md += station_spacing

        # Phase 5 (S-curve): Final tangent to TD
        while md < td_md:
            inc += random.uniform(-0.2, 0.2)
            inc = max(0, min(inc, 90))
            az += random.uniform(-0.2, 0.2)
            surveys.append((md, inc, az))
            md += station_spacing

    # Add final TD station
    surveys.append((td_md, inc, az))

    # ── Convert survey stations to 3D coordinates using minimum curvature ──
    trajectory = []
    tvd = -KB_ELEVATION  # Start at KB (above sea level, so negative depth)
    northing = platform["northing"]
    easting = platform["easting"]

    for i, (s_md, s_inc, s_az) in enumerate(surveys):
        if i == 0:
            trajectory.append({
                "md": round(s_md, 1),
                "tvd": round(tvd, 2),
                "northing": round(northing, 2),
                "easting": round(easting, 2),
                "inclination": round(s_inc, 2),
                "azimuth": round(s_az % 360, 2),
            })
            continue

        prev_md, prev_inc, prev_az = surveys[i - 1]
        delta_md = s_md - prev_md

        # Convert to radians
        i1 = math.radians(prev_inc)
        a1 = math.radians(prev_az)
        i2 = math.radians(s_inc)
        a2 = math.radians(s_az)

        # Dogleg angle
        cos_dl = math.cos(i2 - i1) - math.sin(i1) * math.sin(i2) * (1 - math.cos(a2 - a1))
        cos_dl = max(-1, min(1, cos_dl))
        dl = math.acos(cos_dl)

        # Ratio factor (minimum curvature)
        if dl < 1e-7:
            rf = 1.0
        else:
            rf = 2.0 / dl * math.tan(dl / 2.0)

        # Increments
        delta_tvd = (delta_md / 2.0) * (math.cos(i1) + math.cos(i2)) * rf
        delta_n = (delta_md / 2.0) * (math.sin(i1) * math.cos(a1) + math.sin(i2) * math.cos(a2)) * rf
        delta_e = (delta_md / 2.0) * (math.sin(i1) * math.sin(a1) + math.sin(i2) * math.sin(a2)) * rf

        tvd += delta_tvd
        northing += delta_n
        easting += delta_e

        trajectory.append({
            "md": round(s_md, 1),
            "tvd": round(tvd, 2),
            "northing": round(northing, 2),
            "easting": round(easting, 2),
            "inclination": round(s_inc, 2),
            "azimuth": round(s_az % 360, 2),
        })

    return trajectory


def interpolate_tvd_at_md(trajectory: list, target_md: float) -> float:
    """Interpolate TVD at a given MD along the trajectory."""
    if target_md <= trajectory[0]["md"]:
        return trajectory[0]["tvd"]
    if target_md >= trajectory[-1]["md"]:
        return trajectory[-1]["tvd"]

    for i in range(1, len(trajectory)):
        if trajectory[i]["md"] >= target_md:
            prev = trajectory[i - 1]
            curr = trajectory[i]
            frac = (target_md - prev["md"]) / (curr["md"] - prev["md"])
            return prev["tvd"] + frac * (curr["tvd"] - prev["tvd"])

    return trajectory[-1]["tvd"]


def main():
    platform_lookup = {p["name"]: p for p in PLATFORMS}

    wells = []
    for i, config in enumerate(WELL_CONFIGS):
        platform = platform_lookup[config["platform"]]

        # Generate trajectory
        trajectory = generate_trajectory(config, platform)

        # Generate casing program
        td_tvd = trajectory[-1]["tvd"]
        casings = generate_casing_program(config["td"], td_tvd)

        # Generate drilling events
        events = generate_events(config["td"])
        # Fill in TVD for events
        for event in events:
            event["tvd"] = round(interpolate_tvd_at_md(trajectory, event["md"]), 1)

        well = {
            "name": config["name"],
            "platform": config["platform"],
            "surface_northing": round(platform["northing"], 2),
            "surface_easting": round(platform["easting"], 2),
            "kb_elevation": KB_ELEVATION,
            "water_depth": WATER_DEPTH,
            "td_md": config["td"],
            "td_tvd": round(td_tvd, 1),
            "trajectory": trajectory,
            "casings": casings,
            "events": events,
            "color": WELL_COLORS[i % len(WELL_COLORS)],
        }
        wells.append(well)

    dataset = {
        "field_name": FIELD_NAME,
        "platforms": PLATFORMS,
        "wells": wells
    }

    # Write output
    output_path = os.path.join(os.path.dirname(__file__), "public", "data", "volve_wells.json")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w") as f:
        json.dump(dataset, f, indent=2)

    # Stats
    total_points = sum(len(w["trajectory"]) for w in wells)
    total_events = sum(len(w["events"]) for w in wells)
    print(f"Generated {len(wells)} wells across {len(PLATFORMS)} platforms")
    print(f"  Total trajectory points: {total_points}")
    print(f"  Total drilling events: {total_events}")
    print(f"  Output: {output_path}")


if __name__ == "__main__":
    main()
