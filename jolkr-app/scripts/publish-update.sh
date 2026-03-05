#!/bin/bash
# =============================================================================
# Jolkr — Publish Update to Nginx
# Usage: ./scripts/publish-update.sh <version> [notes]
# Copies build artifacts to nginx updates dir and generates manifest
# =============================================================================

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <version> [notes]"
  echo "Example: $0 0.2.0 \"Bug fixes and improvements\""
  exit 1
fi

VERSION=$1
NOTES=${2:-"Bug fixes and improvements"}
UPDATES_DIR="../jolkr-server/docker/updates"
INSTALLERS_DIR="$UPDATES_DIR/installers"

mkdir -p "$INSTALLERS_DIR"

# Find and copy NSIS installer + signature
NSIS_ZIP="src-tauri/target/release/bundle/nsis/Jolkr_${VERSION}_x64-setup.nsis.zip"
if [ ! -f "$NSIS_ZIP" ]; then
  echo "ERROR: NSIS installer not found at $NSIS_ZIP"
  echo "Run ./scripts/build-release.sh first"
  exit 1
fi

if [ ! -f "${NSIS_ZIP}.sig" ]; then
  echo "ERROR: Signature file not found at ${NSIS_ZIP}.sig"
  echo "Make sure TAURI_SIGNING_PRIVATE_KEY was set during build"
  exit 1
fi

echo "Copying installer and signature..."
cp "$NSIS_ZIP" "$INSTALLERS_DIR/"
cp "${NSIS_ZIP}.sig" "$INSTALLERS_DIR/"

SIG=$(cat "${NSIS_ZIP}.sig")
PUB_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Generate manifest
cat > "$UPDATES_DIR/latest.json" << EOF
{
  "version": "${VERSION}",
  "notes": "${NOTES}",
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "windows-x86_64": {
      "signature": "${SIG}",
      "url": "/updates/installers/Jolkr_${VERSION}_x64-setup.nsis.zip"
    }
  }
}
EOF

echo "Update manifest published for v${VERSION}"
echo "Manifest: $UPDATES_DIR/latest.json"
echo "Restart nginx to serve: docker compose restart nginx"
