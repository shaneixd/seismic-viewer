#!/usr/bin/env python3
"""
Extract 3D data from NPZ file and save as NPY for seismic viewer.
Specifically targets the 'p' array in Volve synthetic data.
"""

import numpy as np
import argparse
import sys
import os

def convert_npz(input_path, output_path):
    print(f"Opening NPZ file: {input_path}")
    
    try:
        f = np.load(input_path)
        print(f"  Keys: {f.files}")
        
        if 'imdd' in f.files:
            print("  Found 'imdd' (Migrated Image). This is likely 2D.")
            data = f['imdd']
            print(f"  Shape: {data.shape}") # (401, 551) likely (Inline, Time)
            
            # The viewer expects 3D (Inline, Crossline, Time).
            # We will "extrude" this 2D image to make a pseudo-3D volume.
            # Dimensions: (401, 551) -> (401, 1, 551) or similar.
            # Let's repeat it 50 times to make it sliceable in Crossline direction.
            
            n_crosslines = 50
            print(f"  Extruding to 3D with {n_crosslines} crosslines...")
            
            # data is (X, Z). We want (X, Y, Z).
            # Expand dims to (X, 1, Z) then repeat along axis 1
            data_3d = np.expand_dims(data, axis=1)
            data_3d = np.repeat(data_3d, n_crosslines, axis=1)
            
            print(f"  New shape: {data_3d.shape}")
            data = data_3d

        elif 'p' in f.files:
             # Case for Pre-stack data (Shot gathers) - fallback if needed
             print("  Found 'p' (Pre-stack). Warning: hyperbola distortion expected.")
             data = f['p']
             data = np.transpose(data, (0, 2, 1))

        else:
            print(f"  Error: neither 'imdd' nor 'p' found. Keys: {f.files}")
            sys.exit(1)
        print(f"  New shape: {data.shape}")
        
        # Ensure float32
        if data.dtype != np.float32:
            print(f"  Converting from {data.dtype} to float32...")
            data = data.astype(np.float32)
            
        print(f"Saving to {output_path}...")
        np.save(output_path, data)
        print("Done.")
            
    except Exception as e:
        print(f"Error converting NPZ: {e}")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description='Convert NPZ to NPY')
    parser.add_argument('--input', required=True, help='Input NPZ file path')
    parser.add_argument('--output', required=True, help='Output .npy file path')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f"Input file not found: {args.input}")
        sys.exit(1)
        
    convert_npz(args.input, args.output)

if __name__ == '__main__':
    main()
