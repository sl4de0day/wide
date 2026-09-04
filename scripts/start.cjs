'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGED = path.join(ROOT, 'dist', 'wide', 'wide.exe');
const DEV = path.join(ROOT, 'native-host', 'build', 'bin', 'Release', 'wide.exe');

const exe = fs.existsSync(PACKAGED) ? PACKAGED : DEV;
if (!fs.existsSync(exe)) {
  console.error('No build found. Run: npm run setup && npm run build');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

cp.spawn(exe, [], { detached: true, stdio: 'ignore', env }).unref();
console.log(`started ${path.relative(ROOT, exe)}`);
