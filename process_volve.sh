#!/bin/bash
set -e

# Configuration
ZIP_FILE="public/data/volve_synthetic.zip"
EXTRACT_DIR="public/data/volve_temp"
OUTPUT_BIN="public/data/volve_synthetic.bin"

# We assume data is already unzipped from previous run to save time
# But if directory doesn't exist, unzip.
if [ ! -d "$EXTRACT_DIR" ]; then
    echo "1. Unzipping data..."
    mkdir -p "$EXTRACT_DIR"
    unzip -q -o "$ZIP_FILE" -d "$EXTRACT_DIR"
else
    echo "1. Data already unzipped, skipping..."
fi

echo "2. Finding NPZ file..."
# We target Imaging/images.npz for the migrated image
NPZ_FILE="$EXTRACT_DIR/VolveSynthetic_ZenodoData/Imaging/images.npz"

if [ ! -f "$NPZ_FILE" ]; then
    echo "Error: NPZ file not found: $NPZ_FILE"
    exit 1
fi

echo "Found NPZ: $NPZ_FILE"

echo "3. Converting NPZ to NPY..."
# Helper NPY location
TEMP_NPY_DIR="public/data/volve_npy"
mkdir -p "$TEMP_NPY_DIR"
# convert_seismic.py looks for specific filenames inside the dir...
# It looks for 'train/train_seismic.npy', 'seismic.npy', 'f3_seismic.npy'
TEMP_NPY="$TEMP_NPY_DIR/seismic.npy"

python3 convert_npz_to_npy.py --input "$NPZ_FILE" --output "$TEMP_NPY"

echo "4. Converting NPY to Web Binary..."
# No subsampling needed if size is 180MB for 3D?
# (110*180*2351*4) = 186 MB.
# Browser can handle it, but maybe safer to subsample 2x in Time?
# Let's try subsample 1 (full res) first or subsample 2 if it's too heavy.
# Note: convert_seismic.py has --subsample argument.
# Let's do subsample=1 because 186MB is loadable.
python3 convert_seismic.py --data-dir "$TEMP_NPY_DIR" --output "$OUTPUT_BIN" --subsample 1

echo "5. Cleanup..."
rm -rf "$EXTRACT_DIR"
rm -rf "$TEMP_NPY_DIR"
rm "$ZIP_FILE"

echo "Done! created $OUTPUT_BIN"
