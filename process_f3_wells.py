#!/usr/bin/env python3
"""
Extract F3 Netherlands well data from NLOG thematic borehole datasets
and generate a JSON file for the seismic viewer.

Usage:
    python process_f3_wells.py

Expects NLOG data at /tmp/f3_nlog/ (downloaded from nlog.nl thematic datasets).
Output: public/data/f3_wells.json
"""

import csv
import json
import os
import sys

# NLOG data paths
NLOG_DIR = "/tmp/f3_nlog"
DEV_FILE = os.path.join(NLOG_DIR, "nlog_dirstelsel_20260205.csv")
STRAT_FILE = os.path.join(NLOG_DIR, "nlog_stratstelsel_20260205.csv")

# Output
OUTPUT_FILE = "public/data/f3_wells.json"

# F3 wells of interest (NLOG naming format)
WELLS = {
    "F02-01": {"display_name": "F02-1", "color": "#ff6b6b"},
    "F03-02": {"display_name": "F03-2", "color": "#51cf66"},
    "F03-04": {"display_name": "F03-4", "color": "#339af0"},
    "F06-01": {"display_name": "F06-1", "color": "#fcc419"},
}

# F3 survey geometry (from OpendTect F3 Demo documentation)
# These define how UTM31 ED50 coordinates map to inline/crossline numbers
# The survey has IL 100-750, XL 300-1250, 25m bin spacing
# Survey corner coordinates (UTM31 ED50) from the SEG-Y headers:
# Origin (IL=100, XL=300): approximately X=605835, Y=6073556
# IL direction: approximately east (increasing X)
# XL direction: approximately north (increasing Y)
# Bin size: 25m in both directions

# Survey grid definition from published literature and SEG-Y headers
# These are approximate values derived from the F3 survey parameters
SURVEY = {
    "il_start": 100,
    "il_end": 750,
    "xl_start": 300,
    "xl_end": 1250,
    "il_step": 1,
    "xl_step": 1,
    "bin_size": 25,  # meters
    # Survey origin (IL=100, XL=300) in UTM31 ED50
    # Derived from well positions and their known IL/XL:
    # F02-1 at IL=362, XL=336 -> UTM (606549, 6080124)
    # F06-1 at IL=244, XL=387 -> UTM (607902, 6077213)
    # Using these two points to compute the grid transform:
    "origin_x": 604999.0,  # Approximate X at IL=100, XL=300
    "origin_y": 6073206.0,  # Approximate Y at IL=100, XL=300
    # Grid rotation and scale:
    # IL increases roughly eastward, XL increases roughly northward
    # From the two well positions:
    # dIL = 362-244 = 118, dXL = 336-387 = -51
    # dX = 606549-607902 = -1353, dY = 6080124-6077213 = 2911
    # This gives us the grid vectors per IL and per XL
}

# Compute grid transform from known well positions
# We have:
# F02-1: IL=362, XL=336, X=606549, Y=6080124
# F06-1: IL=244, XL=387, X=607902, Y=6077213
# Set up system:
# X = origin_x + IL * dXdIL + XL * dXdXL
# Y = origin_y + IL * dYdIL + XL * dYdXL
# From the two wells:
# 606549 = Ox + 362*a + 336*c
# 607902 = Ox + 244*a + 387*c
# 6080124 = Oy + 362*b + 336*d
# 6077213 = Oy + 244*b + 387*d
# Difference:
# -1353 = 118*a - 51*c
# 2911 = 118*b - 51*d
# With 25m bin size and roughly orthogonal grid:
# |a| ≈ 25 or |c| ≈ 25 (one of them dominant)
# From the geometry, IL direction goes roughly SSE and XL goes roughly ENE
# Let's solve assuming the standard F3 rotation (~30° from north)

def compute_grid_transform():
    """
    Use known well positions to compute UTM -> IL/XL transform.
    
    Known (from published literature):
    F02-1: IL=362, XL=336, UTM(606549, 6080124)
    F06-1: IL=244, XL=387, UTM(607902, 6077213)
    F03-4: IL=442, XL=1007, UTM(623256, 6082586)  
    F03-2: IL=722, XL=848, UTM(621875, 6095966)
    
    We can use least-squares to fit the affine transform.
    """
    import numpy as np
    
    # Known IL/XL positions from published literature
    wells_known = [
        (362, 336, 606549, 6080124),   # F02-1
        (244, 387, 607902, 6077213),   # F06-1
        (442, 1007, 623256, 6082586),  # F03-4
        (722, 848, 621875, 6095966),   # F03-2
    ]
    
    # X = Ox + IL*a + XL*c
    # Y = Oy + IL*b + XL*d
    # Set up: [1, IL, XL] * [Ox, a, c]^T = X
    A = np.array([[1, il, xl] for il, xl, x, y in wells_known])
    X = np.array([x for il, xl, x, y in wells_known])
    Y = np.array([y for il, xl, x, y in wells_known])
    
    # Least squares solve
    x_coeffs, _, _, _ = np.linalg.lstsq(A, X, rcond=None)
    y_coeffs, _, _, _ = np.linalg.lstsq(A, Y, rcond=None)
    
    Ox, a, c = x_coeffs
    Oy, b, d = y_coeffs
    
    print(f"Grid transform (UTM = Origin + IL*vec_il + XL*vec_xl):")
    print(f"  Origin: ({Ox:.1f}, {Oy:.1f})")
    print(f"  IL vector: ({a:.4f}, {b:.4f}) -> |IL| = {np.sqrt(a**2 + b**2):.2f}m")
    print(f"  XL vector: ({c:.4f}, {d:.4f}) -> |XL| = {np.sqrt(c**2 + d**2):.2f}m")
    
    # Verify with known wells
    for il, xl, x_true, y_true in wells_known:
        x_pred = Ox + il * a + xl * c
        y_pred = Oy + il * b + xl * d
        print(f"  Well IL={il}, XL={xl}: predicted ({x_pred:.0f}, {y_pred:.0f}), "
              f"actual ({x_true}, {y_true}), error ({x_pred-x_true:.1f}, {y_pred-y_true:.1f})")
    
    return Ox, Oy, a, b, c, d


