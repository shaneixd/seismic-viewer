#!/usr/bin/env python3
"""
Convert seismic data into a bricked multi-resolution format for progressive web loading.

This creates a directory structure with:
- manifest.json: Metadata about the bricked volume
- level_N/: Directories for each resolution level
  - brick_X_Y_Z.bin: Individual brick files

Usage:
    python convert_to_bricks.py --input public/data/data/train/train_seismic.npy --output public/data/bricks
"""

import numpy as np
import os
import json
import argparse
from typing import Tuple, List, Dict
from dataclasses import dataclass, asdict


@dataclass
class BrickInfo:
    """Metadata for a single brick."""
    level: int
    x: int
    y: int
    z: int
    filename: str
    byte_size: int


@dataclass 
class LevelInfo:
    """Metadata for a resolution level."""
    level: int
    scale_factor: int
    dimensions: Tuple[int, int, int]
    brick_size: Tuple[int, int, int]
    num_bricks: Tuple[int, int, int]
    total_bricks: int


def normalize_data(data: np.ndarray) -> np.ndarray:
    """Normalize data to -1 to 1 range with percentile clipping."""
    p1, p99 = np.percentile(data, [1, 99])
    data_clipped = np.clip(data, p1, p99)
    
    data_min = data_clipped.min()
    data_max = data_clipped.max()
    
    if data_max - data_min > 0:
        normalized = 2 * (data_clipped - data_min) / (data_max - data_min) - 1
    else:
        normalized = np.zeros_like(data_clipped)
    
    return normalized.astype(np.float32)


def downsample_volume(data: np.ndarray, factor: int) -> np.ndarray:
    """Downsample volume by averaging blocks of voxels."""
    if factor <= 1:
        return data
    
    # Truncate to multiple of factor
    nx, ny, nz = data.shape
    nx = (nx // factor) * factor
    ny = (ny // factor) * factor
    nz = (nz // factor) * factor
    data = data[:nx, :ny, :nz]
    
    # Reshape and average
    new_shape = (nx // factor, factor, ny // factor, factor, nz // factor, factor)
    return data.reshape(new_shape).mean(axis=(1, 3, 5)).astype(np.float32)


def create_bricks(
    data: np.ndarray,
    output_dir: str,
    brick_size: Tuple[int, int, int] = (64, 64, 64),
    num_levels: int = 4
) -> Dict:
    """
    Create bricked multi-resolution volume.
    
    Args:
        data: 3D numpy array of seismic data
        output_dir: Directory to save bricks
        brick_size: Size of each brick (x, y, z)
        num_levels: Number of resolution levels
    
    Returns:
        Manifest dictionary with metadata
    """
    os.makedirs(output_dir, exist_ok=True)
    
    # Normalize the data once at full resolution
    print("Normalizing data...")
    data = normalize_data(data)
    
    original_shape = data.shape
    levels_info: List[LevelInfo] = []
    all_bricks: List[BrickInfo] = []
    
    current_data = data
    
    for level in range(num_levels):
        scale_factor = 2 ** level
        
        if level > 0:
            current_data = downsample_volume(data, scale_factor)
        
        nx, ny, nz = current_data.shape
        bx, by, bz = brick_size
        
        # Calculate number of bricks in each dimension
        num_bricks_x = (nx + bx - 1) // bx
        num_bricks_y = (ny + by - 1) // by
        num_bricks_z = (nz + bz - 1) // bz
        
        level_dir = os.path.join(output_dir, f"level_{level}")
        os.makedirs(level_dir, exist_ok=True)
        
        level_info = LevelInfo(
            level=level,
            scale_factor=scale_factor,
            dimensions=(nx, ny, nz),
            brick_size=brick_size,
            num_bricks=(num_bricks_x, num_bricks_y, num_bricks_z),
            total_bricks=num_bricks_x * num_bricks_y * num_bricks_z
        )
        levels_info.append(level_info)
        
        print(f"\nLevel {level} (1/{scale_factor}x resolution):")
        print(f"  Dimensions: {nx} x {ny} x {nz}")
        print(f"  Bricks: {num_bricks_x} x {num_bricks_y} x {num_bricks_z} = {level_info.total_bricks}")
        
        # Create bricks for this level
        brick_count = 0
        for ix in range(num_bricks_x):
            for iy in range(num_bricks_y):
                for iz in range(num_bricks_z):
                    # Calculate slice bounds
                    x0, x1 = ix * bx, min((ix + 1) * bx, nx)
                    y0, y1 = iy * by, min((iy + 1) * by, ny)
                    z0, z1 = iz * bz, min((iz + 1) * bz, nz)
                    
                    # Extract brick data
                    brick_data = current_data[x0:x1, y0:y1, z0:z1]
                    
                    # Pad to full brick size if needed
                    if brick_data.shape != brick_size:
                        padded = np.zeros(brick_size, dtype=np.float32)
                        padded[:brick_data.shape[0], :brick_data.shape[1], :brick_data.shape[2]] = brick_data
                        brick_data = padded
                    
                    # Save brick
                    filename = f"brick_{ix}_{iy}_{iz}.bin"
                    filepath = os.path.join(level_dir, filename)
                    
                    # Write with header: actual_size_x, actual_size_y, actual_size_z (for edge bricks)
                    with open(filepath, 'wb') as f:
                        header = np.array([x1 - x0, y1 - y0, z1 - z0], dtype=np.int32)
                        header.tofile(f)
                        brick_data.tofile(f)
                    
                    byte_size = os.path.getsize(filepath)
                    
                    brick_info = BrickInfo(
                        level=level,
                        x=ix, y=iy, z=iz,
                        filename=f"level_{level}/{filename}",
                        byte_size=byte_size
                    )
                    all_bricks.append(brick_info)
                    brick_count += 1
        
        print(f"  Created {brick_count} bricks")
    
    # Create manifest
    manifest = {
        "version": "1.0",
        "original_dimensions": list(original_shape),
        "brick_size": list(brick_size),
        "num_levels": num_levels,
        "levels": [asdict(l) for l in levels_info],
        "bricks": [asdict(b) for b in all_bricks],
        "total_size_bytes": sum(b.byte_size for b in all_bricks)
    }
    
    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    total_mb = manifest["total_size_bytes"] / 1024 / 1024
    print(f"\n✓ Created {len(all_bricks)} total bricks")
    print(f"✓ Total size: {total_mb:.1f} MB")
    print(f"✓ Manifest saved: {manifest_path}")
    
    return manifest


def main():
    parser = argparse.ArgumentParser(description='Convert seismic data to bricked format')
    parser.add_argument('--input', type=str, required=True,
                        help='Path to input .npy file')
    parser.add_argument('--output', type=str, default='public/data/bricks',
                        help='Output directory for bricks')
    parser.add_argument('--brick-size', type=int, default=64,
                        help='Size of each brick in each dimension')
    parser.add_argument('--levels', type=int, default=4,
                        help='Number of resolution levels')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f"Error: Input file not found: {args.input}")
        return 1
    
    print(f"Loading: {args.input}")
    data = np.load(args.input)
    print(f"Loaded shape: {data.shape}")
    
    brick_size = (args.brick_size, args.brick_size, args.brick_size)
    
    create_bricks(
        data=data,
        output_dir=args.output,
        brick_size=brick_size,
        num_levels=args.levels
    )
    
    return 0


if __name__ == '__main__':
    exit(main())
