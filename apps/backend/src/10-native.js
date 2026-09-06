

const candidates = [
  process.resourcesPath && node_path.join(process.resourcesPath, "wide_native.node"),
  node_path.join(__dirname, "../../src/native/target/release/wide_native.node")
].filter(Boolean);
let addon = null;
let failure = null;
for (const candidate of candidates) {
  try {
    addon = require(candidate);
    break;
  } catch (error) {
    failure = error;
  }
}
if (!addon) {
  console.warn(
    `[native] The Rust addon was not loaded (${failure?.message ?? "not found"}); falling back to the JavaScript implementations.`
  );
}
const native = addon;
const supports = (name) => addon !== null && typeof addon[name] === "function";


const IGNORED_DIRS =  new Set([

  ".git", ".hg", ".svn", ".idea", ".vscode",

  "node_modules", "dist", "out", "build", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".parcel-cache", ".cache", "coverage",

  "vendor",

  "__pycache__", ".venv", "venv", ".tox", ".pytest_cache", ".mypy_cache",

  ".gradle", ".bundle", ".elixir_ls"
]);



const TEXT_EXTENSIONS =  new Set([

  "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx",

  "html", "htm", "xhtml", "css", "scss", "less", "pcss", "postcss",

  "php", "phtml", "php3", "php4", "php5", "phps",

  "py", "pyi", "pyw",

  "cs", "csx",

  "java", "kt", "kts", "scala", "sc",

  "go", "rs",

  "rb", "rake", "gemspec", "ru",

  "ex", "exs", "erl", "hrl",

  "sql", "ddl", "dml", "graphql", "graphqls", "gql", "wat", "wast",

  "json", "jsonc", "map", "webmanifest", "md", "markdown",
  "xml", "svg", "txt", "yml", "yaml", "toml", "ini", "env",
  "sh", "bat", "ps1", "cmd", "dockerfile", "properties", "gradle", "lock"
]);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES$2 = 5e3;
const MAX_RESULTS = 500;
const MAX_MATCHES_PER_FILE = 50;
const MAX_LINE_PREVIEW = 240;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function buildMatcher({ query, regexp, caseSensitive, wholeWord }) {
  let source = regexp ? query : escapeRegExp(query);
  if (wholeWord) source = `\\b(?:${source})\\b`;
  return new RegExp(source, caseSensitive ? "g" : "gi");
}
async function* walk$4(dir2, budget) {
  let entries;
  try {
    entries = await promises.readdir(dir2, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.files >= MAX_FILES$2) return;
    const path = node_path.join(dir2, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      yield* walk$4(path, budget);
    } else if (entry.isFile()) {
      const extension2 = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (!TEXT_EXTENSIONS.has(extension2)) continue;
      budget.files += 1;
      yield path;
    }
  }
}
function matchesInText(text, matcher) {
  const matches = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index];
    matcher.lastIndex = 0;
    let match;
    while ((match = matcher.exec(lineText)) !== null) {
      matches.push({
        line: index + 1,
        column: match.index + 1,
        length: match[0].length,
        preview: lineText.slice(0, MAX_LINE_PREVIEW)
      });
      if (matches.length >= MAX_MATCHES_PER_FILE) return matches;
      if (match.index === matcher.lastIndex) matcher.lastIndex += 1;
    }
  }
  return matches;
}
async function searchNative(root, options) {
  const request = {
    query: options.query,
    regexp: Boolean(options.regexp),
    caseSensitive: Boolean(options.caseSensitive),
    wholeWord: Boolean(options.wholeWord),
    ignore: [...IGNORED_DIRS],
    extensions: [...TEXT_EXTENSIONS],
    maxFileBytes: MAX_FILE_BYTES,
    maxFiles: MAX_FILES$2,
    maxResults: MAX_RESULTS,
    maxMatchesPerFile: MAX_MATCHES_PER_FILE,
    maxLinePreview: MAX_LINE_PREVIEW
  };


  const result = supports("searchInFilesObject")
    ? await native.searchInFilesObject(root, request)
    : JSON.parse(await native.searchInFiles(root, JSON.stringify(request)));
  if (result.error) return { error: result.error };
  return { files: result.files, total: result.total, truncated: result.truncated };
}
async function searchInFiles(root, options) {
  {
    if (!root || !options?.query) return { files: [], total: 0, truncated: false };
    if (supports("searchInFiles")) {
      try {
        return await searchNative(root, options);
      } catch (error) {
        console.warn("[search] The native search failed; using JavaScript:", error.message);
      }
    }
    let matcher;
    try {
      matcher = buildMatcher(options);
    } catch (error) {
      return { error: `Invalid pattern: ${error.message}` };
    }
    const budget = { files: 0 };
    const files = [];
    let total = 0;
    let truncated = false;
    for await (const path of walk$4(root, budget)) {
      if (total >= MAX_RESULTS) {
        truncated = true;
        break;
      }
      try {
        const stats = await promises.stat(path);
        if (stats.size > MAX_FILE_BYTES || stats.size === 0) continue;
        const text = await promises.readFile(path, "utf8");
        if (text.indexOf(String.fromCharCode(0)) !== -1) continue;
        const matches = matchesInText(text, matcher);
        if (matches.length === 0) continue;
        total += matches.length;
        files.push({ path, relativePath: node_path.relative(root, path), matches });
      } catch {
        continue;
      }
    }
    return { files, total, truncated: truncated || budget.files >= MAX_FILES$2 };
  }
}



