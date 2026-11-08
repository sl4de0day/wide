'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');
const DIST = path.join(ROOT, 'dist');

const oldExe = path.join(RELEASE, 'Wide-Setup-1.3291026.exe');
if (fs.existsSync(oldExe)) {
  fs.unlinkSync(oldExe);
}

const files = fs.readdirSync(RELEASE).filter((f) => f.includes('1.681126'));
files.sort();

const sums = [];
for (const f of files) {
  const filePath = path.join(RELEASE, f);
  const buf = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  sums.push(`${hash}  ${f}`);
}

const content = sums.join('\n') + '\n';
fs.writeFileSync(path.join(RELEASE, 'SHA256SUMS'), content, 'utf8');
fs.writeFileSync(path.join(DIST, 'SHA256SUMS'), content, 'utf8');

console.log('--- SHA256SUMS ---');
console.log(content);
