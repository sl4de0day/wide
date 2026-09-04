'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'out', 'main', 'index.js');
const OUT = path.join(__dirname, 'src');

const SEGMENTS = [
  [1, '00-runtime', 'Module requires and the small filesystem helpers everything else uses.'],
  [34, '05-fs', 'fs:* handlers (read/write/create/rename/move/trash/reveal) and window:setTitle.'],
  [129, '10-native', 'Loads the native accelerator (a readable JS module now) and the search helpers.'],
  [296, '15-search', 'search:inFiles — project-wide content search.'],
  [325, '20-git', 'git:status — branch and working-tree state, read from the git CLI.'],
  [445, '25-typescript', 'ts:* — completions, diagnostics and quick info from the TypeScript language service.'],
  [722, '30-project', 'project:* — file index, quick-open, package scripts, CSS selectors.'],
  [859, '35-sssf-engine', 'The sssF policy engine: tokenizer, parser, compiler, rule evaluation and the hash-chained audit log.'],
  [2593, '40-ai', 'ai:* — the assistant: config, sessions, the streaming agent loop and its tools.'],
  [2952, '45-terminal', 'terminal:* — pty sessions backed by node-pty.'],
  [3003, '50-native-handlers', 'native:* helpers plus the project-inspection utilities.'],
  [3670, '55-sssf-handlers', 'sssf:* — status, reload, audit log and chain verification.'],
  [3708, '60-workspace', 'workspace:* — the recent-projects list.'],
  [3747, '65-perf', 'perf:sample and the engine preview server implementation.'],
  [4615, '70-engine', 'engine:* — the live preview server control and the CDP inspector.'],
  [5404, '75-tools', 'tools:* — discovery and sandboxed execution of user-authored plugins.'],
  [5620, '99-boot', 'App startup: boot the policy engine, register every handler group, and tear down cleanly.'],
];

const lines = fs.readFileSync(SOURCE, 'utf8').split(/\r?\n/);
fs.mkdirSync(OUT, { recursive: true });

SEGMENTS.forEach(([start, name, description], index) => {
  const end = index + 1 < SEGMENTS.length ? SEGMENTS[index + 1][0] - 1 : lines.length;
  const body = lines.slice(start - 1, end).join('\n');
  const header = `/* ${name} — ${description}\n   Part of the backend; the build concatenates every src/*.js in order. */\n`;
  fs.writeFileSync(path.join(OUT, `${name}.js`), `${header}${body}\n`, 'utf8');
  console.log(`${name.padEnd(20)} lines ${String(start).padStart(5)}–${String(end).padStart(5)}`);
});

console.log(`\n${SEGMENTS.length} segments written to ${path.relative(ROOT, OUT)}`);
