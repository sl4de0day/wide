'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(DIST, 'wide-linux-x64');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');

console.log('== [1/5] Kontroller ve Hazırlık ==');
if (!fs.existsSync(ELECTRON_DIST)) {
  console.error('Electron dağıtımı bulunamadı. Lütfen "npm install" çalıştırın.');
  process.exit(1);
}

const mainOut = path.join(ROOT, 'out', 'main', 'index.js');
const rendererOut = path.join(ROOT, 'out', 'renderer', 'index.html');
if (!fs.existsSync(mainOut) || !fs.existsSync(rendererOut)) {
  console.log('Derlenmiş dosyalar eksik, derleme başlatılıyor...');
  cp.execSync('npm run build:linux', { cwd: ROOT, stdio: 'inherit' });
}

if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log('== [2/5] Electron Çalışma Zamanı Kopyalanıyor ==');
fs.cpSync(ELECTRON_DIST, OUT_DIR, { recursive: true });

const origBinary = path.join(OUT_DIR, 'electron');
const wideBinary = path.join(OUT_DIR, 'wide');
if (fs.existsSync(origBinary)) {
  fs.renameSync(origBinary, wideBinary);
  fs.chmodSync(wideBinary, 0o755);
}

console.log('== [3/5] Uygulama Dosyaları ve Bağımlılıklar Paketleniyor ==');
const APP_DIR = path.join(OUT_DIR, 'resources', 'app');
fs.mkdirSync(APP_DIR, { recursive: true });

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
const version = rootPkg.version || '1.3291026';
const pkg = {
  name: 'wide',
  version,
  description: 'Wide IDE Linux Runtime',
  main: 'scripts/host-linux.cjs',
  private: true,
};
fs.writeFileSync(path.join(APP_DIR, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

const PROD_MODULES = [
  '@grpc',
  '@lydell',
  'node-forge',
  'prettier',
  'typescript',
];

const destModules = path.join(APP_DIR, 'node_modules');
fs.mkdirSync(destModules, { recursive: true });
const srcModules = path.join(ROOT, 'node_modules');

for (const mod of PROD_MODULES) {
  const s = path.join(srcModules, mod);
  const d = path.join(destModules, mod);
  if (fs.existsSync(s)) {
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.cpSync(s, d, { recursive: true });
  }
}

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
fs.writeFileSync(launcherPath, launcherContent, 'utf8');
fs.chmodSync(launcherPath, 0o755);

fs.copyFileSync(path.join(ROOT, 'wide.desktop'), path.join(OUT_DIR, 'wide.desktop'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(OUT_DIR, 'wide.png'));

console.log('== [4/5] Taşınabilir Arşivler Üretiliyor ==');
const tarGzName = `wide-${version}-linux-x64.tar.gz`;
const tarGzPath = path.join(DIST, tarGzName);
try {
  cp.execSync(`tar -czf "${tarGzPath}" -C "${DIST}" wide-linux-x64`, { stdio: 'inherit' });
  console.log(`✓ Taşınabilir paket hazırlandı: ${tarGzName}`);
} catch (e) {
  console.warn('tar.gz oluşturulamadı:', e.message);
}

const tarZstName = `wide-${version}-linux-x64.tar.zst`;
const tarZstPath = path.join(DIST, tarZstName);
try {
  cp.execSync(`tar -cf - -C "${DIST}" wide-linux-x64 | zstd -T0 -19 -f -o "${tarZstPath}"`, { stdio: 'inherit' });
  console.log(`✓ Yüksek sıkıştırmalı Zstandard paketi hazırlandı: ${tarZstName}`);
} catch (e) {
}

console.log('== [5/5] Tamamlandı! ==');
console.log(`Paket konumu: ${OUT_DIR}`);
console.log(`Çalıştırmak için: ${launcherPath}`);

