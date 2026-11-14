'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, 'src');
const RUNTIME = path.join(__dirname, 'runtime');
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

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.cpSync(RUNTIME, path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${parts.join('\n')}\n`, 'utf8');

const esbuild = require('esbuild');
const rootDir = path.resolve(__dirname, '..', '..');
const aiVendorEntry = path.join(__dirname, 'vendor', 'ai-vendor.mjs');
const mcpVendorEntry = path.join(__dirname, 'vendor', 'mcp-vendor.mjs');
const dbVendorEntry = path.join(__dirname, 'vendor', 'db-vendor.mjs');
if (fs.existsSync(aiVendorEntry)) {
  esbuild.buildSync({
    entryPoints: [aiVendorEntry],
    outfile: path.join(path.dirname(OUT), 'ai-vendor.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    logLevel: 'silent',
  });
}
if (fs.existsSync(mcpVendorEntry)) {
  const mcpOutMain = path.join(path.dirname(OUT), 'mcp-vendor.cjs');
  const mcpSidecar = path.join(rootDir, 'sidecar', 'mcp-vendor.cjs');
  esbuild.buildSync({
    entryPoints: [mcpVendorEntry],
    outfile: mcpOutMain,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    logLevel: 'silent',
  });
  fs.mkdirSync(path.dirname(mcpSidecar), { recursive: true });
  fs.copyFileSync(mcpOutMain, mcpSidecar);
}
if (fs.existsSync(dbVendorEntry)) {
  const dbOutMain = path.join(path.dirname(OUT), 'db-vendor.cjs');
  const dbSidecar = path.join(rootDir, 'sidecar', 'db-vendor.cjs');
  esbuild.buildSync({
    entryPoints: [dbVendorEntry],
    outfile: dbOutMain,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    external: ['pg-native'],
    logLevel: 'silent',
  });
  fs.mkdirSync(path.dirname(dbSidecar), { recursive: true });
  fs.copyFileSync(dbOutMain, dbSidecar);
}

console.log(`backend: ${files.length} segments -> ${path.relative(process.cwd(), OUT)}`);