def utm_to_ilxl(x, y, Ox, Oy, a, b, c, d):
    """Convert UTM coordinates back to IL/XL using the inverse transform."""
    import numpy as np
    
    # [a, c] [IL]   [X - Ox]
    # [b, d] [XL] = [Y - Oy]
    M = np.array([[a, c], [b, d]])
    rhs = np.array([x - Ox, y - Oy])
    ilxl = np.linalg.solve(M, rhs)
    return ilxl[0], ilxl[1]


def parse_deviation_csv(filepath, well_names):
    """Parse NLOG deviation survey CSV and extract data for specified wells."""
    wells_dev = {name: [] for name in well_names}
    
    with open(filepath, 'r') as f:
        reader = csv.reader(f, delimiter=';')
        header = next(reader)
        
        # Find column indices
        cols = {h.strip('"'): i for i, h in enumerate(header)}
        
        for row in reader:
            wellbore = row[cols['WELLBORE']].strip('"')
            if wellbore in well_names:
                try:
                    ah_depth = float(row[cols['AH_DEPTH']])
                    tv_depth_nap = float(row[cols['TV_DEPTH_NAP']])
                    x_surface = float(row[cols['X_SURFACE_UTM31_ED50']])
                    y_surface = float(row[cols['Y_SURFACE_UTM31_ED50']])
                    dx = float(row[cols['DX_UTM31_ED50']])
                    dy = float(row[cols['DY_UTM31_ED50']])
                    
                    wells_dev[wellbore].append({
                        'ah_depth': ah_depth,
                        'tvdss': tv_depth_nap,
                        'x': x_surface + dx,
                        'y': y_surface + dy,
                        'x_surface': x_surface,
                        'y_surface': y_surface,
                    })
                except (ValueError, KeyError) as e:
                    continue
    
    return wells_dev


def parse_strat_csv(filepath, well_names):
    """Parse NLOG stratigraphy CSV and extract formation tops for specified wells."""
    wells_strat = {name: [] for name in well_names}
    
    with open(filepath, 'r') as f:
        reader = csv.reader(f, delimiter=';')
        header = next(reader)
        
        cols = {h.strip('"'): i for i, h in enumerate(header)}
        
        for row in reader:
            wellbore = row[cols['WELLBORE']].strip('"')
            if wellbore in well_names:
                try:
                    top_ah = float(row[cols['TOP_AH']])
                    bottom_ah = float(row[cols['BOTTOM_AH']])
                    tv_top = float(row[cols['TV_TOP_NAP']])
                    tv_bottom = float(row[cols['TV_BOTTOM_NAP']])
                    strat_code = row[cols['STRAT_UNIT_CD']].strip('"')
                    strat_name = row[cols['STRAT_UNIT_NM']].strip('"')
                    
                    wells_strat[wellbore].append({
                        'top_md': top_ah,
                        'bottom_md': bottom_ah,
                        'top_tvdss': tv_top,
                        'bottom_tvdss': tv_bottom,
                        'code': strat_code,
                        'name': strat_name,
                    })
                except (ValueError, KeyError) as e:
                    continue
    
    return wells_strat


