'use strict';

const cp = require('node:child_process');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const child = cp.spawn(process.execPath, [path.join(__dirname, 'sidecar.cjs')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buf = '';
const replies = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.t === 'host') {
      send({ t: 'hostReply', id: m.id, result: m.method === 'dialog:showOpenDialog' ? { canceled: false, filePaths: [ROOT] } : null });
    } else if (m.type === 'reply') {

      const cb = replies.get(m.replyId); if (cb) { replies.delete(m.replyId); cb(m); }
    }
  }
});
function send(o) { child.stdin.write(JSON.stringify(o) + '\n'); }
let seq = 1;
const invoke = (channel, args) =>
  new Promise((res) => { const id = seq++; replies.set(id, res); send({ t: 'invoke', id, channel, args }); });

const CHECKS = [
  ['fs:readDir', [ROOT], (r) => Array.isArray(r) && r.length > 0],
  ['workspace:recents', [], (r) => Array.isArray(r?.projects)],
  ['search:inFiles', [ROOT, { query: 'bridge' }], (r) => typeof r?.total === 'number'],
  ['project:scripts', [ROOT], (r) => Array.isArray(r?.scripts)],
  ['perf:sample', [], (r) => r?.available === true && r.cores > 0],
  ['ts:diagnostics', [ROOT, path.join(ROOT, 'apps/renderer/src/lib/utils.ts')], (r) => Array.isArray(r?.diagnostics)],
  ['engine:status', [], (r) => typeof r?.running === 'boolean'],
  ['tools:list', [ROOT], (r) => Array.isArray(r?.tools)],
  ['extensions:list', [], (r) => Array.isArray(r?.installed) && Array.isArray(r?.optional)],
];

const GONE = [
  'git:status',
  'astro:inspect',
  'bundler:bundle',
  'deadcode:scan',
  'engine:save',
  'project:quickOpenPrepare',
  'project:quickOpenQuery',
  'native:fast-trim',
];

(async () => {
  await new Promise((r) => setTimeout(r, 1400));
  await invoke('dialog:openFolder', []);

  let failed = 0;
  for (const [channel, args, ok] of CHECKS) {
    const reply = await invoke(channel, args);
    const pass = !reply.error && ok(reply.result);
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${channel}${reply.error ? ` (${reply.error})` : ''}`);
  }
  for (const channel of GONE) {
    const reply = await invoke(channel, []);
    const pass = Boolean(reply.error);
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${channel} removed`);
  }

  failed += await checkExtensionGate();
  failed += await checkWorkflowRoundTrip();
  failed += await checkUpdateIntegrity();
  failed += await checkCatcherAutosave();
  failed += await checkMcpTrustGate();
  failed += await checkSecurityScanControls();
  failed += await checkSecurityCorpus();
  failed += await checkSca();
  failed += await checkTaintFlow();
  failed += await checkCustomRules();
  failed += checkNativeColours();

  console.log(failed === 0 ? '\nAll backend checks passed.' : `\n${failed} check(s) failed.`);
  child.kill();
  process.exit(failed === 0 ? 0 : 1);
})();

