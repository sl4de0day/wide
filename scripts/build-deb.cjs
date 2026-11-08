'use strict';

const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');
const SOURCE_DIR = path.join(DIST, 'wide-linux-x64');
const VERSION = '1.681126';
const DEB_NAME = `wide-ide_${VERSION}_amd64.deb`;
const DEB_OUT = path.join(DIST, DEB_NAME);
const STAGE = path.join(DIST, '.deb-staging');

if (fs.existsSync(STAGE)) {
  fs.rmSync(STAGE, { recursive: true, force: true });
}
fs.mkdirSync(STAGE, { recursive: true });

const DATA_DIR = path.join(STAGE, 'data');
const OPT_WIDE = path.join(DATA_DIR, 'opt', 'wide');
const USR_BIN = path.join(DATA_DIR, 'usr', 'bin');
const APPS_DIR = path.join(DATA_DIR, 'usr', 'share', 'applications');
const PIXMAPS = path.join(DATA_DIR, 'usr', 'share', 'pixmaps');
const ICONS_DIR = path.join(DATA_DIR, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps');

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
const md5s = [];

function walk(p) {
  const entries = fs.readdirSync(p, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(p, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else {
      const stat = fs.statSync(full);
      totalBytes += stat.size;
      const buf = fs.readFileSync(full);
      const hash = crypto.createHash('md5').update(buf).digest('hex');
      const rel = path.relative(DATA_DIR, full).replace(/\\/g, '/');
      md5s.push(`${hash}  ${rel}`);
    }
  }
}
walk(DATA_DIR);

const installedSizeKb = Math.ceil(totalBytes / 1024);

const CONTROL_DIR = path.join(STAGE, 'control');
fs.mkdirSync(CONTROL_DIR, { recursive: true });

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
fs.writeFileSync(path.join(CONTROL_DIR, 'md5sums'), md5s.join('\n') + '\n', 'utf8');

const controlTarGz = path.join(STAGE, 'control.tar.gz');
const dataTarXz = path.join(STAGE, 'data.tar.xz');
const debianBinary = Buffer.from('2.0\n', 'utf8');

cp.execSync(`tar -czf "${controlTarGz}" -C "${CONTROL_DIR}" .`, { stdio: 'inherit' });
cp.execSync(`tar -cJf "${dataTarXz}" -C "${DATA_DIR}" .`, { stdio: 'inherit' });

function packAr(entries) {
  const chunks = [Buffer.from('!<arch>\n', 'binary')];
  for (const entry of entries) {
    const name = (entry.name + '/').padEnd(16, ' ').slice(0, 16);
    const mtime = String(entry.mtime || Math.floor(Date.now() / 1000)).padEnd(12, ' ').slice(0, 12);
    const uid = String(entry.uid || 0).padEnd(6, ' ').slice(0, 6);
    const gid = String(entry.gid || 0).padEnd(6, ' ').slice(0, 6);
    const mode = (entry.mode || '100644').padEnd(8, ' ').slice(0, 8);
    const size = String(entry.data.length).padEnd(10, ' ').slice(0, 10);
    const fmag = '`\n';
    chunks.push(Buffer.from(name + mtime + uid + gid + mode + size + fmag, 'binary'));
    chunks.push(entry.data);
    if (entry.data.length % 2 === 1) {
      chunks.push(Buffer.from('\n', 'binary'));
    }
  }
  return Buffer.concat(chunks);
}

const debBuffer = packAr([
  { name: 'debian-binary', data: debianBinary, mode: '100644' },
  { name: 'control.tar.gz', data: fs.readFileSync(controlTarGz), mode: '100644' },
  { name: 'data.tar.xz', data: fs.readFileSync(dataTarXz), mode: '100644' },
]);

fs.writeFileSync(DEB_OUT, debBuffer);
fs.copyFileSync(DEB_OUT, path.join(RELEASE, DEB_NAME));

fs.rmSync(STAGE, { recursive: true, force: true });
console.log('Successfully generated deb package: ' + DEB_OUT + ' (' + debBuffer.length + ' bytes)');
