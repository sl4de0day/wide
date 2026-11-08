'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');
const SOURCE_DIR = path.join(DIST, 'wide-linux-x64');
const VERSION = '1.681126';
const PKG_NAME = `wide-ide-${VERSION}-1-x86_64.pkg.tar.zst`;
const PKG_OUT = path.join(DIST, PKG_NAME);
const STAGE = path.join(DIST, '.arch-staging');
const ZSTD = 'C:\\Users\\yusuf\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Meta.Zstandard_Microsoft.Winget.Source_8wekyb3d8bbwe\\zstd-v1.5.7-win64\\zstd.exe';

if (fs.existsSync(STAGE)) {
  fs.rmSync(STAGE, { recursive: true, force: true });
}
fs.mkdirSync(STAGE, { recursive: true });

const OPT_WIDE = path.join(STAGE, 'opt', 'wide');
const USR_BIN = path.join(STAGE, 'usr', 'bin');
const APPS_DIR = path.join(STAGE, 'usr', 'share', 'applications');
const PIXMAPS = path.join(STAGE, 'usr', 'share', 'pixmaps');
const ICONS_DIR = path.join(STAGE, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps');

fs.mkdirSync(OPT_WIDE, { recursive: true });
fs.mkdirSync(USR_BIN, { recursive: true });
fs.mkdirSync(APPS_DIR, { recursive: true });
fs.mkdirSync(PIXMAPS, { recursive: true });
fs.mkdirSync(ICONS_DIR, { recursive: true });

fs.cpSync(SOURCE_DIR, OPT_WIDE, { recursive: true });

const binScript = '#!/bin/sh\nexec /opt/wide/wide-launcher.sh "$@"\n';
fs.writeFileSync(path.join(USR_BIN, 'wide'), binScript.replace(/\r\n/g, '\n'), 'utf8');

fs.copyFileSync(path.join(ROOT, 'wide.desktop'), path.join(APPS_DIR, 'wide.desktop'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(PIXMAPS, 'wide.png'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(ICONS_DIR, 'wide.png'));

let totalBytes = 0;
function walkSize(p) {
  const entries = fs.readdirSync(p, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(p, entry.name);
    if (entry.isDirectory()) {
      walkSize(full);
    } else {
      totalBytes += fs.statSync(full).size;
    }
  }
}
walkSize(path.join(STAGE, 'opt'));
walkSize(path.join(STAGE, 'usr'));

const buildDate = Math.floor(Date.now() / 1000);
const pkginfoContent = `pkgname = wide-ide
pkgbase = wide-ide
xdata = pkgtype=pkg
pkgver = ${VERSION}-1
pkgdesc = Security-first IDE for the web stack — real-time vulnerability detection, built-in Catcher proxy & Pitcher API client
url = https://github.com/sl4de0day/wide
builddate = ${buildDate}
packager = Unknown Packager
size = ${totalBytes}
arch = x86_64
license = GPL-3.0-or-later
conflict = wide
conflict = wide-ide
provides = wide
provides = wide-ide
depend = gtk3
depend = nss
depend = alsa-lib
depend = libnotify
depend = libsecret
depend = libxss
depend = libxtst
optdepend = git: Source control entegrasyonu
optdepend = nodejs: Gelişmiş dil sunucuları ve npm araçları
optdepend = python: Python analizi ve debug motoru
`;

fs.writeFileSync(path.join(STAGE, '.PKGINFO'), pkginfoContent.replace(/\r\n/g, '\n'), 'utf8');

const rawTar = path.join(DIST, `wide-ide-${VERSION}-1-x86_64.pkg.tar`);
cp.execSync(`tar -cf "${rawTar}" -C "${STAGE}" .PKGINFO opt usr`, { stdio: 'inherit' });
cp.execSync(`"${ZSTD}" -T0 -19 -f -o "${PKG_OUT}" "${rawTar}"`, { stdio: 'inherit' });

if (fs.existsSync(rawTar)) {
  fs.unlinkSync(rawTar);
}

fs.copyFileSync(PKG_OUT, path.join(RELEASE, PKG_NAME));
fs.rmSync(STAGE, { recursive: true, force: true });

console.log('Successfully generated Arch package: ' + PKG_OUT + ' (' + fs.statSync(PKG_OUT).size + ' bytes)');