async function checkSecurityScanControls() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const dir = pathSync.join(osSync.tmpdir(), `wide-secscan-${process.pid}`);
  fsSync.mkdirSync(pathSync.join(dir, 'src'), { recursive: true });
  fsSync.mkdirSync(pathSync.join(dir, 'spec'), { recursive: true });

  const flow = (name) =>
    `const ${name} = req.query.${name};\nfs.readFile(${name});\n`;

  fsSync.writeFileSync(pathSync.join(dir, 'src', 'plain.js'), flow('alpha'), 'utf8');
  fsSync.writeFileSync(
    pathSync.join(dir, 'src', 'hushed.js'),
    `const beta = req.query.beta;\nfs.readFile(beta); // wide-ignore\n`,
    'utf8'
  );
  fsSync.writeFileSync(pathSync.join(dir, 'spec', 'fixture.js'), flow('gamma'), 'utf8');

  fsSync.writeFileSync(
    pathSync.join(dir, 'src', 'sink.js'),
    `function runQuery(q) {\n  return db.query(q);\n}\nmodule.exports = { runQuery };\n`,
    'utf8'
  );
  fsSync.writeFileSync(
    pathSync.join(dir, 'src', 'middle.js'),
    `function handle(input) {\n  return runQuery(input);\n}\nmodule.exports = { handle };\n`,
    'utf8'
  );
  fsSync.writeFileSync(
    pathSync.join(dir, 'src', 'entry.js'),
    `const x = req.query.x;\nhandle(x);\n`,
    'utf8'
  );

  const scan = await invoke('security:scanProject', [dir]);
  const findings = scan.result?.findings ?? [];
  const inFile = (needle) => findings.filter((f) => String(f.file).includes(needle));

  report(inFile('plain.js').length > 0, 'security scan reports a taint flow');
  report(
    inFile('middle.js').some((f) => String(f.ruleId).startsWith('xfile/')),
    'cross-file taint propagates transitively through two function hops'
  );
  report(inFile('hushed.js').length === 0, 'wide-ignore silences the line it sits on');
  report(inFile('fixture.js').length === 0, 'spec folders are out of scope by default');
  report(
    findings.every((f) => f.confidence === 'high' || f.confidence === 'medium' || f.confidence === 'low'),
    'every finding carries a confidence'
  );

  const wideDir = pathSync.join(dir, '.wide');
  fsSync.mkdirSync(wideDir, { recursive: true });
  fsSync.writeFileSync(
    pathSync.join(wideDir, 'security.json'),
    JSON.stringify({ disable: ['taint/path'] }),
    'utf8'
  );
  const disabled = await invoke('security:scanProject', [dir]);
  report(
    (disabled.result?.findings ?? []).every((f) => f.ruleId !== 'taint/path'),
    'security.json can switch a rule off'
  );
  fsSync.unlinkSync(pathSync.join(wideDir, 'security.json'));

  const exported = await invoke('security:export', [dir, 'sarif']);
  let sarif = null;
  try { sarif = JSON.parse(exported.result?.text ?? ''); } catch {}
  report(sarif?.version === '2.1.0' && Array.isArray(sarif?.runs?.[0]?.results), 'SARIF 2.1.0 export is well formed');
  report(
    Array.isArray(sarif?.runs?.[0]?.tool?.driver?.rules) && sarif.runs[0].tool.driver.rules.length > 0,
    'SARIF export declares the rules it used'
  );

  const based = await invoke('security:baseline', [dir, 'set']);
  report(based.result?.ok === true && based.result.count > 0, 'a baseline can be written from the last scan');
  const after = await invoke('security:scanProject', [dir]);
  report((after.result?.findings ?? []).length === 0, 'findings in the baseline stop being reported');
  report((after.result?.baselined ?? 0) > 0, 'the scan says how many it held back');

  await invoke('security:baseline', [dir, 'clear']);
  const cleared = await invoke('security:scanProject', [dir]);
  report((cleared.result?.findings ?? []).length > 0, 'clearing the baseline brings them back');

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkSecurityCorpus() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  let corpus = [];
  try {
    corpus = require('./security-corpus.json');
  } catch {
    report(false, 'security corpus could not be loaded');
    return failed;
  }

  const dir = pathSync.join(osSync.tmpdir(), `wide-corpus-${process.pid}`);
  const src = pathSync.join(dir, 'src');
  fsSync.mkdirSync(src, { recursive: true });
  const safe = (id) => id.replace(/[^a-z0-9]+/gi, '_');
  for (const entry of corpus) {
    fsSync.writeFileSync(pathSync.join(src, `${safe(entry.id)}_pos.${entry.ext}`), entry.positive, 'utf8');
    fsSync.writeFileSync(pathSync.join(src, `${safe(entry.id)}_neg.${entry.ext}`), entry.negative, 'utf8');
  }

  const scan = await invoke('security:scanProject', [dir]);
  const findings = scan.result?.findings ?? [];
  for (const entry of corpus) {
    const posHit = findings.some((f) => String(f.file).includes(`${safe(entry.id)}_pos.`) && f.ruleId === entry.id);
    const negHit = findings.some((f) => String(f.file).includes(`${safe(entry.id)}_neg.`) && f.ruleId === entry.id);
    report(posHit, `corpus: ${entry.id} flags its positive sample`);
    report(!negHit, `corpus: ${entry.id} ignores its negative sample`);
  }

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkTaintFlow() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const dir = pathSync.join(osSync.tmpdir(), `wide-taintflow-${process.pid}`);
  const src = pathSync.join(dir, 'src');
  fsSync.mkdirSync(src, { recursive: true });
  fsSync.writeFileSync(pathSync.join(src, 'multiline.js'), 'const c = req.query.c;\nexec(\n  "a",\n  "b",\n  c\n);\n', 'utf8');
  fsSync.writeFileSync(pathSync.join(src, 'sanitized.js'), 'let x = req.query.x;\nx = escape(x);\nexec(x);\n', 'utf8');
  fsSync.writeFileSync(pathSync.join(src, 'raw.js'), 'let y = req.query.y;\nexec(y);\n', 'utf8');

  const scan = await invoke('security:scanProject', [dir]);
  const findings = scan.result?.findings ?? [];
  const hits = (needle) => findings.filter((f) => String(f.file).includes(needle) && f.ruleId === 'taint/command');
  report(hits('multiline.js').length > 0, 'multi-line: a sink arg beyond the 3-line window is caught');
  report(hits('sanitized.js').length === 0, 'taint dies after a sanitizer reassigns the variable');
  report(hits('raw.js').length > 0, 'unsanitized taint still flags (control)');

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkCustomRules() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const dir = pathSync.join(osSync.tmpdir(), `wide-customrule-${process.pid}`);
  fsSync.mkdirSync(pathSync.join(dir, 'src'), { recursive: true });
  fsSync.mkdirSync(pathSync.join(dir, '.wide'), { recursive: true });
  fsSync.writeFileSync(pathSync.join(dir, 'src', 'app.js'), 'dangerousThing(userInput);\nsafeThing(x);\n', 'utf8');
  fsSync.writeFileSync(
    pathSync.join(dir, '.wide', 'security.json'),
    JSON.stringify({ rules: [{ id: 'no-dangerous', pattern: 'dangerousThing\\(', message: 'Do not use dangerousThing', severity: 'high', langs: ['js'] }] }),
    'utf8',
  );

  const scan = await invoke('security:scanProject', [dir]);
  const findings = scan.result?.findings ?? [];
  report(findings.some((f) => f.ruleId === 'custom/no-dangerous'), 'custom rule from security.json fires');

  const test = await invoke('security:testRule', ['dangerousThing\\(', '', 'a\ndangerousThing()\nb']);
  report(test.result?.ok === true && (test.result.matches ?? []).some((m) => m.line === 2), 'security:testRule reports the matching line');
  const bad = await invoke('security:testRule', ['(', '', 'x']);
  report(bad.result?.ok === false, 'security:testRule rejects an invalid pattern');

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkSca() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const osSync = require('node:os');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const dir = pathSync.join(osSync.tmpdir(), `wide-sca-${process.pid}`);
  const src = pathSync.join(dir, 'src');
  fsSync.mkdirSync(src, { recursive: true });
  fsSync.writeFileSync(pathSync.join(src, 'package.json'), JSON.stringify({ dependencies: { lodash: '4.17.20', express: '4.18.2', foolib: '1.0.0' } }), 'utf8');
  fsSync.mkdirSync(pathSync.join(dir, '.wide'), { recursive: true });
  fsSync.writeFileSync(
    pathSync.join(dir, '.wide', 'osv.json'),
    JSON.stringify({ npm: [{ name: 'foolib', lt: '2.0.0', id: 'WIDE-TEST-1', cwe: 'CWE-1395', sev: 'high', note: 'test override entry' }] }),
    'utf8'
  );
  fsSync.writeFileSync(pathSync.join(src, 'requirements.txt'), 'pyyaml==5.3\nrequests==2.31.0\n', 'utf8');
  fsSync.writeFileSync(
    pathSync.join(src, 'pom.xml'),
    '<project><dependencies><dependency><artifactId>log4j-core</artifactId><version>2.14.1</version></dependency></dependencies></project>',
    'utf8'
  );
  fsSync.writeFileSync(
    pathSync.join(src, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/minimist': { version: '1.2.5' } } }),
    'utf8'
  );
  fsSync.writeFileSync(pathSync.join(src, 'go.mod'), 'module x\n\nrequire github.com/dgrijalva/jwt-go v3.2.0\n', 'utf8');

  const scan = await invoke('security:scanProject', [dir]);
  const findings = scan.result?.findings ?? [];
  const has = (id) => findings.some((f) => f.ruleId === id);
  report(has('vuln-dep-cve-2021-23337'), 'SCA flags vulnerable lodash in package.json');
  report(has('vuln-dep-cve-2020-14343'), 'SCA flags vulnerable PyYAML in requirements.txt');
  report(has('vuln-dep-cve-2021-44228'), 'SCA flags Log4Shell in pom.xml');
  report(has('vuln-dep-cve-2021-44906'), 'SCA flags vulnerable minimist in package-lock.json');
  report(has('vuln-dep-cve-2020-26160'), 'SCA flags vulnerable jwt-go in go.mod');
  report(!has('vuln-dep-cve-2023-32681'), 'SCA leaves a patched dependency (requests 2.31.0) alone');
  report(has('vuln-dep-cve-2024-29041'), 'SCA flags express from the offline OSV snapshot');
  report(has('vuln-dep-wide-test-1'), 'SCA applies a project .wide/osv.json override');

  try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
  return failed;
}

