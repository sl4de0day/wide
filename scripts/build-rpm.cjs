'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');
const VERSION = '1.681126';
const RPM_NAME = `wide-ide-${VERSION}-1.x86_64.rpm`;
const RPM_OUT = path.join(DIST, RPM_NAME);
const NFPM = 'C:\\Users\\yusuf\\AppData\\Local\\Microsoft\\WinGet\\Packages\\goreleaser.nfpm_Microsoft.Winget.Source_8wekyb3d8bbwe\\nfpm.exe';

const nfpmConfig = `name: "wide-ide"
arch: "amd64"
platform: "linux"
version: "${VERSION}"
release: "1"
section: "devel"
priority: "optional"
maintainer: "sl4de <sl4de0day@github>"
description: "Security-first IDE for the web stack\\n Wide provides real-time vulnerability detection, built-in Catcher proxy & Pitcher API client."
homepage: "https://github.com/sl4de0day/wide-ide"
license: "GPL-3.0-or-later"
depends:
  - gtk3
  - nss
  - alsa-lib
  - libnotify
  - libsecret
rpm:
  compression: zstd
contents:
  - src: ./dist/wide-linux-x64
    dst: /opt/wide
  - src: ./wide.desktop
    dst: /usr/share/applications/wide.desktop
  - src: ./assets/logo.png
    dst: /usr/share/pixmaps/wide.png
  - src: ./assets/logo.png
    dst: /usr/share/icons/hicolor/512x512/apps/wide.png
  - src: /opt/wide/wide-launcher.sh
    dst: /usr/bin/wide
    type: symlink
`;

const configPath = path.join(ROOT, 'nfpm.yaml');
fs.writeFileSync(configPath, nfpmConfig, 'utf8');

console.log('Building RPM package with nfpm...');
cp.execSync(`"${NFPM}" pkg --config "${configPath}" --packager rpm --target "${RPM_OUT}"`, {
  cwd: ROOT,
  stdio: 'inherit',
});

if (fs.existsSync(configPath)) {
  fs.unlinkSync(configPath);
}

fs.copyFileSync(RPM_OUT, path.join(RELEASE, RPM_NAME));
console.log('Successfully generated RPM package: ' + RPM_OUT + ' (' + fs.statSync(RPM_OUT).size + ' bytes)');
