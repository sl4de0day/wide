'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');
const ZSTD = 'C:\\Users\\yusuf\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Meta.Zstandard_Microsoft.Winget.Source_8wekyb3d8bbwe\\zstd-v1.5.7-win64\\zstd.exe';

if (!fs.existsSync(RELEASE)) {
  fs.mkdirSync(RELEASE, { recursive: true });
}

console.log('Packing tar.gz...');
const tarGzName = 'wide-1.681126-linux-x64.tar.gz';
const tarGzPath = path.join(DIST, tarGzName);
cp.execSync(`tar -czf "${tarGzPath}" -C "${DIST}" wide-linux-x64`, { stdio: 'inherit' });
fs.copyFileSync(tarGzPath, path.join(RELEASE, tarGzName));

console.log('Packing tar.zst...');
const tarZstName = 'wide-1.681126-linux-x64.tar.zst';
const tempTar = path.join(DIST, 'temp-wide-linux.tar');
const tarZstPath = path.join(DIST, tarZstName);
cp.execSync(`tar -cf "${tempTar}" -C "${DIST}" wide-linux-x64`, { stdio: 'inherit' });
cp.execSync(`"${ZSTD}" -T0 -19 -f -o "${tarZstPath}" "${tempTar}"`, { stdio: 'inherit' });
if (fs.existsSync(tempTar)) {
  fs.unlinkSync(tempTar);
}
fs.copyFileSync(tarZstPath, path.join(RELEASE, tarZstName));

console.log('Finished tar packages:');
console.log('tar.gz:', fs.statSync(tarGzPath).size);
console.log('tar.zst:', fs.statSync(tarZstPath).size);
