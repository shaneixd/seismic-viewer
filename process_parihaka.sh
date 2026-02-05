#!/bin/bash
set -e

# Configuration
# Parihaka PSTM Full Angle Stack (4.7GB)
URL="http://s3.amazonaws.com/open.source.geoscience/open_data/newzealand/Taranaiki_Basin/PARIHAKA-3D/Parihaka_PSTM_full_angle.sgy"
SEGY_FILE="public/data/parihaka_full.sgy"
NPY_FILE="public/data/parihaka_npy/seismic.npy"
OUTPUT_BIN="public/data/parihaka_full.bin"
TEMP_DIR="public/data/parihaka_npy"

mkdir -p public/data
mkdir -p "$TEMP_DIR"

# 1. Download
if [ ! -f "$SEGY_FILE" ]; then
    echo "1. Downloading Parihaka dataset (4.7GB)... (This may take a while)"
    curl -L -o "$SEGY_FILE" "$URL"
else
    echo "1. File $SEGY_FILE already exists. Skipping download."
fi

# 2. Convert SEG-Y to NPY
if [ ! -f "$NPY_FILE" ]; then
    echo "2. Converting SEG-Y to NPY..."
    python3 convert_segy_to_npy.py --input "$SEGY_FILE" --output "$NPY_FILE"
else
    echo "2. NPY file exists. Skipping conversion."
fi

# 3. Convert to Viewer BIN
# We use subsample=2 to reduce size (approx 1/8th of 4.7GB ~ 600MB, which is loadable)
# If 600MB is too heavy, we can try 3 later.
echo "3. Converting to Web Binary (Subsample 2x)..."
python3 convert_seismic.py --data-dir "$TEMP_DIR" --output "$OUTPUT_BIN" --subsample 2

# 4. Cleanup option (commented out for now to allow re-running steps)
# rm "$SEGY_FILE"
# rm -rf "$TEMP_DIR"

echo "Done! created $OUTPUT_BIN"
