'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(DIST, 'wide-linux-x64');
const APP_DIR = path.join(OUT_DIR, 'resources', 'app');

if (!fs.existsSync(APP_DIR)) {
  fs.mkdirSync(APP_DIR, { recursive: true });
}

const copyTargets = [
  ['scripts', 'scripts'],
  ['out', 'out'],
  ['native-host/assets', 'native-host/assets'],
  ['sidecar', 'sidecar'],
  ['resources', 'resources'],
  ['assets', 'assets'],
  ['wide.desktop', 'wide.desktop'],
];

for (const [src, dest] of copyTargets) {
  const srcPath = path.join(ROOT, src);
  const destPath = path.join(APP_DIR, dest);
  if (fs.existsSync(srcPath)) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.cpSync(srcPath, destPath, { recursive: true });
  }
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = rootPkg.version || '1.681126';
const pkg = {
  name: 'wide',
  version,
  description: 'Wide IDE Linux Runtime',
  main: 'scripts/host-linux.cjs',
  private: true,
};
fs.writeFileSync(path.join(APP_DIR, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

const launcherContent = `#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

WAYLAND_FLAGS=()
if [ -n "$WAYLAND_DISPLAY" ]; then
  WAYLAND_FLAGS=(--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations)
fi

exec "$DIR/wide" "\${WAYLAND_FLAGS[@]}" "$@"
`;
const launcherPath = path.join(OUT_DIR, 'wide-launcher.sh');
fs.writeFileSync(launcherPath, launcherContent.replace(/\r\n/g, '\n'), 'utf8');

fs.copyFileSync(path.join(ROOT, 'wide.desktop'), path.join(OUT_DIR, 'wide.desktop'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(OUT_DIR, 'wide.png'));

console.log('Successfully updated wide-linux-x64 app to version ' + version);
