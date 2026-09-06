'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Usage: node scripts/catcher-run.cjs <url...> [--list <file>] [--out <report.json>]\n' +
      '       [--sarif <report.sarif>] [--insecure] [--fail-on high|any|never]',
  );
  process.exit(message ? 2 : 0);
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') usage();

const urls = [];
let listPath = null;
let outPath = null;
let sarifPath = null;
let insecure = false;
let failOn = 'high';

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--list') listPath = argv[++i];
  else if (arg === '--out') outPath = argv[++i];
  else if (arg === '--sarif') sarifPath = argv[++i];
  else if (arg === '--insecure') insecure = true;
  else if (arg === '--fail-on') failOn = argv[++i];
  else if (arg.startsWith('-')) usage(`Unknown option ${arg}`);
  else urls.push(arg);
}

if (listPath) {
  for (const line of fs.readFileSync(path.resolve(listPath), 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) urls.push(trimmed);
  }
}
if (!urls.length) usage('No URLs given.');
if (!['high', 'any', 'never'].includes(failOn)) usage(`--fail-on must be high, any or never, not ${failOn}`);

const RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

function fetchOnce(target, redirects, done) {
  let url;
  try {
    url = new URL(target);
  } catch {
    done({ error: `bad url: ${target}` });
    return;
  }
  const transport = url.protocol === 'https:' ? https : http;
  const opts = { method: 'GET', headers: { 'user-agent': 'Wide-Catcher/1.0', accept: '*/*' } };
  if (url.protocol === 'https:' && insecure) opts.rejectUnauthorized = false;
  const req = transport.request(url, opts, (res) => {
    const status = res.statusCode || 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location && redirects > 0) {
      res.resume();
      fetchOnce(new URL(location, url).toString(), redirects - 1, done);
      return;
    }
    const headers = [];
    for (let i = 0; i < res.rawHeaders.length; i += 2) headers.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);
    let body = '';
    res.on('data', (chunk) => {
      if (body.length < 256 * 1024) body += chunk;
    });
    res.on('end', () => done({ status, headers, body, scheme: url.protocol === 'https:' ? 'https' : 'http', url: url.toString() }));
  });
  req.setTimeout(20000, () => {
    req.destroy();
    done({ error: 'timeout' });
  });
  req.on('error', (e) => done({ error: e.message }));
  req.end();
}

const fetchUrl = (target) => new Promise((resolve) => fetchOnce(target, 5, resolve));

function header(pairs, name) {
  const found = pairs.find(([n]) => n.toLowerCase() === name.toLowerCase());
  return found ? found[1] : null;
}

