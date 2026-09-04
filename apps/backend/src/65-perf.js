

function registerPerfHandlers() {
  electron.ipcMain.handle("perf:sample", () => {
    if (!supports("perfSample")) {
      return { available: false };
    }
    try {
      return { available: true, ...JSON.parse(native.perfSample()) };
    } catch (error) {
      return { available: false, error: error.message };
    }
  });
}
const LOG_CAPACITY = 300;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".cjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json"
};
const escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function resolveUnder(root, relative) {
  let out = root;
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." || part.includes("\\") || part.includes(":")) return null;
    out = node_path.join(out, part);
  }
  return out;
}
const reloadClient = (port) => `<script data-engine="reload">(function(){if(window.__engineReload)return;window.__engineReload=1;var s=new EventSource('http://127.0.0.1:${port}/__engine/stream');s.onmessage=function(e){try{if(JSON.parse(e.data).type==='reload')location.reload();}catch(_){}};})();<\/script>`;
function inject(html2, port) {
  const script = reloadClient(port);
  const lower = html2.toLowerCase();
  for (const marker of ["</head>", "</body>"]) {
    const at = lower.indexOf(marker);
    if (at !== -1) return html2.slice(0, at) + script + html2.slice(at);
  }
  return html2 + script;
}
async function listing(root, dir2, relative) {
  const entries = await node_fs.promises.readdir(dir2, { withFileTypes: true });
  entries.sort(
    (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
  const base2 = relative ? `${relative.replace(/\/+$/, "")}/` : "";

  const rows = entries.map(
    (entry) => `<li><a href="/${escapeHtml(base2)}${escapeHtml(entry.name)}" style="color:#94b4c1">${escapeHtml(entry.name)}${entry.isDirectory() ? "/" : ""}</a></li>`
  ).join("");
  const title2 = escapeHtml(relative || node_path.basename(root) || "/");
  return `<!doctype html><meta charset="utf-8"><title>${title2}</title><meta name="color-scheme" content="dark"><body style="background:#213448;color:#94b4c1;font:13px ui-monospace,SFMono-Regular,monospace;padding:32px"><p style="color:#547792;margin:0 0 4px">no index.html here — listing instead</p><h1 style="font:600 15px system-ui;margin:0 0 16px;color:#cadae0">/${title2}</h1><ul style="list-style:none;padding:0;line-height:1.9">${rows}</ul>`;
}
const notFound = (path) => `<!doctype html><meta charset="utf-8"><title>404</title><meta name="color-scheme" content="dark"><body style="background:#213448;color:#7496aa;font:13px ui-monospace,monospace;padding:40px"><p>404 — no file at <b style="color:#ffffff">/${escapeHtml(path)}</b></p><p><a href="/" style="color:#94b4c1">index</a></p>`;
function startEngineServer(root, port) {
  const log = [];
  const clients =  new Set();
  const started = Date.now();
  let counter = 0;
  let closed = false;
  const record2 = (entry) => {
    log.push({ ...entry, id: ++counter, at: Date.now() });
    if (log.length > LOG_CAPACITY) log.shift();
  };
  const server2 = node_http.createServer(async (request, response) => {
    const begun = Date.now();
    const rawPath = (request.url ?? "/").split("?")[0];
    let path = rawPath;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
    }
    if (path === "/__engine/stream") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      response.write("retry: 1000\n\n");
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    const send = (status2, mime, body) => {
      response.writeHead(status2, {
        "Content-Type": mime,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });
      response.end(body);
      record2({
        method: request.method ?? "GET",
        path,
        status: status2,
        size: Buffer.byteLength(body),
        duration_ms: Date.now() - begun,
        mime
      });
    };
    const relative = path.replace(/^\/+/, "");
    const target = resolveUnder(root, relative);
    if (!target) {
      send(403, "text/plain; charset=utf-8", "403 Forbidden");
      return;
    }
    const serveFile = async (file) => {
      const mime = MIME[node_path.extname(file).toLowerCase()] ?? "application/octet-stream";
      if (mime.startsWith("text/html")) {
        const html2 = inject(await node_fs.promises.readFile(file, "utf8"), port);
        send(200, mime, html2);
        return;
      }
      const stat = await node_fs.promises.stat(file);
      response.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });
      node_fs.createReadStream(file).pipe(response);
      record2({
        method: request.method ?? "GET",
        path,
        status: 200,
        size: stat.size,
        duration_ms: Date.now() - begun,
        mime
      });
    };
    try {
      const stat = await node_fs.promises.stat(target).catch(() => null);
      if (stat?.isDirectory()) {
        const index = node_path.join(target, "index.html");
        if (await node_fs.promises.stat(index).then(() => true, () => false)) {
          await serveFile(index);
          return;
        }
        send(200, "text/html; charset=utf-8", await listing(root, target, relative));
        return;
      }
      if (stat?.isFile()) {
        await serveFile(target);
        return;
      }
      if (!relative.includes(".")) {
        const index = node_path.join(root, "index.html");
        if (await node_fs.promises.stat(index).then(() => true, () => false)) {
          await serveFile(index);
          return;
        }
      }
      send(404, "text/html; charset=utf-8", notFound(relative));
    } catch (error) {
      send(500, "text/plain; charset=utf-8", `500 ${error.message}`);
    }
  });
  return new Promise((resolve) => {
    server2.on("error", (error) => resolve({ ok: false, error: error.message }));
    server2.listen(port, "127.0.0.1", () => {
      resolve({
        ok: true,
        handle: {
          status: () => ({
            running: !closed,
            port,
            url: `http://127.0.0.1:${port}/`,
            root: root.split("\\").join("/"),
            requests: counter,
            clients: clients.size,
            uptime_ms: Date.now() - started
          }),
          requestsSince: (after) => log.filter((entry) => entry.id > after),
          clearLog: () => log.splice(0, log.length),
          reload: (path) => {
            const message = `data: ${JSON.stringify({ type: "reload", path })}

`;
            for (const client of clients) {
              try {
                client.write(message);
              } catch {
                clients.delete(client);
              }
            }
            return clients.size;
          },
          stop: () => {
            closed = true;
            for (const client of clients) client.end();
            clients.clear();
            server2.close();
          }
        }
      });
    });
  });
}
const KINDS = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "tif", "tiff", "heic"],
  vector: ["svg"],
  video: ["mp4", "webm", "mov", "m4v", "avi", "mkv", "ogv"],
  audio: ["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac", "opus"],
  font: ["woff", "woff2", "ttf", "otf", "eot"],
  model: ["glb", "gltf", "obj", "fbx", "stl", "dae"],
  shader: ["glsl", "vert", "frag", "wgsl"],
  data: ["json", "geojson", "xml", "csv", "yml", "yaml", "toml"]
};
const KIND_OF =  new Map();
for (const [kind, extensions] of Object.entries(KINDS)) {
  for (const extension2 of extensions) KIND_OF.set(extension2, kind);
}
const MAX_FILES = 3e3;
async function readHead(path, limit) {
  const handle = await promises.open(path, "r").catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
function probeJpeg(head) {
  let at = 2;
  while (at + 9 < head.length) {
    if (head[at] !== 255) {
      at += 1;
      continue;
    }
    const code = head[at + 1];
    if (code === 216 || code === 1 || code >= 208 && code <= 215) {
      at += 2;
      continue;
    }
    if (code === 218) return null;
    const length = head.readUInt16BE(at + 2);
    const isFrame = code >= 192 && code <= 195 || code >= 197 && code <= 199 || code >= 201 && code <= 203 || code >= 205 && code <= 207;
    if (isFrame) {
      return { height: head.readUInt16BE(at + 5), width: head.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}
function probeWebp(head) {
  const chunk = head.subarray(12, 16).toString("latin1");
  if (chunk === "VP8X" && head.length >= 30) {
    return {
      width: head.readUIntLE(24, 3) + 1,
      height: head.readUIntLE(27, 3) + 1,
      note: (head[20] & 2) !== 0 ? "animated" : null
    };
  }
  if (chunk === "VP8 " && head.length >= 30) {
    return { width: head.readUInt16LE(26) & 16383, height: head.readUInt16LE(28) & 16383 };
  }
  if (chunk === "VP8L" && head.length >= 25) {
    const bits = head.readUInt32LE(21);
    return { width: (bits & 16383) + 1, height: (bits >> 14 & 16383) + 1 };
  }
  return null;
}
function attribute(text, name) {
  const at = text.indexOf(`${name}=`);
  if (at === -1) return null;
  const rest = text.slice(at + name.length + 1);
  const quote = rest[0];
  if (quote !== '"' && quote !== "'") return null;
  const end = rest.indexOf(quote, 1);
  return end === -1 ? null : rest.slice(1, end);
}
function probeSvg(head) {
  const text = head.toString("utf8");
  const viewBox = attribute(text, "viewBox");
  if (viewBox) {
    const numbers = viewBox.split(/[\s,]+/).filter(Boolean).map(Number).filter((value) => Number.isFinite(value));
    if (numbers.length === 4) {
      return { width: Math.round(numbers[2]), height: Math.round(numbers[3]), note: "vector" };
    }
  }
  const dimension = (name) => {
    const raw = attribute(text, name);
    if (!raw) return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? Math.round(value) : null;
  };
  return { width: dimension("width"), height: dimension("height"), note: "vector" };
}
async function probe(path, ext) {
  if (ext === "svg") {
    const head2 = await readHead(path, 4096);
    return head2 ? probeSvg(head2) : null;
  }
  const head = await readHead(path, 131072);
  if (!head || head.length < 12) return null;
  if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return {
      width: head.readUInt32BE(16),
      height: head.readUInt32BE(20),
      note: head.subarray(0, 1024).includes("acTL") ? "animated" : null
    };
  }
  if (head.subarray(0, 4).toString("latin1") === "GIF8") {
    return {
      width: head.readUInt16LE(6),
      height: head.readUInt16LE(8),
      note: head.subarray(0, 1024).includes("NETSCAPE2.0") ? "animated" : null
    };
  }
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") {
    return probeWebp(head);
  }
  if (head.subarray(0, 2).toString("latin1") === "BM" && head.length >= 26) {
    return { width: Math.abs(head.readInt32LE(18)), height: Math.abs(head.readInt32LE(22)) };
  }
  if (head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0) {
    const size = (byte) => byte === 0 ? 256 : byte;
    return { width: size(head[6]), height: size(head[7]) };
  }
  if (head[0] === 255 && head[1] === 216) return probeJpeg(head);
  return null;
}
async function walk$1(dir2, root, out) {
  if (out.length >= MAX_FILES) return;
  const entries = await node_fs.promises.readdir(dir2, { withFileTypes: true }).catch(() => []);
  const isCrate = entries.some((entry) => entry.isFile() && entry.name === "Cargo.toml");
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const full = node_path.join(dir2, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED$1.has(entry.name)) continue;
      if (isCrate && entry.name === "target") continue;
      await walk$1(full, root, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = node_path.extname(entry.name).slice(1).toLowerCase();
    if (KIND_OF.has(ext)) out.push({ full, ext });
  }
}
const SKIP =  new Set([
  "node_modules",
  ".git",
  ".cache",
  ".turbo",
  ".parcel-cache",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  "target"
]);
const BUILT =  new Set(["dist", "build", "out", ".next", "public", "www", "docs"]);
const MAX_DEPTH = 4;
const MAX_ENTRIES = 60;
async function walk(dir2, root, depth, found) {
  if (depth > MAX_DEPTH || found.length >= MAX_ENTRIES) return;
  const entries = await node_fs.promises.readdir(dir2, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (found.length >= MAX_ENTRIES) return;
    const full = node_path.join(dir2, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name) || entry.name.startsWith(".git")) continue;
      await walk(full, root, depth + 1, found);
      continue;
    }
    if (entry.isFile() && /\.html?$/i.test(entry.name)) {
      found.push({ full, relative: node_path.relative(root, full).split(node_path.sep).join("/") });
    }
  }
}
async function inspect(path) {
  const handle = await node_fs.promises.open(path, "r").catch(() => null);
  if (!handle) return { needsDevServer: false, empty: true };
  try {
    const buffer = Buffer.alloc(32768);
    const { bytesRead } = await handle.read(buffer, 0, 32768, 0);
    const head = buffer.subarray(0, bytesRead).toString("utf8");
    return {

      needsDevServer: /["']\/src\//.test(head) || head.includes("/@vite/"),
      empty: bytesRead === 0
    };
  } finally {
    await handle.close();
  }
}
async function listEntries(root) {
  if (!root) return { entries: [] };
  const found = [];
  await walk(root, root, 0, found);
  const entries = [];
  for (const candidate of found) {
    const parts = candidate.relative.split("/");
    const name = parts[parts.length - 1].toLowerCase();
    const { needsDevServer, empty } = await inspect(candidate.full);
    let score = 0;
    if (name === "index.html") score += 100;
    if (parts.some((part) => BUILT.has(part.toLowerCase()))) score += 45;
    score -= (parts.length - 1) * 6;
    if (needsDevServer) score -= 120;
    if (empty) score -= 200;
    entries.push({
      relative: candidate.relative,

      dir: parts.length > 1 ? node_path.dirname(candidate.relative).split(node_path.sep).join("/") : "",
      name: parts[parts.length - 1],
      needsDevServer,
      score
    });
  }
  entries.sort((a, b) => b.score - a.score || a.relative.localeCompare(b.relative));
  return { entries };
}

const WATCH_SETTLE_MS = 180;
const WATCH_IGNORED = /(^|[\/])(\.git|node_modules|\.venv|venv|__pycache__|vendor|target|_build|deps|\.gradle)([\/]|$)/;

let watcher = null;
let watchTimer = null;

function stopWatching() {
  if (watchTimer) {
    clearTimeout(watchTimer);
    watchTimer = null;
  }
  if (!watcher) return;
  try {
    watcher.close();
  } catch {
  }
  watcher = null;
}

function startWatching(served, onChange) {
  stopWatching();
  try {

    watcher = node_fs.watch(served, { recursive: true, persistent: false }, (_type, name) => {
      const relative = typeof name === "string" ? name : "";
      if (relative && WATCH_IGNORED.test(relative)) return;
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        watchTimer = null;
        onChange(relative.split("\\").join("/"));
      }, WATCH_SETTLE_MS);
    });
    watcher.on("error", (error) => {
      console.warn("[engine] watching the served folder stopped:", error.message);
      stopWatching();
    });
    return true;
  } catch (error) {
    console.warn("[engine] the served folder could not be watched:", error.message);
    watcher = null;
    return false;
  }
}