async function checkMcpTrustGate() {
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const pending = await invoke('mcp:pending', []);
  report(!pending.error && pending.result?.ok === true && Array.isArray(pending.result.servers), 'mcp:pending lists offers');

  const unoffered = await invoke('mcp:trust', ['0123456789abcdef0123456789abcdef', true]);
  report(!unoffered.error && unoffered.result?.ok === false, 'mcp:trust refuses a server it never offered');

  const malformed = await invoke('mcp:trust', ['not-a-signature', true]);
  report(!malformed.error && malformed.result?.ok === false, 'mcp:trust refuses a malformed signature');

  const revoke = await invoke('mcp:trust', ['0123456789abcdef0123456789abcdef', false]);
  report(!revoke.error && revoke.result?.ok === true, 'mcp:trust allows revoking without an offer');

  return failed;
}

async function checkWorkflowRoundTrip() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const file = pathSync.join(ROOT, `smoke-${process.pid}.wideflow`);
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  try {
    const made = (await invoke('workflow:create', [
      file,
      [
        { path: pathSync.join(ROOT, 'apps'), name: 'Apps' },
        { path: pathSync.join(ROOT, 'sidecar'), name: 'Sidecar' },
      ],
    ])).result;
    report(made?.folders?.length === 2, 'workflow:create writes two folders');

    const onDisk = JSON.parse(fsSync.readFileSync(file, 'utf8'));
    report(
      onDisk?.folders?.every((folder) => !pathSync.isAbsolute(folder.path)),
      'workflow stores folder paths relative to itself',
    );

    const opened = (await invoke('workflow:open', [file])).result;
    report(
      opened?.folders?.length === 2 &&
        opened.folders.every((folder) => pathSync.isAbsolute(folder.path) && !folder.missing),
      'workflow:open resolves them back to real folders',
    );
    report(opened?.folders?.[0]?.name === 'Apps', 'workflow keeps the names given to folders');

    const refused = (await invoke('workflow:open', [pathSync.join(ROOT, 'package.json')])).result;
    report(Boolean(refused?.error), 'workflow:open refuses a file that is not a workflow');
  } finally {
    try { fsSync.unlinkSync(file); } catch {}
  }
  return failed;
}

