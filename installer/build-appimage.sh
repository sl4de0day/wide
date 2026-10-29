#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$DIR/dist"
APPDIR="$DIST_DIR/Wide.AppDir"
TARGET_BUNDLE="$DIST_DIR/wide-linux-x64"

echo "[appimage] Preparing AppDir at $APPDIR..."

if [ ! -d "$TARGET_BUNDLE" ]; then
  echo "[appimage] Building Linux package first..."
  cd "$DIR"
  node scripts/package-linux.cjs --dir-only
fi

rm -rf "$APPDIR"
mkdir -p "$APPDIR"

cp -r "$TARGET_BUNDLE/"* "$APPDIR/"

cat > "$APPDIR/AppRun" << 'EOF'
#!/bin/sh
SELF=$(readlink -f "$0")
HERE=${SELF%/*}
export PATH="${HERE}:${PATH}"
exec "${HERE}/wide-launcher.sh" "$@"
EOF
chmod +x "$APPDIR/AppRun"

if [ -f "$DIR/wide.desktop" ]; then
  cp "$DIR/wide.desktop" "$APPDIR/wide.desktop"
fi

if [ -f "$DIR/assets/logo.png" ]; then
  cp "$DIR/assets/logo.png" "$APPDIR/wide.png"
  cp "$DIR/assets/logo.png" "$APPDIR/.DirIcon"
fi

echo "[appimage] AppDir created successfully."

APPIMAGETOOL="$(which appimagetool 2>/dev/null || true)"
if [ -z "$APPIMAGETOOL" ] && [ -x "/tmp/appimagetool-extracted/AppRun" ]; then
  APPIMAGETOOL="/tmp/appimagetool-extracted/AppRun"
fi

VERSION=$(node -p "require('./package.json').version")
OUTPUT_IMAGE="$DIST_DIR/Wide-${VERSION}-x86_64.AppImage"

EXTRA_FLAGS=()
if [ -f "/tmp/runtime-x86_64" ]; then
  EXTRA_FLAGS+=(--runtime-file /tmp/runtime-x86_64)
fi
EXTRA_FLAGS+=(--no-appstream)

if [ -n "$APPIMAGETOOL" ]; then
  echo "[appimage] Using appimagetool: $APPIMAGETOOL"
  ARCH=x86_64 "$APPIMAGETOOL" "${EXTRA_FLAGS[@]}" "$APPDIR" "$OUTPUT_IMAGE"
  echo "✓ [appimage] Created: $OUTPUT_IMAGE"
else
  echo "[appimage] appimagetool is not in PATH."
  echo "[appimage] AppDir is ready at: $APPDIR"
  echo "[appimage] To generate .AppImage manually, run: appimagetool $APPDIR $OUTPUT_IMAGE"
fi

