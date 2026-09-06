'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Usage: node scripts/scan.cjs <project> [--format sarif|json] [--out <file>] [--fail-on error|warning|info|never]',
  );
  process.exit(message ? 2 : 0);
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') usage();

let project = null;
let format = 'sarif';
let out = null;
let failOn = 'error';

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--format') format = argv[++i];
  else if (arg === '--out') out = argv[++i];
  else if (arg === '--fail-on') failOn = argv[++i];
  else if (arg.startsWith('-')) usage(`Unknown option ${arg}`);
  else if (project === null) project = arg;
  else usage('Only one project can be scanned at a time.');
}

if (!project) usage('No project given.');
if (!['sarif', 'json'].includes(format)) usage(`--format must be sarif or json, not ${format}`);
if (!['error', 'warning', 'info', 'never'].includes(failOn)) usage(`--fail-on is not ${failOn}`);

project = path.resolve(project);
if (!fs.existsSync(project)) usage(`${project} does not exist.`);

const bundle = path.join(ROOT, 'out', 'main', 'index.js');
if (!fs.existsSync(bundle)) usage('The backend is not built. Run "npm run build:backend" first.');

const child = cp.spawn(process.execPath, [path.join(ROOT, 'sidecar', 'sidecar.cjs')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer = '';
const waiting = new Map();
let sequence = 1;

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let cut;
  while ((cut = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, cut);
    buffer = buffer.slice(cut + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.t === 'host') {
      child.stdin.write(`${JSON.stringify({ t: 'hostReply', id: message.id, result: null })}\n`);
    } else if (message.type === 'reply') {
      const settle = waiting.get(message.replyId);
      if (settle) {
        waiting.delete(message.replyId);
        settle(message);
      }
    }
  }
});

const invoke = (channel, args) =>
  new Promise((resolve) => {
    const id = sequence++;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ t: 'invoke', id, channel, args })}\n`);
  });

const RANK = { info: 0, warning: 1, error: 2 };

(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1400));

  const scan = await invoke('security:scanProject', [project]);
  if (scan.error) {
    console.error(`The scan failed: ${scan.error}`);
    child.kill();
    process.exit(2);
  }
  const report = scan.result ?? { findings: [] };
  const findings = report.findings ?? [];

  const exported = await invoke('security:export', [project, format]);
  child.kill();

  if (!exported.result || exported.result.ok !== true) {
    console.error(`The report could not be produced: ${exported.result?.error ?? exported.error ?? 'unknown'}`);
    process.exit(2);
  }

  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), exported.result.text, 'utf8');
    console.error(`${findings.length} finding(s) written to ${path.resolve(out)}`);
  } else {
    process.stdout.write(exported.result.text);
  }

  if (report.capped) console.error('The scan hit its limit, so this report is not the whole project.');
  if (report.suppressed) console.error(`${report.suppressed} finding(s) silenced by wide-ignore.`);
  if (report.baselined) console.error(`${report.baselined} finding(s) held back by the baseline.`);

  if (failOn === 'never') process.exit(0);
  const floor = RANK[failOn];
  const over = findings.filter((finding) => (RANK[finding.severity] ?? 1) >= floor).length;
  if (over > 0) {
    console.error(`${over} finding(s) at or above "${failOn}".`);
    process.exit(1);
  }
  process.exit(0);
})();