async function checkExtensionGate() {
  const before = (await invoke('extensions:list', [])).result?.installed ?? [];
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  await invoke('extensions:remove', ['github']);
  await invoke('extensions:remove', ['codeberg']);
  const closed = (await invoke('codeberg:status', [ROOT])).result;
  report(closed?.installed === false, 'source control refuses when codeberg and github both removed');

  await invoke('extensions:install', ['github']);
  await invoke('extensions:install', ['codeberg']);
  const open = (await invoke('codeberg:status', [ROOT])).result;
  report(open?.installed === true, 'codeberg:status answers when installed');

  await invoke('extensions:remove', ['ai-assistant']);
  const aiClosed = (await invoke('ai:config', [])).result;
  report(aiClosed?.installed === false, 'ai:config refuses when removed');

  await invoke('extensions:install', ['ai-assistant']);
  const aiOpen = (await invoke('ai:config', [])).result;
  report(aiOpen?.ok === true, 'ai:config answers when installed');

  if (!before.includes('codeberg')) await invoke('extensions:remove', ['codeberg']);
  if (!before.includes('ai-assistant')) await invoke('extensions:remove', ['ai-assistant']);
  return failed;
}

async function checkCatcherAutosave() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const payload = JSON.stringify({ version: 2, entries: [{ id: 1, host: 'example.invalid' }] });
  const wrote = (await invoke('catcher:autosaveWrite', [ROOT, payload])).result;
  report(wrote?.ok === true, 'catcher session autosave writes');

  const read = (await invoke('catcher:autosaveRead', [ROOT])).result;
  report(read?.ok === true && read.json === payload, 'catcher session autosave reads the same bytes back');

  report(
    !fsSync.existsSync(pathSync.join(ROOT, '.wide', 'catcher-session.json')),
    'catcher autosave never writes captured traffic into the project',
  );

  const missing = (await invoke('catcher:autosaveRead', ['C:\\no\\such\\workspace'])).result;
  report(missing?.ok === true && missing.json === '', 'catcher autosave read of an unknown workspace is empty, not an error');

  return failed;
}

