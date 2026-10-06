#!/usr/bin/env bash
set -euo pipefail

VERSION="314.0.7"
BASE="https://cdn.jsdelivr.net/pyodide/v${VERSION}/full"
DEST="public/vendor/pyodide"

mkdir -p "$DEST"

files=(
  pyodide.mjs
  pyodide.asm.mjs
  pyodide.asm.wasm
  python_stdlib.zip
  pyodide-lock.json
)

for file in "${files[@]}"; do
  tmp="$DEST/.$file.tmp"
  echo "Fetching Pyodide $VERSION: $file"
  curl -fL     --retry 4     --retry-delay 2     --retry-all-errors     --connect-timeout 20     --max-time 180     "$BASE/$file"     -o "$tmp"
  test -s "$tmp"
  mv "$tmp" "$DEST/$file"
done

echo "Pyodide core staged in $DEST"
du -sh "$DEST"
