

let tsWorker = null;
let tsWorkerFailed = false;
let tsSeq = 0;
const tsPending =  new Map();

function tsWorkerPath() {

  return node_path.resolve(__dirname, "..", "..", "sidecar", "workers", "ts-worker.cjs");
}

function ensureTsWorker() {
  if (tsWorker || tsWorkerFailed) return tsWorker;
  try {
    const { Worker } = require("node:worker_threads");
    tsWorker = new Worker(tsWorkerPath());
    tsWorker.on("message", (msg) => {
      const pending = tsPending.get(msg.id);
      if (!pending) return;
      tsPending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error));
      else pending.resolve(msg.result);
    });
    tsWorker.on("error", (error) => {
      console.error("[ts] The language-service worker failed:", error.message);
      for (const pending of tsPending.values()) pending.reject(error);
      tsPending.clear();
      tsWorker = null;
    });
    tsWorker.on("exit", () => {
      for (const pending of tsPending.values()) pending.reject(new Error("ts worker exited"));
      tsPending.clear();
      tsWorker = null;
    });
    tsWorker.unref();
  } catch (error) {
    tsWorkerFailed = true;
    console.error("[ts] Could not start the language-service worker:", error.message);
  }
  return tsWorker;
}

function tsCall(op, args, fallback) {
  const worker = ensureTsWorker();
  if (!worker) return Promise.resolve(fallback);
  const id = ++tsSeq;
  return new Promise((resolve, reject) => {
    tsPending.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  }).catch((error) => {
    console.warn(`[ts] ${op} failed:`, error.message);
    return fallback;
  });
}

function registerTsHandlers() {
  electron.ipcMain.handle("ts:sync", (_event, root, filePath, content) =>
    tsCall("sync", [root, filePath, content], { ok: false }));

  electron.ipcMain.handle("ts:close", (_event, filePath) =>
    tsCall("close", [filePath], { ok: false }));

  electron.ipcMain.handle("ts:completions", (_event, root, filePath, position) =>
    tsCall("completions", [root, filePath, position], { entries: [] }));

  electron.ipcMain.handle("ts:details", (_event, root, filePath, position, name, source, data) =>
    tsCall("details", [root, filePath, position, name, source, data], null));

  electron.ipcMain.handle("ts:diagnostics", (_event, root, filePath) =>
    tsCall("diagnostics", [root, filePath], { diagnostics: [] }));

  electron.ipcMain.handle("ts:projectDiagnostics", (_event, root) =>
    tsCall("projectDiagnostics", [root], { counts: {} }));

  electron.ipcMain.handle("ts:quickInfo", (_event, root, filePath, position) =>
    tsCall("quickInfo", [root, filePath, position], null));

  electron.ipcMain.handle("ts:definition", (_event, root, filePath, position) =>
    tsCall("definition", [root, filePath, position], { locations: [] }));

  electron.ipcMain.handle("ts:references", (_event, root, filePath, position) =>
    tsCall("references", [root, filePath, position], { locations: [] }));

  electron.ipcMain.handle("ts:securityScan", (_event, root) =>
    tsCall("securityScan", [root], { findings: [] }));

  electron.ipcMain.handle("ts:documentHighlights", (_event, root, filePath, position) =>
    tsCall("documentHighlights", [root, filePath, position], { spans: [] }));

  electron.ipcMain.handle("ts:signatureHelp", (_event, root, filePath, position) =>
    tsCall("signatureHelp", [root, filePath, position], { signatures: null }));

  electron.ipcMain.handle("ts:navigationTree", (_event, root, filePath) =>
    tsCall("navigationTree", [root, filePath], { tree: null }));

  electron.ipcMain.handle("ts:navigateTo", (_event, root, query) =>
    tsCall("navigateTo", [root, query], { items: [] }));

  electron.ipcMain.handle("ts:rename", (_event, root, filePath, position) =>
    tsCall("rename", [root, filePath, position], { canRename: false, error: "No answer." }));

  electron.ipcMain.handle("ts:codeActions", (_event, root, filePath, start, end, codes) =>
    tsCall("codeActions", [root, filePath, start, end, codes], { actions: [] }));

  electron.ipcMain.handle("ts:refactorEdits", (_event, root, filePath, start, end, refactor, action) =>
    tsCall("refactorEdits", [root, filePath, start, end, refactor, action], { files: [] }));
}

