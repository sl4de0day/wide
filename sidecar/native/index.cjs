'use strict';



const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');







function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}


function grepCount(filePath, pattern) {
  const text = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp(pattern, 'g');
  let count = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    count += 1;



    if (match[0].length === 0) re.lastIndex += 1;
  }
  return count;
}

const fastTrim = (input) => String(input ?? '').trim();







const DEFAULT_IGNORE = new Set([

  '.git', '.hg', '.svn', '.idea', '.vscode',

  'node_modules', 'dist', 'out', 'build', '.next', '.nuxt', '.svelte-kit',
  '.turbo', '.parcel-cache', '.cache', 'coverage',

  'vendor',

  '__pycache__', '.venv', 'venv', '.tox', '.pytest_cache', '.mypy_cache',

  '.gradle', '.bundle', '.elixir_ls'
]);

const norm = (p) => p.split(path.sep).join('/');





const WALK_CONCURRENCY = 32;



async function walk(root, options) {
  const ignore = new Set(options.ignore ?? [...DEFAULT_IGNORE]);
  const maxFiles = options.maxFiles ?? 20000;
  const skipCargoTarget = Boolean(options.skipCargoTarget);
  const files = [];
  let truncated = false;

  const queue = [root];
  let active = 0;

  await new Promise((resolve) => {
    const pump = () => {
      if (truncated || (queue.length === 0 && active === 0)) {
        if (active === 0) resolve();
        return;
      }
      while (active < WALK_CONCURRENCY && queue.length > 0 && !truncated) {
        const dir = queue.shift();
        active += 1;
        fsp
          .readdir(dir, { withFileTypes: true })
          .then((entries) => {



            const isCrate =
              skipCargoTarget && entries.some((entry) => entry.name === 'Cargo.toml');

            for (const entry of entries) {
              if (truncated) break;
              if (ignore.has(entry.name)) continue;
              if (skipCargoTarget && isCrate && entry.name === 'target') continue;
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                queue.push(full);
              } else if (entry.isFile()) {
                if (files.length >= maxFiles) {
                  truncated = true;
                  break;
                }
                files.push({ path: norm(full), relativePath: norm(path.relative(root, full)) });
              }
            }
          })
          .catch(() => {

          })
          .finally(() => {
            active -= 1;
            pump();
          });
      }
    };
    pump();
  });

  return { files, truncated };
}


let residentIndex = [];

async function indexProject(root, optionsJson) {
  let options = {};
  try {
    options = JSON.parse(optionsJson || '{}');
  } catch {

  }
  const { files, truncated } = await walk(root, options);
  if (options.resident) {

    residentIndex = files.map((file) => ({ ...file, lowerPath: file.relativePath.toLowerCase() }));


    if (options.pathsOnlyNative) {
      return JSON.stringify({ files: [], truncated, count: files.length });
    }
  }
  return JSON.stringify({ files, truncated, count: files.length });
}



async function indexProjectObject(root, options = {}) {
  const { files, truncated } = await walk(root, options);
  if (options.resident) {
    residentIndex = files.map((file) => ({ ...file, lowerPath: file.relativePath.toLowerCase() }));
  }
  return { files, truncated, count: files.length };
}

async function searchInFilesObject(root, options = {}) {
  return JSON.parse(await searchInFiles(root, JSON.stringify(options)));
}

const isBoundary = (ch) => ch === '/' || ch === '\\' || ch === '-' || ch === '_' || ch === '.' || ch === ' ';



function score(text, haystack, needle) {
  let total = 0;
  let at = 0;
  let previous = -2;
  const positions = [];
  for (const wanted of needle) {
    const found = haystack.indexOf(wanted, at);
    if (found === -1) return null;
    let step = 1;
    if (found === previous + 1) step += 6;
    if (found === 0) step += 8;
    else if (isBoundary(haystack[found - 1])) step += 7;
    else if (text[found] >= 'A' && text[found] <= 'Z') step += 4;
    total += step;
    positions.push(found);
    previous = found;
    at = found + 1;
  }
  total -= Math.min(20, Math.floor((text.length - needle.length) / 6));
  return { score: total, positions };
}

function fuzzyQuery(query, limit) {
  const q = String(query ?? '');
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 500);
  if (!q) {
    return JSON.stringify({
      hits: residentIndex.slice(0, cap).map((file) => ({ ...file, positions: [] })),
      matched: residentIndex.length,
    });
  }



  const needle = q.toLowerCase();
  const best = [];
  let worst = -Infinity;
  let matched = 0;

  for (const file of residentIndex) {
    const result = score(file.relativePath, file.lowerPath, needle);
    if (!result) continue;
    matched += 1;
    if (best.length < cap) {
      best.push({ file, ...result });
      if (best.length === cap) {
        best.sort((a, b) => b.score - a.score);
        worst = best[best.length - 1].score;
      }
      continue;
    }
    if (result.score <= worst) continue;
    best[best.length - 1] = { file, ...result };

    for (let i = best.length - 1; i > 0 && best[i].score > best[i - 1].score; i -= 1) {
      const swap = best[i];
      best[i] = best[i - 1];
      best[i - 1] = swap;
    }
    worst = best[best.length - 1].score;
  }
  if (best.length < cap) best.sort((a, b) => b.score - a.score);

  return JSON.stringify({
    hits: best.map(({ file, positions }) => ({
      path: file.path,
      relativePath: file.relativePath,
      positions,
    })),
    matched,
  });
}

const fuzzyIndexSize = () => residentIndex.length;
const fuzzyClear = () => {
  residentIndex = [];
};





const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildMatcher(options) {
  let source = options.regexp ? options.query : escapeRe(options.query);
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  return new RegExp(source, options.caseSensitive ? 'g' : 'gi');
}


