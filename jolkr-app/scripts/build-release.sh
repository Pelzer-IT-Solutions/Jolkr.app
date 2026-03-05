#!/bin/bash
# =============================================================================
# Jolkr — Local Release Build Script
# Usage: ./scripts/build-release.sh [version]
# Requires: TAURI_SIGNING_PRIVATE_KEY env var or ../keys/jolkr-update.key
# =============================================================================

set -e

VERSION=${1:-$(node -p "require('./package.json').version")}
echo "Building Jolkr v${VERSION}..."

# Set signing key from file if not in environment
if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  KEY_FILE="../keys/jolkr-update.key"
  if [ ! -f "$KEY_FILE" ]; then
    echo "ERROR: No signing key found."
    echo "Either set TAURI_SIGNING_PRIVATE_KEY env var or place key at $KEY_FILE"
    echo "Generate with: npx tauri signer generate -w ../keys/jolkr-update.key"
    exit 1
  fi
  export TAURI_SIGNING_PRIVATE_KEY=$(cat "$KEY_FILE")
fi

# Build web assets
echo "Building web assets..."
npm run build:tauri

# Build Tauri (produces .exe + .sig)
echo "Building Tauri app..."
CARGO_HOME="C:/Users/philp/.cargo-tauri" npx tauri build

echo ""
echo "Build complete! Artifacts in src-tauri/target/release/bundle/"
echo "NSIS: src-tauri/target/release/bundle/nsis/"
echo "MSI:  src-tauri/target/release/bundle/msi/"
