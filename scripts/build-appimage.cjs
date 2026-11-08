'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');
const SOURCE_DIR = path.join(DIST, 'wide-linux-x64');
const VERSION = '1.681126';
const APPIMAGE_NAME = `Wide-${VERSION}-x86_64.AppImage`;
const APPIMAGE_OUT = path.join(DIST, APPIMAGE_NAME);
const STAGE = path.join(DIST, '.appimage-staging');
const TAR2SQFS = 'C:\\Users\\yusuf\\Downloads\\squashfs-tools-ng-1.3.2-mingw64\\bin\\tar2sqfs.exe';

if (fs.existsSync(STAGE)) {
  fs.rmSync(STAGE, { recursive: true, force: true });
}
fs.mkdirSync(STAGE, { recursive: true });

fs.cpSync(SOURCE_DIR, STAGE, { recursive: true });

const appRunContent = `#!/bin/sh
SELF=$(readlink -f "$0")
HERE=\${SELF%/*}
export PATH="\${HERE}:\${PATH}"
exec "\${HERE}/wide-launcher.sh" "$@"
`;
fs.writeFileSync(path.join(STAGE, 'AppRun'), appRunContent.replace(/\r\n/g, '\n'), 'utf8');

fs.copyFileSync(path.join(ROOT, 'wide.desktop'), path.join(STAGE, 'wide.desktop'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(STAGE, 'wide.png'));
fs.copyFileSync(path.join(ROOT, 'assets', 'logo.png'), path.join(STAGE, '.DirIcon'));

const rawTar = path.join(DIST, 'temp-appimage.tar');
const sqfsOut = path.join(DIST, 'temp-appimage.sqfs');

console.log('Creating tar for AppImage...');
cp.execSync(`tar -cf "${rawTar}" -C "${STAGE}" .`, { stdio: 'inherit' });

console.log('Generating SquashFS image with tar2sqfs...');
cp.execSync(`"${TAR2SQFS}" -c zstd -b 131072 -f "${sqfsOut}"`, {
  input: fs.readFileSync(rawTar),
  stdio: ['pipe', 'inherit', 'inherit'],
});

const origAppImage = 'C:\\Users\\yusuf\\Downloads\\Wide-1.3291026-x86_64.AppImage';
const origFd = fs.openSync(origAppImage, 'r');
const runtimeBuf = Buffer.alloc(944632);
fs.readSync(origFd, runtimeBuf, 0, 944632, 0);
fs.closeSync(origFd);

const sqfsBuf = fs.readFileSync(sqfsOut);
const finalAppImage = Buffer.concat([runtimeBuf, sqfsBuf]);

fs.writeFileSync(APPIMAGE_OUT, finalAppImage);
fs.copyFileSync(APPIMAGE_OUT, path.join(RELEASE, APPIMAGE_NAME));

if (fs.existsSync(rawTar)) fs.unlinkSync(rawTar);
if (fs.existsSync(sqfsOut)) fs.unlinkSync(sqfsOut);
fs.rmSync(STAGE, { recursive: true, force: true });

console.log('Successfully generated AppImage: ' + APPIMAGE_OUT + ' (' + finalAppImage.length + ' bytes)');