async function checkUpdateIntegrity() {
  const http = require('node:http');
  let failed = 0;
  const report = (pass, what) => {
    if (!pass) failed += 1;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}`);
  };

  const serve = (body) =>
    new Promise((resolve) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });

  const newer = await serve({ version: '99.0.0', url: 'https://example.invalid/Wide-Setup-99.0.0.exe' });
  const newerReply = (await invoke('update:check', [`http://127.0.0.1:${newer.address().port}/m.json`])).result;
  report(
    newerReply?.ok === true && newerReply.latest === '99.0.0' && newerReply.available === true,
    'update:check sees a newer manifest version as available',
  );
  newer.close();

  const older = await serve({ version: '0.0.1', url: '' });
  const olderReply = (await invoke('update:check', [`http://127.0.0.1:${older.address().port}/m.json`])).result;
  report(
    olderReply?.ok === true && olderReply.available === false,
    'update:check sees an older manifest version as not available',
  );
  older.close();

  const plain = (await invoke('update:download', [{ url: 'http://example.invalid/x.exe' }])).result;
  report(plain?.ok === false, 'update:download refuses a link that is not https');

  const unverified = (await invoke('update:download', [
    { url: 'https://example.invalid/x.exe', version: '0.0.1', asset: 'x.exe', sums: '' },
  ])).result;
  report(
    unverified?.ok === false && /SHA256SUMS/i.test(String(unverified?.error || '')),
    'update:download refuses an update with no published checksum',
  );

  const listed = (await invoke('extensions:list', [])).result;
  report(
    Array.isArray(listed?.optional) && !listed.optional.includes('browser'),
    'browser is built in, not an optional extension',
  );

  return failed;
}

function checkNativeColours() {
  const fsSync = require('node:fs');
  const pathSync = require('node:path');
  const root = pathSync.resolve(__dirname, '..');

  const css = fsSync.readFileSync(pathSync.join(root, 'apps/renderer/src/styles/index.css'), 'utf8');
  const cpp = fsSync.readFileSync(pathSync.join(root, 'native-host/src/main.cpp'), 'utf8');

  const token = (name) => {
    const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    return match ? match[1].toLowerCase() : null;
  };
  const constant = (name) => {
    const match = new RegExp(
      `constexpr COLORREF ${name} = RGB\\(0x([0-9a-fA-F]{2}), 0x([0-9a-fA-F]{2}), 0x([0-9a-fA-F]{2})\\)`,
    ).exec(cpp);
    return match ? `#${match[1]}${match[2]}${match[3]}`.toLowerCase() : null;
  };

  const pairs = [['kBackground', 'mono-800']];

  let bad = 0;
  for (const [name, tokenName] of pairs) {
    const fromCpp = constant(name);
    const fromCss = token(tokenName);
    const pass = fromCpp !== null && fromCss !== null && fromCpp === fromCss;
    if (!pass) bad += 1;
    console.log(
      `${pass ? 'ok  ' : 'FAIL'} ${name} == --${tokenName}` +
        (pass ? '' : ` (C++ ${fromCpp ?? 'unreadable'}, CSS ${fromCss ?? 'unreadable'})`),
    );
  }
  return bad;
}
