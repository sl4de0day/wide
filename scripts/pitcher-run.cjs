'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Usage: node scripts/pitcher-run.cjs <collection.json> [--env <env.json>] [--iterations N]\n' +
      '       [--out <report.json>] [--junit <report.xml>] [--insecure] [--fail-on any|never] [--delay <ms>]',
  );
  process.exit(message ? 2 : 0);
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') usage();

let collectionPath = null;
let envPath = null;
let iterations = 1;
let outPath = null;
let junitPath = null;
let insecure = false;
let failOn = 'any';
let delayMs = 0;

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--env') envPath = argv[++i];
  else if (arg === '--iterations') iterations = Math.max(1, Number(argv[++i]) || 1);
  else if (arg === '--out') outPath = argv[++i];
  else if (arg === '--junit') junitPath = argv[++i];
  else if (arg === '--insecure') insecure = true;
  else if (arg === '--fail-on') failOn = argv[++i];
  else if (arg === '--delay') delayMs = Math.max(0, Number(argv[++i]) || 0);
  else if (arg.startsWith('-')) usage(`Unknown option ${arg}`);
  else if (collectionPath === null) collectionPath = arg;
  else usage('Only one collection can be run at a time.');
}

if (!collectionPath) usage('No collection given.');
if (!['any', 'never'].includes(failOn)) usage(`--fail-on must be any or never, not ${failOn}`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function flattenWide(collection) {
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.kind === 'folder') walk(node.nodes || []);
      else if (node.kind === 'request' && node.request) out.push(node.request);
    }
  };
  walk(collection.nodes || []);
  return out.map((r) => ({
    name: r.name,
    method: (r.method || 'GET').toUpperCase(),
    url: r.url,
    headers: (r.headers || []).filter((h) => h.enabled && h.key).map((h) => [h.key, h.value]),
    params: (r.params || []).filter((p) => p.enabled && p.key).map((p) => [p.key, p.value]),
    body: bodyOf(r.body),
    auth: r.auth,
  }));
}

function flattenPostman(doc) {
  const out = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (item.item) walk(item.item);
      else if (item.request) {
        const req = item.request;
        const rawUrl = typeof req.url === 'string' ? req.url : req.url && req.url.raw;
        out.push({
          name: item.name,
          method: (req.method || 'GET').toUpperCase(),
          url: (rawUrl || '').split('?')[0],
          headers: (Array.isArray(req.header) ? req.header : []).filter((h) => !h.disabled).map((h) => [h.key, h.value]),
          params: (req.url && req.url.query ? req.url.query : []).filter((q) => !q.disabled).map((q) => [q.key, q.value]),
          body: req.body && req.body.raw ? { text: req.body.raw } : null,
          auth: null,
        });
      }
    }
  };
  walk(doc.item);
  return out;
}

function bodyOf(b) {
  if (!b || b.mode === 'none') return null;
  if (b.mode === 'raw') return { text: b.raw, contentType: b.rawType === 'json' ? 'application/json' : 'text/plain' };
  if (b.mode === 'form')
    return {
      text: (b.form || []).filter((p) => p.enabled).map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&'),
      contentType: 'application/x-www-form-urlencoded',
    };
  return null;
}

function loadEnv(file) {
  if (!file) return {};
  const doc = readJson(file);
  const out = {};
  if (Array.isArray(doc.values)) for (const v of doc.values) if (v.enabled !== false) out[v.key] = v.value;
  else if (Array.isArray(doc)) for (const v of doc) out[v.key] = v.value;
  else for (const [k, v] of Object.entries(doc)) out[k] = String(v);
  return out;
}

function resolveVars(text, vars) {
  return String(text == null ? '' : text).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, name) => (name in vars ? vars[name] : whole));
}

function applyAuth(auth, headers, vars) {
  if (!auth || auth.type === 'none' || auth.type === 'inherit') return;
  if (auth.type === 'bearer') headers.push(['Authorization', `Bearer ${resolveVars(auth.bearer, vars)}`]);
  else if (auth.type === 'basic') {
    const token = Buffer.from(`${resolveVars(auth.basic.username, vars)}:${resolveVars(auth.basic.password, vars)}`).toString('base64');
    headers.push(['Authorization', `Basic ${token}`]);
  } else if (auth.type === 'apikey' && auth.apikey.in === 'header') {
    headers.push([resolveVars(auth.apikey.key, vars), resolveVars(auth.apikey.value, vars)]);
  }
}

