#!/usr/bin/env python3
"""
Convert standard 3D SEG-Y file to NumPy .npy format.
Manual geometry reconstruction to handle files where segyio.tools.cube fails.
"""

import segyio
import numpy as np
import argparse
import sys
import os

def convert_segy(input_path, output_path):
    print(f"Opening SEG-Y file: {input_path}")
    
    try:
        # Open with strict=False and ignore_geometry=True to treat as a stream of traces
        with segyio.open(input_path, mode='r', ignore_geometry=True) as f:
            
            print("  Scanning headers to determine geometry...")
            
            # Map byte locations for Inline/Crossline (Standard 3D)
            # 189: Inline
            # 193: Crossline
            INLINE_BYTE = 189
            XLINE_BYTE = 193
            
            # Read all headers to find min/max
            # This is fast in segyio
            ilines = f.attributes(INLINE_BYTE)[:]
            xlines = f.attributes(XLINE_BYTE)[:]
            
            min_il, max_il = np.min(ilines), np.max(ilines)
            min_xl, max_xl = np.min(xlines), np.max(xlines)
            
            n_il = max_il - min_il + 1
            n_xl = max_xl - min_xl + 1
            n_samples = f.samples.size
            
            print(f"  Geometry detected:")
            print(f"    Inlines: {min_il} to {max_il} (Count: {n_il})")
            print(f"    Crosslines: {min_xl} to {max_xl} (Count: {n_xl})")
            print(f"    Samples: {n_samples}")
            
            total_traces = f.tracecount
            expected_traces = n_il * n_xl
            
            print(f"    Total traces in file: {total_traces}")
            print(f"    Expected traces (dense grid): {expected_traces}")
            
            if total_traces != expected_traces:
                print("    Note: File is sparse or has irregular geometry. Missing traces will be zero-filled.")
            
            # Allocate memory for the full cube
            # Beware of RAM usage! 
            # 4.7GB SEG-Y usually fits in 16GB RAM as float32.
            # (n_il * n_xl * n_samples * 4 bytes)
            cube_size_bytes = n_il * n_xl * n_samples * 4
            print(f"  Allocating {cube_size_bytes / (1024**3):.2f} GB for 3D volume...")
            
            data = np.zeros((n_il, n_xl, n_samples), dtype=np.float32)
            
            print("  Reading traces...")
            
            # Helper for progress
            milestone = total_traces // 10
            
            # Read traces and populate grid
            for i, trace in enumerate(f.trace):
                il = ilines[i]
                xl = xlines[i]
                
                # Map to 0-based index
                idx_il = il - min_il
                idx_xl = xl - min_xl
                
                # Safety check
                if 0 <= idx_il < n_il and 0 <= idx_xl < n_xl:
                    data[idx_il, idx_xl, :] = trace
                
                if i % milestone == 0 and i > 0:
                     print(f"    Processed {i}/{total_traces} traces ({(i/total_traces)*100:.1f}%)")

            print("  Reading complete.")
            
            print(f"Saving to {output_path}...")
            np.save(output_path, data)
            print("Done.")

    except Exception as e:
        print(f"Error reading SEG-Y: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description='Convert SEG-Y to NPY')
    parser.add_argument('--input', required=True, help='Input SEG-Y file path')
    parser.add_argument('--output', required=True, help='Output .npy file path')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f"Input file not found: {args.input}")
        sys.exit(1)
        
    convert_segy(args.input, args.output)

if __name__ == '__main__':
    main()