async function listProjectFiles(root) {
  if (!root) return { files: [], truncated: false };
  const budget = { files: 0 };
  const files = [];
  const MAX = 20000;
  let truncated = false;
  for await (const path of walk$4(root, budget)) {
    if (files.length >= MAX) {
      truncated = true;
      break;
    }
    files.push({ path, relativePath: node_path.relative(root, path).split(node_path.sep).join("/") });
  }
  return { files, truncated: truncated || budget.files >= MAX_FILES$2 };
}



async function replaceInFiles(root, options, replacement, exclude) {
  if (!root || !options || !options.query) return { ok: false, error: "Nothing to replace." };
  let matcher;
  try {
    matcher = buildMatcher(options);
  } catch (error) {
    return { ok: false, error: `Invalid pattern: ${error.message}` };
  }
  const skip = new Set((Array.isArray(exclude) ? exclude : []).map((p) => node_path.resolve(String(p))));
  const repl = options.regexp ? String(replacement ?? "") : String(replacement ?? "").replace(/\$/g, "$$$$");
  const changed = [];
  let replacements = 0;
  const budget = { files: 0 };
  for await (const path of walk$4(root, budget)) {
    if (skip.has(node_path.resolve(path))) continue;
    try {
      const stats = await promises.stat(path);
      if (stats.size > MAX_FILE_BYTES || stats.size === 0) continue;
      const text = await promises.readFile(path, "utf8");
      if (text.indexOf(String.fromCharCode(0)) !== -1) continue;
      matcher.lastIndex = 0;
      const found = text.match(matcher);
      const count = found ? found.length : 0;
      if (count === 0) continue;
      const next = text.replace(matcher, repl);
      if (next === text) continue;
      await writeFileAtomic(path, next, "utf8");
      changed.push(node_path.relative(root, path).split(node_path.sep).join("/"));
      replacements += count;
    } catch {
      continue;
    }
  }
  return { ok: true, filesChanged: changed.length, replacements, files: changed };
}



async function findRelevant(root, query) {
  if (!root || !query) return "No query given.";
  const terms = [...new Set(String(query).toLowerCase().match(/[a-z0-9_]{3,}/g) || [])];
  if (terms.length === 0) return "The query had no usable terms.";
  const scored = [];
  const budget = { files: 0 };
  for await (const path of walk$4(root, budget)) {
    try {
      const stats = await promises.stat(path);
      if (stats.size > MAX_FILE_BYTES || stats.size === 0) continue;
      const text = await promises.readFile(path, "utf8");
      if (text.indexOf(String.fromCharCode(0)) !== -1) continue;
      const lower = text.toLowerCase();
      const rel = node_path.relative(root, path).split(node_path.sep).join("/");
      const relLower = rel.toLowerCase();
      let score = 0;
      for (const term of terms) {
        score += lower.split(term).length - 1;
        if (relLower.includes(term)) score += 8;
      }
      if (score === 0) continue;
      let snippet = "";
      let line = 0;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const lowerLine = lines[i].toLowerCase();
        if (terms.some((term) => lowerLine.includes(term))) {
          snippet = lines[i].trim().slice(0, 120);
          line = i + 1;
          break;
        }
      }
      scored.push({ rel, score, snippet, line });
    } catch {
      continue;
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 12);
  if (top.length === 0) return "Nothing relevant found.";
  return top.map((file) => `${file.rel}:${file.line}  (score ${file.score})  ${file.snippet}`).join("\n");
}
