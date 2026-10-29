#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SOURCE_DIR = path.join(DIST, 'wide-linux-x64');
const VERSION = require(path.join(ROOT, 'package.json')).version || '1.220926';
const DEB_NAME = `wide-ide_${VERSION}_amd64.deb`;
const DEB_OUT = path.join(DIST, DEB_NAME);

if (!fs.existsSync(SOURCE_DIR)) {
  console.log('[deb] wide-linux-x64 bulunamadı, önce hazırlanıyor...');
  cp.execSync('node scripts/package-linux.cjs --dir-only', { stdio: 'inherit', cwd: ROOT });
}

console.log(`[deb] Debian paketi hazırlanıyor: ${DEB_NAME}...`);

const STAGE = path.join(DIST, '.deb-staging');
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// 1. Data dosya yapısını kur
const DATA_DIR = path.join(STAGE, 'data');
const OPT_WIDE = path.join(DATA_DIR, 'opt', 'wide');
const USR_BIN = path.join(DATA_DIR, 'usr', 'bin');
const APPS_DIR = path.join(DATA_DIR, 'usr', 'share', 'applications');
const PIXMAPS = path.join(DATA_DIR, 'usr', 'share', 'pixmaps');

fs.mkdirSync(OPT_WIDE, { recursive: true });
fs.mkdirSync(USR_BIN, { recursive: true });
fs.mkdirSync(APPS_DIR, { recursive: true });
fs.mkdirSync(PIXMAPS, { recursive: true });

// Dosyaları kopyala
cp.execSync(`cp -r "${SOURCE_DIR}/"* "${OPT_WIDE}/"`);
fs.chmodSync(path.join(OPT_WIDE, 'wide'), 0o755);
fs.chmodSync(path.join(OPT_WIDE, 'wide-launcher.sh'), 0o755);

// Symlink /usr/bin/wide
fs.symlinkSync('/opt/wide/wide-launcher.sh', path.join(USR_BIN, 'wide'));

// Desktop dosyası
fs.copyFileSync(path.join(ROOT, 'wide.desktop'), path.join(APPS_DIR, 'wide.desktop'));

// Logo ve hicolor ikonları
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(PIXMAPS, 'wide.png'));
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const HOME = process.env.HOME || '/home/sl4de';
for (const s of SIZES) {
  const iconSrc = path.join(HOME, '.local', 'share', 'icons', 'hicolor', `${s}x${s}`, 'apps', 'wide.png');
  if (fs.existsSync(iconSrc)) {
    const iconDestDir = path.join(DATA_DIR, 'usr', 'share', 'icons', 'hicolor', `${s}x${s}`, 'apps');
    fs.mkdirSync(iconDestDir, { recursive: true });
    fs.copyFileSync(iconSrc, path.join(iconDestDir, 'wide.png'));
  }
}

// 2. Control yapısını kur
const CONTROL_DIR = path.join(STAGE, 'control');
fs.mkdirSync(CONTROL_DIR, { recursive: true });

// Boyut hesapla (KB)
let totalBytes = 0;
function walkSize(p) {
  const st = fs.lstatSync(p);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) walkSize(path.join(p, f));
  } else {
    totalBytes += st.size;
  }
}
walkSize(DATA_DIR);
const installedSizeKb = Math.ceil(totalBytes / 1024);

const controlContent = `Package: wide-ide
Version: ${VERSION}
Section: devel
Priority: optional
Architecture: amd64
Installed-Size: ${installedSizeKb}
Maintainer: sl4de <sl4de0day@github>
Homepage: https://github.com/sl4de0day/wide
Depends: libgtk-3-0, libnss3, libasound2, libnotify4, libsecret-1-0, libxss1, libxtst6
Description: Security-first IDE for the web stack
 Wide provides real-time vulnerability detection, built-in Catcher
 proxy, Pitcher API client and native-speed development experience.
`;

fs.writeFileSync(path.join(CONTROL_DIR, 'control'), controlContent.replace(/\r\n/g, '\n'), 'utf8');

// md5sums üret
const md5s = [];
function walkMd5(p, base) {
  const st = fs.lstatSync(p);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) walkMd5(path.join(p, f), base);
  } else if (st.isFile()) {
    const rel = path.relative(base, p);
    const hash = cp.execSync(`md5sum "${p}"`).toString().split(/\s+/)[0];
    md5s.push(`${hash}  ${rel}`);
  }
}
walkMd5(DATA_DIR, DATA_DIR);
fs.writeFileSync(path.join(CONTROL_DIR, 'md5sums'), md5s.join('\n') + '\n', 'utf8');

// 3. Arşivleri paketle
const controlTarGz = path.join(STAGE, 'control.tar.gz');
const dataTarXz = path.join(STAGE, 'data.tar.xz');
const debianBinary = path.join(STAGE, 'debian-binary');

fs.writeFileSync(debianBinary, '2.0\n', 'utf8');

cp.execSync(`tar --numeric-owner --owner=0 --group=0 -czf "${controlTarGz}" -C "${CONTROL_DIR}" .`);
cp.execSync(`tar --numeric-owner --owner=0 --group=0 -cJf "${dataTarXz}" -C "${DATA_DIR}" .`);

// 4. ar ile .deb birleştir (sıralama çok önemlidir: debian-binary, control.tar.gz, data.tar.xz)
fs.rmSync(DEB_OUT, { force: true });
cp.execSync(`ar -rcs "${DEB_OUT}" "${debianBinary}" "${controlTarGz}" "${dataTarXz}"`);

// Temizlik
fs.rmSync(STAGE, { recursive: true, force: true });

console.log(`✓ [deb] Başarıyla üretildi: ${DEB_OUT} (${(fs.statSync(DEB_OUT).size / (1024 * 1024)).toFixed(1)} MB)`);