const IGNORED$1 =  new Set([

  ".git", ".hg", ".svn", ".idea", ".vscode",

  "node_modules", "dist", "out", "build", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".parcel-cache", ".cache", "coverage",

  "vendor",

  "__pycache__", ".venv", "venv", ".tox", ".pytest_cache", ".mypy_cache",

  ".gradle", ".bundle", ".elixir_ls"
]);

const BUILD_DIRS$1 = [
  { dir: "target", manifests: ["Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts"] },
  { dir: "bin", manifests: ["project.json"] },
  { dir: "obj", manifests: ["project.json"] },
  { dir: "_build", manifests: ["mix.exs", "rebar.config"] },
  { dir: "deps", manifests: ["mix.exs", "rebar.config"] }
];

function buildDirsToSkip$1(entries) {
  const names = new Set(entries.map((entry) => entry.name));
  const dotnet = entries.some((entry) => /\.(?:csproj|fsproj|sln)$/i.test(entry.name));
  const skip =  new Set();
  for (const { dir: dir3, manifests } of BUILD_DIRS$1) {
    if (manifests.some((name) => names.has(name))) skip.add(dir3);
  }
  if (dotnet) {
    skip.add("bin");
    skip.add("obj");
  }
  return skip;
}

const MAX_FILES$1 = 2e4;
async function walk$3(dir2, root, out) {
  if (out.files.length >= MAX_FILES$1) {
    out.truncated = true;
    return;
  }
  let entries;
  try {
    entries = await promises.readdir(dir2, { withFileTypes: true });
  } catch {
    return;
  }
  const guarded = buildDirsToSkip$1(entries);
  for (const entry of entries) {
    if (out.files.length >= MAX_FILES$1) {
      out.truncated = true;
      return;
    }
    const full = node_path.join(dir2, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED$1.has(entry.name)) continue;
      if (guarded.has(entry.name)) continue;
      await walk$3(full, root, out);
    } else if (entry.isFile()) {
      out.files.push({ path: full, relativePath: node_path.relative(root, full).split(node_path.sep).join("/") });
    }
  }
}
async function indexProject(root) {
  if (!root) return { files: [], truncated: false };
  if (supports("indexProject")) {
    try {
      const result = JSON.parse(
        await native.indexProject(
          root,
          JSON.stringify({
            ignore: [...IGNORED$1],
            maxFiles: MAX_FILES$1,
            skipCargoTarget: true,
            resident: false,
            pathsOnlyNative: false
          })
        )
      );
      return { files: result.files, truncated: result.truncated };
    } catch (error) {
      console.warn("[project] The native index failed; using JavaScript:", error.message);
    }
  }
  const out = { files: [], truncated: false };
  await walk$3(root, root, out);
  return out;
}
const MAX_INDEXED_FILES = 8e3;
async function indexFiles(dir2, root, out) {
  if (out.length >= MAX_INDEXED_FILES) return;
  let entries;
  try {
    entries = await promises.readdir(dir2, { withFileTypes: true });
  } catch {
    return;
  }
  const guarded = buildDirsToSkip$1(entries);
  for (const entry of entries) {
    if (out.length >= MAX_INDEXED_FILES) return;
    const full = node_path.join(dir2, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED$1.has(entry.name)) continue;
      if (guarded.has(entry.name)) continue;
      await indexFiles(full, root, out);
    } else if (entry.isFile()) {
      out.push({ path: full, relativePath: node_path.relative(root, full).split(node_path.sep).join("/") });
    }
  }
}
const STYLE_EXTENSIONS = /\.(?:css|scss|less|pcss|postcss)$/;
const MAX_STYLE_BYTES = 4e5;
const MAX_SELECTORS = 4e3;
async function collectSelectors(dir2, out) {
  if (out.classes.size + out.ids.size >= MAX_SELECTORS) return;
  let entries;
  try {
    entries = await promises.readdir(dir2, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = node_path.join(dir2, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED$1.has(entry.name)) await collectSelectors(full, out);
      continue;
    }
    if (!STYLE_EXTENSIONS.test(entry.name)) continue;
    try {
      const info = await promises.stat(full);
      if (info.size > MAX_STYLE_BYTES) continue;
      const text = await promises.readFile(full, "utf8");
      for (const match of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.classes.add(match[1]);
      for (const match of text.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)) out.ids.add(match[1]);
    } catch {
      continue;
    }
  }
}
