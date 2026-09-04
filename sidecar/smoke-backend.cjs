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
  failed += checkNativeColours();

  console.log(failed === 0 ? '\nAll backend checks passed.' : `\n${failed} check(s) failed.`);
  child.kill();
  process.exit(failed === 0 ? 0 : 1);
})();

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

  const pairs = [
    ['kBackground', 'mono-800'],
    ['kSplashBackground', 'mono-800'],
    ['kSplashSubtle', 'mono-300'],
  ];

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