function checks(reply) {
  const issues = [];
  const res = reply.headers;
  const ct = (header(res, 'content-type') || '').toLowerCase();
  const isHtml = ct.includes('text/html');
  const isHttps = reply.scheme === 'https';
  const ok = reply.status >= 200 && reply.status < 400;
  const add = (id, title, severity, detail) => issues.push({ checkId: id, title, severity, detail, url: reply.url });

  if (ok && isHtml && !header(res, 'content-security-policy')) add('no-csp', 'Missing Content-Security-Policy', 'medium', 'No CSP header on an HTML response.');
  if (ok && isHttps && !header(res, 'strict-transport-security')) add('no-hsts', 'Missing Strict-Transport-Security', 'low', 'HTTPS response with no HSTS header.');
  if (ok && !header(res, 'x-content-type-options')) add('no-nosniff', 'Missing X-Content-Type-Options', 'low', 'No X-Content-Type-Options: nosniff.');
  if (ok && isHtml && !header(res, 'x-frame-options') && !/frame-ancestors/i.test(header(res, 'content-security-policy') || '')) add('no-framing', 'Missing clickjacking protection', 'low', 'No X-Frame-Options and no frame-ancestors in CSP.');
  if (ok && isHtml && !header(res, 'referrer-policy')) add('no-referrer-policy', 'Missing Referrer-Policy', 'low', 'No Referrer-Policy header.');

  for (const [name, value] of res) {
    if (name.toLowerCase() !== 'set-cookie') continue;
    const lower = value.toLowerCase();
    const missing = [];
    if (!lower.includes('httponly')) missing.push('HttpOnly');
    if (isHttps && !lower.includes('secure')) missing.push('Secure');
    if (!lower.includes('samesite')) missing.push('SameSite');
    if (missing.length) add(`cookie:${value.split('=')[0].trim()}`, `Cookie ${value.split('=')[0].trim()} missing ${missing.join(', ')}`, 'medium', `Set-Cookie: ${value}`);
  }

  const csp = header(res, 'content-security-policy') || '';
  if (ok && isHtml && csp && /'unsafe-inline'|'unsafe-eval'|(?:default|script)-src[^;]*\*/i.test(csp)) add('weak-csp', 'Weak Content-Security-Policy', 'medium', `CSP allows unsafe-inline / unsafe-eval or a wildcard source.`);
  if (header(res, 'access-control-allow-origin') === '*') add('cors-wildcard', 'CORS allows any origin (*)', 'medium', 'Access-Control-Allow-Origin: *');
  const server = header(res, 'server');
  const powered = header(res, 'x-powered-by');
  if (server || powered) add('server-disclosure', 'Server software disclosed', 'info', [server && `Server: ${server}`, powered && `X-Powered-By: ${powered}`].filter(Boolean).join('\n'));
  if (/\bstack trace\b|Traceback \(most recent call last\)|<b>Warning<\/b>:|Exception in thread|at [\w.$]+\([\w.]+:\d+\)/i.test(reply.body)) add('verbose-error', 'Verbose error / stack trace', 'low', 'A stack trace or framework error is exposed in the response.');
  if (/(?:api[_-]?key|token|secret|password|access[_-]?key)=[^&\s"']{6,}/i.test(reply.url)) add('secret-in-url', 'Sensitive data in URL', 'medium', 'A token/secret appears in the query string.');
  return issues;
}

function sarifReport(results) {
  const rules = new Map();
  const sarifResults = [];
  for (const r of results) {
    for (const issue of r.issues) {
      rules.set(issue.checkId, { id: issue.checkId, name: issue.title, shortDescription: { text: issue.title } });
      const level = RANK[issue.severity] >= 3 ? 'error' : RANK[issue.severity] >= 1 ? 'warning' : 'note';
      sarifResults.push({
        ruleId: issue.checkId,
        level,
        message: { text: `${issue.title}: ${issue.detail}` },
        locations: [{ physicalLocation: { artifactLocation: { uri: issue.url } } }],
      });
    }
  }
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{ tool: { driver: { name: 'Wide Catcher', rules: [...rules.values()] } }, results: sarifResults }],
  };
}

(async () => {
  const results = [];
  for (const target of urls) {
    const reply = await fetchUrl(target);
    if (reply.error) {
      console.error(`ERR  ${target} — ${reply.error}`);
      results.push({ url: target, error: reply.error, issues: [] });
      continue;
    }
    const issues = checks(reply);
    results.push({ url: reply.url, status: reply.status, issues });
    console.error(`scan ${reply.url} — ${reply.status}, ${issues.length} issue(s)`);
  }

  const all = results.flatMap((r) => r.issues);
  const highest = all.reduce((m, i) => Math.max(m, RANK[i.severity] ?? 0), 0);
  console.error(`\n${all.length} issue(s) across ${results.length} URL(s).`);

  if (sarifPath) fs.writeFileSync(path.resolve(sarifPath), JSON.stringify(sarifReport(results), null, 2), 'utf8');
  if (outPath) fs.writeFileSync(path.resolve(outPath), JSON.stringify({ results }, null, 2), 'utf8');
  if (!sarifPath && !outPath) process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');

  const fail = failOn === 'never' ? false : failOn === 'any' ? all.length > 0 : highest >= 3;
  process.exit(fail ? 1 : 0);
})();
