#!/usr/bin/env python3
"""
Convert F3 Netherlands seismic data from NumPy to binary format for web viewer.

This script processes the F3 seismic data from the Zenodo download and creates
a downsampled binary file suitable for loading in a web browser.

Usage:
    python convert_seismic.py [--subsample N]
    
The output is a binary file with:
    - 12 bytes header: nx (int32), ny (int32), nz (int32)
    - Followed by float32 seismic amplitudes in inline-major order
"""

import numpy as np
import os
import sys
import argparse

def load_npy_data(data_dir: str) -> np.ndarray:
    """Load the seismic data from NumPy files."""
    train_path = os.path.join(data_dir, 'train', 'train_seismic.npy')
    
    if os.path.exists(train_path):
        print(f"Loading: {train_path}")
        data = np.load(train_path)
        print(f"Loaded shape: {data.shape}")
        return data
    
    # Try alternative paths
    alt_paths = [
        os.path.join(data_dir, 'seismic.npy'),
        os.path.join(data_dir, 'f3_seismic.npy'),
    ]
    
    for path in alt_paths:
        if os.path.exists(path):
            print(f"Loading: {path}")
            return np.load(path)
    
    raise FileNotFoundError(f"Could not find seismic data in {data_dir}")


def normalize_data(data: np.ndarray) -> np.ndarray:
    """Normalize data to -1 to 1 range."""
    # Use percentile clipping to handle outliers
    p1, p99 = np.percentile(data, [1, 99])
    data_clipped = np.clip(data, p1, p99)
    
    # Normalize to -1, 1
    data_min = data_clipped.min()
    data_max = data_clipped.max()
    
    if data_max - data_min > 0:
        normalized = 2 * (data_clipped - data_min) / (data_max - data_min) - 1
    else:
        normalized = np.zeros_like(data_clipped)
    
    return normalized.astype(np.float32)


def subsample_data(data: np.ndarray, factor: int) -> np.ndarray:
    """Subsample data by the given factor in each dimension."""
    if factor <= 1:
        return data
    
    return data[::factor, ::factor, ::factor]


def save_binary(data: np.ndarray, output_path: str):
    """Save data in binary format for web loading."""
    nx, ny, nz = data.shape
    
    print(f"Saving: {output_path}")
    print(f"Dimensions: {nx} x {ny} x {nz} = {data.size:,} samples")
    print(f"File size: {(12 + data.size * 4) / 1024 / 1024:.1f} MB")
    
    with open(output_path, 'wb') as f:
        # Write header
        header = np.array([nx, ny, nz], dtype=np.int32)
        header.tofile(f)
        
        # Write data in inline-major order (already the default for NumPy)
        data.tofile(f)
    
    print("Done!")


def main():
    parser = argparse.ArgumentParser(description='Convert F3 seismic data to web format')
    parser.add_argument('--data-dir', type=str, default='public/data/data',
                        help='Path to extracted data directory')
    parser.add_argument('--output', type=str, default='public/data/seismic_f3_subset.bin',
                        help='Output binary file path')
    parser.add_argument('--subsample', type=int, default=2,
                        help='Subsampling factor (1 = no subsampling, 2 = half resolution, etc)')
    
    args = parser.parse_args()
    
    # Load data
    try:
        data = load_npy_data(args.data_dir)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        print("Make sure to unzip the downloaded data.zip first!")
        sys.exit(1)
    
    # Process
    print(f"\nOriginal shape: {data.shape}")
    
    # Subsample
    data = subsample_data(data, args.subsample)
    print(f"After subsampling ({args.subsample}x): {data.shape}")
    
    # Normalize
    data = normalize_data(data)
    
    # Save
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    save_binary(data, args.output)


if __name__ == '__main__':
    main()