const PORT_FIRST = 4300;
const PORT_ATTEMPTS = 12;
let server = null;
let inspector = null;
const ok$1 = (value) => ({ ok: true, ...value });
const fail$1 = (error) => ({ ok: false, error: String(error?.message ?? error) });
const idleStatus = () => ({
  running: false,
  port: 0,
  url: "",
  root: "",
  requests: 0,
  clients: 0,
  uptime_ms: 0,
  accelerated: supports("engineStart")
});
function currentStatus() {
  if (!server) return idleStatus();
  const status2 = server.kind === "native" ? JSON.parse(native.engineStatus()) : server.handle.status();
  return { ...status2, accelerated: server.kind === "native" };
}
function stopServer() {
  stopWatching();
  if (!server) return;
  try {
    if (server.kind === "native") native.engineStop();
    else server.handle.stop();
  } catch (error) {
    console.warn("[engine] stopping the server failed:", error.message);
  }
  server = null;
}

function pushReload(path = "") {
  if (!server) return 0;
  try {
    return server.kind === "native" ? native.engineReload(path) : server.handle.reload(path);
  } catch (error) {
    console.warn("[engine] the reload could not be delivered:", error.message);
    return 0;
  }
}
async function listen(root) {
  const errors = [];
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
    const port = PORT_FIRST + attempt;
    if (supports("engineStart")) {
      try {
        const result = JSON.parse(native.engineStart(root, port));
        if (result.ok) return { kind: "native", port };
        errors.push(result.error);
        continue;
      } catch (error) {
        console.warn("[engine] native server failed, using the JavaScript one:", error.message);
      }
    }
    const started = await startEngineServer(root, port);
    if (started.ok) return { kind: "js", port, handle: started.handle };
    errors.push(started.error);
  }
  throw new Error(
    `No free port between ${PORT_FIRST} and ${PORT_FIRST + PORT_ATTEMPTS - 1} (${errors[0] ?? "unknown"})`
  );
}
function detach() {
  if (!inspector) return;
  try {
    if (inspector.contents.debugger.isAttached()) inspector.contents.debugger.detach();
  } catch {
  }
  inspector = null;
}
function describe(object) {
  if (!object) return "";
  if (object.type === "string") return object.value;
  if ("value" in object) return String(object.value);
  if (object.type === "undefined") return "undefined";
  if (object.preview) {
    const parts = (object.preview.properties ?? []).map(
      (property) => `${property.name}: ${property.value}`
    );
    const body = parts.join(", ") + (object.preview.overflow ? ", …" : "");
    return object.subtype === "array" ? `[${(object.preview.properties ?? []).map((p) => p.value).join(", ")}${object.preview.overflow ? ", …" : ""}]` : `${object.className ?? "Object"} {${body}}`;
  }
  return object.description ?? object.className ?? object.type;
}