function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  let end = text.indexOf('\n', offset);
  if (end === -1) end = text.length;
  return { line, start, end };
}

const SEARCH_CONCURRENCY = 24;



async function searchInFiles(root, optionsJson) {
  let options = {};
  try {
    options = JSON.parse(optionsJson || '{}');
  } catch {

  }
  if (!options.query) return JSON.stringify({ files: [], total: 0, truncated: false });

  let matcher;
  try {
    matcher = buildMatcher(options);
  } catch (error) {
    return JSON.stringify({ error: `Invalid pattern: ${error.message}` });
  }

  const extensions = new Set(options.extensions ?? []);
  const maxFileBytes = options.maxFileBytes ?? 4 * 1024 * 1024;
  const maxResults = options.maxResults ?? 2000;
  const maxMatchesPerFile = options.maxMatchesPerFile ?? 50;
  const maxLinePreview = options.maxLinePreview ?? 200;

  const walked = await walk(root, {
    ignore: options.ignore,
    maxFiles: options.maxFiles ?? 5000,
    skipCargoTarget: true,
  });

  const out = [];
  let total = 0;
  let truncated = walked.truncated;
  let cursor = 0;

  const worker = async () => {
    while (cursor < walked.files.length && total < maxResults) {
      const file = walked.files[cursor++];
      if (extensions.size > 0) {
        const ext = path.extname(file.path).slice(1).toLowerCase();
        if (!extensions.has(ext)) continue;
      }
      let text;
      try {


        text = await fsp.readFile(file.path, 'utf8');
      } catch {
        continue;
      }
      if (text.length > maxFileBytes) continue;

      const re = new RegExp(matcher.source, matcher.flags);
      const matches = [];
      let match;
      while ((match = re.exec(text)) !== null) {
        const { line, start, end } = lineAt(text, match.index);
        matches.push({
          line,
          column: match.index - start + 1,
          length: match[0].length,
          preview: text.slice(start, end).slice(0, maxLinePreview),
        });
        if (match[0].length === 0) re.lastIndex += 1;
        if (matches.length >= maxMatchesPerFile) break;
      }
      if (matches.length === 0) continue;
      total += matches.length;
      out.push({ path: file.path, relativePath: file.relativePath, matches });
    }
  };

  await Promise.all(Array.from({ length: SEARCH_CONCURRENCY }, worker));
  if (total >= maxResults) truncated = true;

  return JSON.stringify({ files: out, total, truncated });
}





let lastCpu = process.cpuUsage();
let lastAt = Date.now();


function perfSample() {
  const startedAt = process.hrtime.bigint();

  const cpu = process.cpuUsage();
  const now = Date.now();
  const elapsedMs = Math.max(1, now - lastAt);
  const usedUs = cpu.user - lastCpu.user + (cpu.system - lastCpu.system);
  lastCpu = cpu;
  lastAt = now;

  const cores = os.cpus().length || 1;
  const processCpu = Math.min(100, (usedUs / 1000 / elapsedMs) * 100);

  const total = os.totalmem();
  const free = os.freemem();

  const sampleUs = Number((process.hrtime.bigint() - startedAt) / 1000n);

  return JSON.stringify({
    processCpu: Number(processCpu.toFixed(2)),
    cores,
    processMemory: process.memoryUsage().rss,


    systemCpu: Number((processCpu / cores).toFixed(2)),
    systemMemoryUsed: total - free,
    systemMemoryTotal: total,
    processCount: 0,
    sampleUs,
  });
}





const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'],
  vector: ['svg'],
  video: ['mp4', 'webm', 'mov', 'mkv'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a'],
  font: ['woff', 'woff2', 'ttf', 'otf', 'eot'],
  model: ['gltf', 'glb', 'obj', 'fbx'],
  shader: ['glsl', 'vert', 'frag', 'wgsl'],
  data: ['json', 'csv', 'xml', 'yml', 'yaml', 'toml'],
};

const KIND_BY_EXT = new Map();
for (const [kind, extensions] of Object.entries(KINDS)) {
  for (const ext of extensions) KIND_BY_EXT.set(ext, kind);
}

async function engineScanAssets(root, optionsJson) {
  const startedAt = Date.now();
  let options = {};
  try {
    options = JSON.parse(optionsJson || '{}');
  } catch {

  }
  const { files, truncated } = await walk(root, { ...options, maxFiles: options.maxFiles ?? 6000 });

  const assets = [];
  const totals = new Map();
  let bytes = 0;

  for (const file of files) {
    const ext = path.extname(file.path).slice(1).toLowerCase();
    const kind = KIND_BY_EXT.get(ext);
    if (!kind) continue;
    let stat;
    try {
      stat = await fsp.stat(file.path);
    } catch {
      continue;
    }
    assets.push({
      path: file.path,
      relative: file.relativePath,
      name: path.basename(file.path),
      ext,
      kind,
      size: stat.size,
      modified: stat.mtimeMs,
      note: '',
    });
    bytes += stat.size;
    const running = totals.get(kind) ?? { kind, count: 0, bytes: 0 };
    running.count += 1;
    running.bytes += stat.size;
    totals.set(kind, running);
  }

  return JSON.stringify({
    assets,
    kinds: [...totals.values()],
    count: assets.length,
    bytes,
    truncated,
    durationMs: Date.now() - startedAt,
  });
}

module.exports = {

  hashFile,
  grepCount,
  fastTrim,

  indexProject,
  indexProjectObject,
  searchInFilesObject,
  fuzzyQuery,
  fuzzyIndexSize,
  fuzzyClear,


  searchInFiles,

  perfSample,

  engineScanAssets,
};