function sendOne(entry, vars) {
  return new Promise((resolve) => {
    let url = resolveVars(entry.url, vars);
    const qp = entry.params.map(([k, v]) => `${encodeURIComponent(resolveVars(k, vars))}=${encodeURIComponent(resolveVars(v, vars))}`);
    if (qp.length) url += (url.includes('?') ? '&' : '?') + qp.join('&');
    let target;
    try {
      target = new URL(url);
    } catch {
      resolve({ ok: false, error: `bad url: ${url}` });
      return;
    }
    const headers = entry.headers.map(([k, v]) => [resolveVars(k, vars), resolveVars(v, vars)]);
    applyAuth(entry.auth, headers, vars);
    const body = entry.body ? resolveVars(entry.body.text, vars) : null;
    if (body && entry.body.contentType && !headers.some(([k]) => k.toLowerCase() === 'content-type')) {
      headers.push(['Content-Type', entry.body.contentType]);
    }
    const transport = target.protocol === 'https:' ? https : http;
    const opts = { method: entry.method, headers: Object.fromEntries(headers) };
    if (target.protocol === 'https:' && insecure) opts.rejectUnauthorized = false;
    const started = Date.now();
    const req = transport.request(target, opts, (res) => {
      let size = 0;
      res.on('data', (c) => (size += c.length));
      res.on('end', () => resolve({ ok: true, status: res.statusCode || 0, ms: Date.now() - started, bytes: size }));
    });
    req.setTimeout(30000, () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

function junitXml(results) {
  const failures = results.filter((r) => !r.pass).length;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cases = results
    .map((r) => {
      const body = r.pass ? '' : `<failure message="${esc(r.detail)}"/>`;
      return `    <testcase classname="pitcher" name="${esc(r.name)}" time="${(r.ms / 1000).toFixed(3)}">${body}</testcase>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="pitcher" tests="${results.length}" failures="${failures}">\n${cases}\n</testsuite>\n`;
}

(async () => {
  const doc = readJson(collectionPath);
  const entries = doc._wide === 'pitcher-collection' && doc.collection
    ? flattenWide(doc.collection)
    : doc.info && doc.item
      ? flattenPostman(doc)
      : doc.nodes
        ? flattenWide(doc)
        : null;
  if (!entries) usage('That file is not a Wide or Postman collection.');

  const vars = loadEnv(envPath);
  const collVars =
    doc._wide && doc.collection && Array.isArray(doc.collection.vars)
      ? Object.fromEntries(doc.collection.vars.filter((v) => v.enabled && v.key).map((v) => [v.key, v.value]))
      : {};
  const merged = { ...collVars, ...vars };

  const results = [];
  for (let iter = 0; iter < iterations; iter += 1) {
    for (const entry of entries) {
      const reply = await sendOne(entry, merged);
      const name = `${entry.name || entry.method + ' ' + entry.url}${iterations > 1 ? ` #${iter + 1}` : ''}`;
      const pass = reply.ok && reply.status > 0 && reply.status < 400;
      results.push({ name, pass, status: reply.status || 0, ms: reply.ms || 0, detail: reply.error || `status ${reply.status}` });
      const mark = pass ? 'ok  ' : 'FAIL';
      console.error(`${mark} ${name} — ${reply.ok ? reply.status + ' in ' + reply.ms + 'ms' : reply.error}`);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.error(`\n${passed}/${results.length} passed, ${failed} failed.`);

  if (outPath) fs.writeFileSync(path.resolve(outPath), JSON.stringify({ passed, failed, results }, null, 2), 'utf8');
  if (junitPath) fs.writeFileSync(path.resolve(junitPath), junitXml(results), 'utf8');
  if (!outPath && !junitPath) process.stdout.write(JSON.stringify({ passed, failed, results }, null, 2) + '\n');

  process.exit(failOn === 'never' ? 0 : failed > 0 ? 1 : 0);
})();
