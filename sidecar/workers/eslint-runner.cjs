'use strict';

const path = require('node:path');

function offsetAt(lineStarts, line, column) {
  const index = Math.max(0, Math.min(line - 1, lineStarts.length - 1));
  return lineStarts[index] + Math.max(0, (column ?? 1) - 1);
}

function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

async function run(job) {
  const { root, filePath, text } = job;
  if (!root || !filePath || typeof text !== 'string') {
    return { ok: false, reason: 'bad-job' };
  }

  let eslintPath;
  try {
    eslintPath = require.resolve('eslint', { paths: [root] });
  } catch {
    return { ok: false, reason: 'not-installed' };
  }

  let mod;
  try {
    mod = require(eslintPath);
  } catch (error) {
    return { ok: false, reason: 'load-failed', detail: error.message };
  }

  const ESLint = mod.ESLint ?? mod.default?.ESLint;
  if (typeof ESLint !== 'function') {
    return { ok: false, reason: 'unsupported-version' };
  }

  let engine;
  try {
    engine = new ESLint({ cwd: root, errorOnUnmatchedPattern: false });
  } catch (error) {
    return { ok: false, reason: 'config-failed', detail: error.message };
  }

  try {
    if (await engine.isPathIgnored(filePath)) return { ok: true, diagnostics: [] };
  } catch {

  }

  let results;
  try {
    results = await engine.lintText(text, { filePath, warnIgnored: false });
  } catch (error) {

    const message = String(error?.message ?? error);

    if (/could not find (?:a )?(?:eslint )?config(?:uration)? file|no eslint configuration/i.test(message)) {
      return { ok: false, reason: 'no-config' };
    }
    return { ok: false, reason: 'lint-failed', detail: message.split('\n').slice(0, 3).join('\n') };
  }

  const starts = lineStartsOf(text);
  const diagnostics = [];
  for (const result of results ?? []) {
    for (const message of result.messages ?? []) {
      const from = offsetAt(starts, message.line ?? 1, message.column ?? 1);
      const to =
        message.endLine != null
          ? offsetAt(starts, message.endLine, message.endColumn ?? message.column ?? 1)
          : from;
      diagnostics.push({
        from,
        to: Math.max(from, to),

        severity: message.severity === 2 || message.fatal ? 'error' : 'warning',
        message: message.ruleId ? `${message.message} (${message.ruleId})` : message.message,
      });
    }
  }
  return { ok: true, diagnostics, version: ESLint.version ?? null };
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', async () => {
  let job;
  try {
    job = JSON.parse(input);
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, reason: 'bad-json' }));
    return;
  }
  let result;
  try {
    result = await run(job);
  } catch (error) {
    result = { ok: false, reason: 'crashed', detail: String(error?.message ?? error) };
  }
  process.stdout.write(JSON.stringify(result));
});

void path;
