'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, 'src');
const OUT = path.resolve(__dirname, '..', '..', 'out', 'main', 'index.js');

const files = fs
  .readdirSync(SRC)
  .filter((name) => name.endsWith('.js'))
  .sort();

if (files.length === 0) {
  console.error('No backend segments found in', SRC);
  process.exit(1);
}

const parts = files.map((name) => {
  const text = fs.readFileSync(path.join(SRC, name), 'utf8');

  const body = text.replace(/^\/\* [^\n]*\n[^\n]*\*\/\n/, '');
  return body.replace(/\n+$/, '');
});

fs.writeFileSync(OUT, `${parts.join('\n')}\n`, 'utf8');
console.log(`backend: ${files.length} segments -> ${path.relative(process.cwd(), OUT)}`);