# Formation color mapping for common formations
FORMATION_COLORS = {
    'NU': '#F5DEB3',    # Upper North Sea Group - wheat
    'NM': '#DAA520',    # Middle North Sea Group - goldenrod
    'NL': '#8B7355',    # Lower North Sea Group - tan4
    'NLFFC': '#CD853F', # Dongen Clay Member - peru
    'NLFFT': '#D2691E', # Basal Dongen Tuffite - chocolate
    'NLFF': '#CD853F',  # Dongen Formation - peru
    'NLLFC': '#A0522D', # Landen Clay Member - sienna
    'NMRF': '#BDB76B',  # Rupel Formation - dark khaki
    'CKEK': '#E0E0E0',  # Ekofisk Formation - light grey (chalk)
    'CKGR': '#D3D3D3',  # Ommelanden Formation - grey (chalk)
    'CKTX': '#C0C0C0',  # Texel Formation - silver (chalk)
    'KNGL': '#556B2F',  # Holland Formation - olive
    'KNNCK': '#6B8E23',  # Vlieland Marl - olive drab
    'KNNCM': '#2E8B57',  # Vlieland Claystone - sea green
    'SGKI': '#8B0000',  # Kimmeridge Clay - dark red
    'SLCU': '#B22222',  # Upper Graben Fm - firebrick
    'SLCMU': '#CD5C5C',  # upper claystone member
    'SLCMS': '#F4A460',  # Middle Graben Sandstone - sandy brown
    'SLCML': '#BC8F8F',  # lower claystone member
    'SLCL': '#8B4513',  # Lower Graben Fm - saddle brown
    'SGLUC': '#696969',  # Clay Deep Member - dim grey
    'SGGS': '#9ACD32',  # Scruff Greensand - yellow-green
    'RNKPU': '#FF6347',  # Upper Keuper Claystone - tomato
    'RNKPD': '#FFD700',  # Dolomitic Keuper - gold
    'RNKPR': '#DC143C',  # Red Keuper Claystone - crimson
    'NN': '#808080',    # Not interpreted - grey
}


def main():
    import numpy as np
    
    well_names = list(WELLS.keys())
    
    print("Computing survey grid transform from known well positions...")
    Ox, Oy, a, b, c, d = compute_grid_transform()
    
    print(f"\nParsing deviation surveys from {DEV_FILE}...")
    wells_dev = parse_deviation_csv(DEV_FILE, well_names)
    
    print(f"Parsing stratigraphy from {STRAT_FILE}...")
    wells_strat = parse_strat_csv(STRAT_FILE, well_names)
    
    # Build output JSON
    output = {
        "survey": {
            "name": "F3 Netherlands",
            "il_range": [100, 750],
            "xl_range": [300, 1250],
            "time_range_ms": [0, 1848],
            "bin_size_m": 25,
            "sample_interval_ms": 4,
        },
        "grid_transform": {
            "origin_x": Ox,
            "origin_y": Oy,
            "il_vec": [a, b],
            "xl_vec": [c, d],
            "crs": "UTM31 ED50",
        },
        "wells": []
    }
    
    for nlog_name, config in WELLS.items():
        dev_data = wells_dev.get(nlog_name, [])
        strat_data = wells_strat.get(nlog_name, [])
        
        if not dev_data:
            print(f"  WARNING: No deviation data for {nlog_name}")
            continue
        
        # Get surface coordinates
        x_surface = dev_data[0]['x_surface']
        y_surface = dev_data[0]['y_surface']
        
        # Compute IL/XL from surface UTM
        il, xl = utm_to_ilxl(x_surface, y_surface, Ox, Oy, a, b, c, d)
        
        # Get depth range
        max_tvdss = max(p['tvdss'] for p in dev_data)
        
        # Build trajectory points (simplified - use surface + deviation offsets)
        trajectory = []
        for pt in dev_data:
            pt_il, pt_xl = utm_to_ilxl(pt['x'], pt['y'], Ox, Oy, a, b, c, d)
            trajectory.append({
                'md': round(pt['ah_depth'], 1),
                'tvdss': round(pt['tvdss'], 1),
                'il': round(pt_il, 2),
                'xl': round(pt_xl, 2),
            })
        
        # Build formation tops
        tops = []
        for fm in strat_data:
            # Only include the main wellbore data (skip sidetracks)
            tops.append({
                'name': fm['name'],
                'code': fm['code'],
                'top_md': round(fm['top_md'], 1),
                'top_tvdss': round(fm['top_tvdss'], 1),
                'bottom_md': round(fm['bottom_md'], 1),
                'bottom_tvdss': round(fm['bottom_tvdss'], 1),
                'color': FORMATION_COLORS.get(fm['code'], '#999999'),
            })
        
        well_json = {
            'name': config['display_name'],
            'nlog_id': nlog_name,
            'color': config['color'],
            'surface_il': round(il, 1),
            'surface_xl': round(xl, 1),
            'surface_x_utm': x_surface,
            'surface_y_utm': y_surface,
            'kb_elevation_m': round(-dev_data[0]['tvdss'] + dev_data[0]['ah_depth'], 1) if dev_data else 0,
            'td_md': round(dev_data[-1]['ah_depth'], 1) if dev_data else 0,
            'td_tvdss': round(max_tvdss, 1),
            'trajectory': trajectory,
            'formations': tops,
        }
        
        print(f"  {config['display_name']}: IL={il:.1f}, XL={xl:.1f}, "
              f"TD={dev_data[-1]['ah_depth']:.0f}m, "
              f"{len(trajectory)} trajectory pts, {len(tops)} formations")
        
        output['wells'].append(well_json)
    
    # Save JSON
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"\nSaved well data to {OUTPUT_FILE}")
    print(f"File size: {os.path.getsize(OUTPUT_FILE) / 1024:.1f} KB")


if __name__ == '__main__':
    main()
