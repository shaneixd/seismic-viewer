#!/bin/bash
set -e

# Configuration
# F3 Netherlands (Facies Benchmark Version)
# Source: Zenodo (Record 3755060)
URL="https://zenodo.org/record/3755060/files/data.zip"
ZIP_FILE="public/data/f3_zenodo.zip"
EXTRACT_DIR="public/data/f3_temp"
NPY_FILE="$EXTRACT_DIR/data.npy" # Hypothesized location based on script
OUTPUT_BIN="public/data/f3_highres.bin"

mkdir -p public/data
mkdir -p "$EXTRACT_DIR"

# 1. Download
if [ ! -f "$ZIP_FILE" ]; then
    echo "1. Downloading F3 Zenodo dataset..."
    curl -L -o "$ZIP_FILE" "$URL"
else
    echo "1. File $ZIP_FILE already exists. Skipping download."
fi

# 2. Unzip
echo "2. Unzipping..."
unzip -q -o "$ZIP_FILE" -d "$EXTRACT_DIR"

# 3. Find the NPY file
# The script said `temp_file=$(mktemp -d)/data.zip` then `unzip -d $1 ...`
# Structure might be `data.npy` or `test1_seismic.npy`...
# Let's list files to be sure, but we need to automate.
# We'll assume the largest NPY file is the seismic cube.
echo "3. Locating seismic volume..."
FOUND_NPY=$(find "$EXTRACT_DIR" -name "*.npy" -type f -exec ls -S {} + | head -n 1)

if [ -z "$FOUND_NPY" ]; then
    echo "Error: No NPY file found in zip."
    # Fallback: maybe it's npz?
    find "$EXTRACT_DIR" -ls
    exit 1
fi

echo "Found: $FOUND_NPY"

# 4. Convert to Viewer BIN
echo "4. Converting to Web Binary (Full Resolution)..."
# We need a temporary dir that contains ONLY the file we want, or pass explicit path to convert_seismic.
# convert_seismic.py currently takes a directory. 
# Let's fix convert_seismic.py to accept a single file or move this file to a clean dir.
CLEAN_DIR="public/data/f3_clean_npy"
mkdir -p "$CLEAN_DIR"
cp "$FOUND_NPY" "$CLEAN_DIR/seismic.npy"

python3 convert_seismic.py --data-dir "$CLEAN_DIR" --output "$OUTPUT_BIN" --subsample 1

# 5. Cleanup
rm -rf "$EXTRACT_DIR"
rm -rf "$CLEAN_DIR"
# rm "$ZIP_FILE" # Keep zip for cache

echo "Done! created $OUTPUT_BIN"
