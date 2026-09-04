

const ELIXIR_LS_CANDIDATES =
  process.platform === "win32"
    ? [["language_server.bat", []], ["elixir-ls", []]]
    : [["language_server.sh", []], ["elixir-ls", []]];

const LSP_SERVERS = {
  py: { id: "python", language: "python", candidates: [["pylsp", []], ["pyright-langserver", ["--stdio"]]] },
  pyi: { id: "python", language: "python", candidates: [["pylsp", []], ["pyright-langserver", ["--stdio"]]] },
  go: { id: "go", language: "go", candidates: [["gopls", []]] },
  rs: { id: "rust", language: "rust", candidates: [["rust-analyzer", []]] },
  php: { id: "php", language: "php", candidates: [["intelephense", ["--stdio"]], ["phpactor", ["language-server"]]] },
  phtml: { id: "php", language: "php", candidates: [["intelephense", ["--stdio"]], ["phpactor", ["language-server"]]] },
  rb: { id: "ruby", language: "ruby", candidates: [["ruby-lsp", []], ["solargraph", ["stdio"]]] },
  ex: { id: "elixir", language: "elixir", candidates: ELIXIR_LS_CANDIDATES },
  exs: { id: "elixir", language: "elixir", candidates: ELIXIR_LS_CANDIDATES },
  erl: { id: "erlang", language: "erlang", candidates: [["erlang_ls", []]] },
  java: { id: "java", language: "java", candidates: [["jdtls", []], ["jdtls.bat", []]] },
  cs: { id: "csharp", language: "csharp", candidates: [["csharp-ls", []], ["omnisharp", ["-lsp"]]] },
  kt: { id: "kotlin", language: "kotlin", candidates: [["kotlin-language-server", []]] },
  kts: { id: "kotlin", language: "kotlin", candidates: [["kotlin-language-server", []]] },
  scala: { id: "scala", language: "scala", candidates: [["metals", []]] },
  sql: { id: "sql", language: "sql", candidates: [["sql-language-server", ["up", "--method", "stdio"]], ["sqls", []]] },
  graphql: { id: "graphql", language: "graphql", candidates: [["graphql-lsp", ["server", "-m", "stream"]]] },
  gql: { id: "graphql", language: "graphql", candidates: [["graphql-lsp", ["server", "-m", "stream"]]] },

  vue: { id: "vue", language: "vue", candidates: [["vue-language-server", ["--stdio"]]] },
  svelte: { id: "svelte", language: "svelte", candidates: [["svelteserver", ["--stdio"]]] },

  html: {
    id: "angular",
    language: "html",
    gate: (dir) => hasAngularProject(dir),
    augmentArgs: (root) => angularProbeArgs(root),
    candidates: [["ngserver", ["--stdio"]]],
  },
};

function hasAngularProject(startDir) {
  let dir = String(startDir || "");
  for (let i = 0; i < 12 && dir; i += 1) {
    try {
      if (node_fs.existsSync(node_path.join(dir, "angular.json"))) return true;
    } catch {

    }
    const parent = node_path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

let angularNpmGlobalRoot;
function npmGlobalRoot() {
  if (angularNpmGlobalRoot !== undefined) return angularNpmGlobalRoot;
  try {
    const out = node_child_process.execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    angularNpmGlobalRoot = out.trim() || null;
  } catch {
    angularNpmGlobalRoot = null;
  }
  return angularNpmGlobalRoot;
}

function angularProbeArgs(root) {
  const local = node_path.join(root, "node_modules");
  const global = npmGlobalRoot();
  const tsProbe = node_fs.existsSync(node_path.join(local, "typescript")) ? local : global || local;
  const ngProbe = node_fs.existsSync(node_path.join(local, "@angular", "language-service")) ? local : global || local;
  return ["--tsProbeLocations", tsProbe, "--ngProbeLocations", ngProbe];
}

function lspPrimaryCommand(spec) {
  return spec.candidates[0][0];
}

const LSP_START_TIMEOUT_MS = 20_000;
const LSP_REQUEST_TIMEOUT_MS = 8_000;
const LSP_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

const LSP_KEY_SEPARATOR = "|";
const lspKey = (rootOrConnection, serverId) =>
  typeof rootOrConnection === "string"
    ? rootOrConnection + LSP_KEY_SEPARATOR + serverId
    : rootOrConnection.root + LSP_KEY_SEPARATOR + rootOrConnection.spec.id;

const lspServers = new Map();

const lspDocuments = new Map();

function lspFileUri(filePath) {
  const posix = filePath.split("\\").join("/").replace(/^\/+/, "");

  const encoded = posix
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/%3A/gi, ":"))
    .join("/");
  return "file:///" + encoded;
}

function lspPathFromUri(uri) {
  const withoutScheme = String(uri ?? "").replace(/^file:\/\/\/?/, "");
  let decoded;
  try {
    decoded = decodeURIComponent(withoutScheme);
  } catch {

    decoded = withoutScheme;
  }
  return decoded.split("/").join("\\");
}

function lspEmit(channel, payload) {
  try {
    electron.webContents.fromId(1).send(channel, payload);
  } catch {

  }
}

function lspOffsetAt(lineStarts, position) {
  if (!position) return 0;
  const line = Math.max(0, Math.min(position.line ?? 0, lineStarts.length - 1));
  return lineStarts[line] + Math.max(0, position.character ?? 0);
}

function lspLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function createLspConnection(spec, candidate, root, env) {
  const [command, args] = candidate;
  let child;
  try {
    child = node_child_process.spawn(command, args, {
      cwd: root,
      windowsHide: true,

      shell: process.platform === "win32",

      env: env && Object.keys(env).length ? { ...process.env, ...env } : undefined,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return { ok: false, reason: "spawn-failed", detail: error.message };
  }

  const connection = {
    spec,
    command,
    root,
    child,
    nextId: 1,
    pending: new Map(),

    text: new Map(),
    ready: false,
    failed: null,
  };

  let buffer = Buffer.alloc(0);
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {

        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);

      if (!Number.isFinite(length) || length < 0 || length > LSP_MAX_MESSAGE_BYTES) {
        buffer = Buffer.alloc(0);
        continue;
      }
      const start = headerEnd + 4;
      if (buffer.length < start + length) {
        if (buffer.length > LSP_MAX_MESSAGE_BYTES * 2) buffer = Buffer.alloc(0);
        return;
      }
      const body = buffer.subarray(start, start + length).toString("utf8");
      buffer = buffer.subarray(start + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      handleLspMessage(connection, message);
    }
  });

  connection.stderr = "";
  child.stderr.on("data", (chunk) => {
    connection.stderr = (connection.stderr + chunk.toString("utf8")).slice(-2000);
  });

  child.on("error", (error) => {
    connection.failed = error.message;
    for (const { reject } of connection.pending.values()) reject(new Error(error.message));
    connection.pending.clear();
  });
  child.on("close", () => {
    connection.ready = false;
    connection.failed = connection.failed ?? "the server exited";
    for (const { reject } of connection.pending.values()) reject(new Error("the server exited"));
    connection.pending.clear();

    if (lspServers.get(lspKey(connection))?.connection === connection) {
      lspServers.delete(lspKey(connection));
    }
  });

  return { ok: true, connection };
}

function lspWrite(connection, message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  connection.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  connection.child.stdin.write(body);
}

function lspRequest(connection, method, params, timeoutMs = LSP_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const id = connection.nextId++;
    const timer = setTimeout(() => {
      connection.pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    connection.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    lspWrite(connection, { jsonrpc: "2.0", id, method, params });
  });
}

const lspNotify = (connection, method, params) =>
  lspWrite(connection, { jsonrpc: "2.0", method, params });

function handleLspMessage(connection, message) {

  if (message.method !== undefined) {
    if (message.id !== undefined) {

      lspWrite(connection, { jsonrpc: "2.0", id: message.id, result: null });
    }
    handleLspNotification(connection, message);
    return;
  }

  if (message.id !== undefined && connection.pending.has(message.id)) {
    const entry = connection.pending.get(message.id);
    connection.pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message ?? "request failed"));
    else entry.resolve(message.result);
    return;
  }

}

function handleLspNotification(connection, message) {
  if (message.method === "textDocument/publishDiagnostics") {
    const uri = message.params?.uri ?? "";
    const filePath = lspPathFromUri(uri);
    const text = connection.text.get(filePath);
    if (text === undefined) return;
    const starts = lspLineStarts(text);
    const diagnostics = (message.params?.diagnostics ?? []).map((item) => {
      const from = lspOffsetAt(starts, item.range?.start);
      const to = lspOffsetAt(starts, item.range?.end);
      return {
        from,
        to: Math.max(from, to),

        severity:
          item.severity === 1
            ? "error"
            : item.severity === 2
              ? "warning"
              : item.severity === 4
                ? "hint"
                : "info",
        message: item.source ? `${item.message} (${item.source})` : item.message,
      };
    });
    lspEmit("lsp:diagnostics", { path: filePath, diagnostics, server: connection.spec.id });
  }
}

function lspLooksMissing(detail, stderr) {
  const text = `${detail ?? ""} ${stderr ?? ""}`;
  return /ENOENT|not recognized|not found|No such file|command not found/i.test(text);
}

function lspExpandDotted(flat) {
  const out = {};
  for (const [dotted, value] of Object.entries(flat || {})) {
    const parts = String(dotted).split(".");
    let node = out;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

async function lspTryCandidate(root, spec, candidate, applied) {
  const created = createLspConnection(spec, candidate, root, applied?.env);
  if (!created.ok) return { result: created, connection: null };

  const connection = created.connection;
  const initializationOptions = lspExpandDotted(applied?.init);
  try {
    const capabilities = await lspRequest(
      connection,
      "initialize",
      {
        processId: process.pid,
        rootUri: lspFileUri(root),
        workspaceFolders: [{ uri: lspFileUri(root), name: node_path.basename(root) }],
        ...(Object.keys(initializationOptions).length ? { initializationOptions } : {}),
        capabilities: {
          textDocument: {
            synchronization: { didSave: false, dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: false },
            completion: { completionItem: { snippetSupport: false } },
            hover: { contentFormat: ["plaintext", "markdown"] },
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            documentHighlight: { dynamicRegistration: false },
            signatureHelp: {
              dynamicRegistration: false,
              signatureInformation: { documentationFormat: ["plaintext", "markdown"] },
            },
            documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
          },
          workspace: { workspaceFolders: true, symbol: { dynamicRegistration: false } },
        },
      },
      LSP_START_TIMEOUT_MS,
    );
    lspNotify(connection, "initialized", {});
    connection.ready = true;
    return {
      result: { ok: true, server: spec.id, command: candidate[0], capabilities: !!capabilities },
      connection,
    };
  } catch (error) {
    killProcessTree(connection.child);
    const detail = String(error?.message ?? error);
    return {
      result: {
        ok: false,
        reason: lspLooksMissing(detail, connection.stderr) ? "not-installed" : "start-failed",
        detail: (connection.stderr || detail).trim().slice(-400),
      },
      connection: null,
    };
  }
}

async function lspRecordedPath(id) {
  try {
    const servers = await readServers();
    const entry = servers?.[id];
    return entry && typeof entry.path === "string" && entry.path ? entry.path : null;
  } catch {
    return null;
  }
}

async function lspApplied(id) {
  const empty = { serverCommand: "", init: {}, env: {} };
  try {
    const all = await readExtensionSettings();
    const record = all?.[id];
    if (!record || typeof record !== "object") return empty;
    return {
      serverCommand: typeof record.serverCommand === "string" ? record.serverCommand : "",
      init: record.init && typeof record.init === "object" ? record.init : {},
      env: record.env && typeof record.env === "object" ? record.env : {},
    };
  } catch {
    return empty;
  }
}

async function lspEnsureServer(root, spec) {
  const key = lspKey(root, spec.id);
  const existing = lspServers.get(key);
  if (existing) return existing.started;

  const started = (async () => {
    let last = { ok: false, reason: "not-installed", detail: "" };

    if (spec.gate && !spec.gate(root)) {
      lspServers.delete(key);
      return { ok: false, reason: "not-installed", detail: "does not apply to this project" };
    }

    const applied = await lspApplied(spec.id);
    const recorded = await lspRecordedPath(spec.id);
    let candidates = recorded
      ? [[recorded, spec.candidates[0]?.[1] ?? []], ...spec.candidates]
      : spec.candidates;
    if (applied.serverCommand) {
      candidates = [[applied.serverCommand, spec.candidates[0]?.[1] ?? []], ...candidates];
    }

    if (spec.augmentArgs) {
      const extra = spec.augmentArgs(root) || [];
      candidates = candidates.map(([command, args]) => [command, [...(args || []), ...extra]]);
    }
    for (const candidate of candidates) {
      const attempt = await lspTryCandidate(root, spec, candidate, applied);
      if (attempt.result.ok) {
        lspServers.set(key, { connection: attempt.connection, started });
        return attempt.result;
      }
      last = attempt.result;

      if (attempt.result.reason !== "not-installed") break;
    }
    lspServers.delete(key);
    return { ...last, tried: candidates.map((candidate) => candidate[0]) };
  })();

  lspServers.set(key, { connection: null, started });
  return started;
}

function lspStopAll() {
  for (const [, entry] of lspServers) {

    if (!entry.connection) continue;
    try {
      lspNotify(entry.connection, "exit", {});
    } catch {}

    killProcessTree(entry.connection.child);
  }
  lspServers.clear();
  lspDocuments.clear();
}

function registerLspHandlers() {

  electron.ipcMain.handle("lsp:capability", (_event, filePath) => {
    const extension = node_path.extname(String(filePath ?? "")).slice(1).toLowerCase();
    const spec = LSP_SERVERS[extension];
    if (!spec) return { available: false };

    if (spec.gate && !spec.gate(node_path.dirname(String(filePath ?? "")))) return { available: false };
    return { available: true, server: spec.id, command: lspPrimaryCommand(spec) };
  });

  electron.ipcMain.handle("lsp:open", async (_event, root, filePath, text) => {
    if (!root || typeof filePath !== "string" || typeof text !== "string") {
      return { ok: false, reason: "bad-job" };
    }
    const extension = node_path.extname(filePath).slice(1).toLowerCase();
    const spec = LSP_SERVERS[extension];
    if (!spec) return { ok: false, reason: "no-server" };

    const started = await lspEnsureServer(root, spec);
    if (!started.ok) return started;

    const entry = lspServers.get(lspKey(root, spec.id));
    if (!entry?.connection) return { ok: false, reason: "start-failed" };
    const connection = entry.connection;

    connection.text.set(filePath, text);
    lspDocuments.set(filePath, { root, serverId: spec.id, version: 1 });
    lspNotify(connection, "textDocument/didOpen", {
      textDocument: {
        uri: lspFileUri(filePath),
        languageId: spec.language,
        version: 1,
        text,
      },
    });
    return { ok: true, server: spec.id, command: connection.command };
  });

  electron.ipcMain.handle("lsp:change", (_event, filePath, text) => {
    const doc = lspDocuments.get(filePath);
    if (!doc) return { ok: false, reason: "not-open" };
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (!entry?.connection) return { ok: false, reason: "no-server" };
    doc.version += 1;
    entry.connection.text.set(filePath, text);
    lspNotify(entry.connection, "textDocument/didChange", {
      textDocument: { uri: lspFileUri(filePath), version: doc.version },
      contentChanges: [{ text }],
    });
    return { ok: true };
  });

  electron.ipcMain.handle("lsp:close", (_event, filePath) => {
    const doc = lspDocuments.get(filePath);
    if (!doc) return { ok: true };
    lspDocuments.delete(filePath);
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (entry?.connection) {
      entry.connection.text.delete(filePath);
      lspNotify(entry.connection, "textDocument/didClose", {
        textDocument: { uri: lspFileUri(filePath) },
      });
    }
    return { ok: true };
  });

  electron.ipcMain.handle("lsp:completion", async (_event, filePath, line, character) => {
    const doc = lspDocuments.get(filePath);
    if (!doc) return { items: [] };
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (!entry?.connection?.ready) return { items: [] };
    try {
      const result = await lspRequest(entry.connection, "textDocument/completion", {
        textDocument: { uri: lspFileUri(filePath) },
        position: { line, character },
      });
      const items = Array.isArray(result) ? result : (result?.items ?? []);
      return {
        items: items.slice(0, 300).map((item) => ({
          label: item.label,
          kind: item.kind ?? null,
          detail: item.detail ?? null,
          sortText: item.sortText ?? null,
        })),
      };
    } catch {
      return { items: [] };
    }
  });

  electron.ipcMain.handle("lsp:hover", async (_event, filePath, line, character) => {
    const doc = lspDocuments.get(filePath);
    if (!doc) return null;
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (!entry?.connection?.ready) return null;
    try {
      const result = await lspRequest(entry.connection, "textDocument/hover", {
        textDocument: { uri: lspFileUri(filePath) },
        position: { line, character },
      });
      const contents = result?.contents;
      if (!contents) return null;
      const text = Array.isArray(contents)
        ? contents.map((part) => (typeof part === "string" ? part : (part.value ?? ""))).join("\n")
        : typeof contents === "string"
          ? contents
          : (contents.value ?? "");
      return text.trim() ? { text: text.trim() } : null;
    } catch {
      return null;
    }
  });

  const lspLocationsToOffsets = async (result) => {
    const raw = Array.isArray(result) ? result : result ? [result] : [];

    const items = raw.map((item) => ({
      uri: item.uri ?? item.targetUri,
      range: item.range ?? item.targetSelectionRange ?? item.targetRange,
    }));

    const textByFile = new Map();
    const readText = async (file) => {
      if (textByFile.has(file)) return textByFile.get(file);

      const doc = lspDocuments.get(file);
      const server = doc && lspServers.get(lspKey(doc.root, doc.serverId));
      let text = server?.connection?.text?.get(file);
      if (text === undefined) {
        try {
          text = await promises.readFile(file, "utf8");
        } catch {
          text = "";
        }
      }
      textByFile.set(file, text);
      return text;
    };

    const locations = [];
    for (const item of items) {
      if (!item.uri || !item.range) continue;
      const file = lspPathFromUri(item.uri);
      const text = await readText(file);
      const starts = lspLineStarts(text);
      const start = lspOffsetAt(starts, item.range.start);
      const end = lspOffsetAt(starts, item.range.end);
      locations.push({ file, start, length: Math.max(1, end - start) });
    }
    return locations;
  };

  const lspNavRequest = async (filePath, line, character, method) => {
    const doc = lspDocuments.get(filePath);
    if (!doc) return { locations: [] };
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (!entry?.connection?.ready) return { locations: [] };
    try {
      const params = {
        textDocument: { uri: lspFileUri(filePath) },
        position: { line, character },
      };
      if (method === "textDocument/references") params.context = { includeDeclaration: true };
      const result = await lspRequest(entry.connection, method, params);
      return { locations: await lspLocationsToOffsets(result) };
    } catch {
      return { locations: [] };
    }
  };

  electron.ipcMain.handle("lsp:definition", (_event, filePath, line, character) =>
    lspNavRequest(filePath, line, character, "textDocument/definition"));

  electron.ipcMain.handle("lsp:references", (_event, filePath, line, character) =>
    lspNavRequest(filePath, line, character, "textDocument/references"));

  electron.ipcMain.handle("lsp:signatureHelp", async (_event, filePath, line, character) => {
    const doc = lspDocuments.get(filePath);
    if (!doc) return { signatures: null };
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (!entry?.connection?.ready) return { signatures: null };
    try {
      const result = await lspRequest(entry.connection, "textDocument/signatureHelp", {
        textDocument: { uri: lspFileUri(filePath) },
        position: { line, character },
      });
      if (!result || !Array.isArray(result.signatures) || result.signatures.length === 0) {
        return { signatures: null };
      }
      const asText = (value) => (typeof value === "string" ? value : value && value.value ? value.value : "");
      const signatures = result.signatures.map((sig) => {
        const label = String(sig.label || "");
        const parameters = (sig.parameters || []).map((param) => {
          let plabel = param.label;
          if (Array.isArray(plabel)) plabel = label.slice(plabel[0], plabel[1]);
          return { label: String(plabel || ""), documentation: asText(param.documentation) };
        });
        return { label, parameters, documentation: asText(sig.documentation) };
      });
      return {
        signatures,
        activeSignature: result.activeSignature || 0,
        activeParameter: result.activeParameter || 0,
      };
    } catch {
      return { signatures: null };
    }
  });

  electron.ipcMain.handle("lsp:documentHighlight", async (_event, filePath, line, character) => {
    const doc = lspDocuments.get(filePath);
    if (!doc) return { spans: [] };
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (!entry?.connection?.ready) return { spans: [] };
    try {
      let text = entry.connection.text?.get(filePath);
      if (text === undefined) {
        try {
          text = await promises.readFile(filePath, "utf8");
        } catch {
          text = "";
        }
      }
      const starts = lspLineStarts(text);
      const result = await lspRequest(entry.connection, "textDocument/documentHighlight", {
        textDocument: { uri: lspFileUri(filePath) },
        position: { line, character },
      });
      const items = Array.isArray(result) ? result : [];
      const spans = [];
      for (const item of items) {
        if (!item || !item.range) continue;
        const start = lspOffsetAt(starts, item.range.start);
        const end = lspOffsetAt(starts, item.range.end);
        spans.push({ start, length: Math.max(1, end - start), write: item.kind === 3 });
      }
      return { spans };
    } catch {
      return { spans: [] };
    }
  });

  electron.ipcMain.handle("lsp:documentSymbol", async (_event, filePath) => {
    const doc = lspDocuments.get(filePath);
    if (!doc) return { symbols: [] };
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (!entry?.connection?.ready) return { symbols: [] };
    try {
      let text = entry.connection.text?.get(filePath);
      if (text === undefined) {
        try {
          text = await promises.readFile(filePath, "utf8");
        } catch {
          text = "";
        }
      }
      const starts = lspLineStarts(text);
      const result = await lspRequest(entry.connection, "textDocument/documentSymbol", {
        textDocument: { uri: lspFileUri(filePath) },
      });
      if (!Array.isArray(result) || result.length === 0) return { symbols: [] };
      const hierarchical = Boolean(result[0] && result[0].selectionRange);
      const fromDoc = (node) => ({
        name: node.name,
        kind: node.kind,
        offset: lspOffsetAt(starts, (node.selectionRange || node.range).start),
        children: (node.children || []).map(fromDoc),
      });
      const fromInfo = (node) => ({
        name: node.name,
        kind: node.kind,
        offset: node.location ? lspOffsetAt(starts, node.location.range.start) : 0,
        children: [],
      });
      return { symbols: hierarchical ? result.map(fromDoc) : result.map(fromInfo) };
    } catch {
      return { symbols: [] };
    }
  });

  electron.ipcMain.handle("lsp:workspaceSymbol", async (_event, filePath, query) => {
    const doc = lspDocuments.get(filePath);
    if (!doc || !query) return { items: [] };
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (!entry?.connection?.ready) return { items: [] };
    try {
      const result = await lspRequest(entry.connection, "workspace/symbol", { query });
      if (!Array.isArray(result)) return { items: [] };
      const items = result
        .map((symbol) => {
          const uri = symbol.location?.uri;
          if (!uri) return null;
          return {
            name: symbol.name,
            kind: symbol.kind,
            file: lspPathFromUri(uri),
            line: symbol.location?.range?.start?.line ?? 0,
            container: symbol.containerName || "",
          };
        })
        .filter(Boolean)
        .slice(0, 128);
      return { items };
    } catch {
      return { items: [] };
    }
  });

  electron.ipcMain.handle("lsp:rename", async (_event, filePath, line, character, newName) => {
    const doc = lspDocuments.get(filePath);
    if (!doc) return { ok: false, error: "The file is not open." };
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (!entry?.connection?.ready) return { ok: false, error: "No language server." };
    let result;
    try {
      result = await lspRequest(entry.connection, "textDocument/rename", {
        textDocument: { uri: lspFileUri(filePath) },
        position: { line, character },
        newName,
      });
    } catch (error) {
      return { ok: false, error: String(error?.message || "The rename was refused.") };
    }
    if (!result) return { ok: false, error: "Nothing to rename here." };

    const perFile = new Map();
    const collect = (uri, edits) => {
      const file = lspPathFromUri(uri);
      const list = perFile.get(file) ?? [];
      for (const edit of edits ?? []) list.push(edit);
      perFile.set(file, list);
    };
    if (result.changes) {
      for (const [uri, edits] of Object.entries(result.changes)) collect(uri, edits);
    }
    for (const change of result.documentChanges ?? []) {
      if (change.textDocument && change.edits) collect(change.textDocument.uri, change.edits);
    }

    const textByFile = new Map();
    const readText = async (file) => {
      if (textByFile.has(file)) return textByFile.get(file);
      const d = lspDocuments.get(file);
      const server = d && lspServers.get(lspKey(d.root, d.serverId));
      let text = server?.connection?.text?.get(file);
      if (text === undefined) {
        try { text = await promises.readFile(file, "utf8"); } catch { text = ""; }
      }
      textByFile.set(file, text);
      return text;
    };

    const files = [];
    for (const [file, edits] of perFile) {
      const starts = lspLineStarts(await readText(file));
      files.push({
        file,
        edits: edits.map((edit) => {
          const start = lspOffsetAt(starts, edit.range.start);
          const end = lspOffsetAt(starts, edit.range.end);
          return { start, length: Math.max(0, end - start), newText: edit.newText };
        }),
      });
    }
    return { ok: true, files };
  });

  const workspaceEditToFiles = async (edit) => {
    if (!edit) return [];
    const perFile = new Map();
    const collect = (uri, edits) => {
      const file = lspPathFromUri(uri);
      const list = perFile.get(file) ?? [];
      for (const e of edits ?? []) list.push(e);
      perFile.set(file, list);
    };
    if (edit.changes) for (const [uri, edits] of Object.entries(edit.changes)) collect(uri, edits);
    for (const change of edit.documentChanges ?? []) {
      if (change.textDocument && change.edits) collect(change.textDocument.uri, change.edits);
    }
    const textByFile = new Map();
    const readText = async (file) => {
      if (textByFile.has(file)) return textByFile.get(file);
      const d = lspDocuments.get(file);
      const server = d && lspServers.get(lspKey(d.root, d.serverId));
      let text = server?.connection?.text?.get(file);
      if (text === undefined) {
        try { text = await promises.readFile(file, "utf8"); } catch { text = ""; }
      }
      textByFile.set(file, text);
      return text;
    };
    const files = [];
    for (const [file, edits] of perFile) {
      const starts = lspLineStarts(await readText(file));
      files.push({
        file,
        edits: edits.map((e) => {
          const start = lspOffsetAt(starts, e.range.start);
          const end = lspOffsetAt(starts, e.range.end);
          return { start, length: Math.max(0, end - start), newText: e.newText };
        }),
      });
    }
    return files;
  };

  electron.ipcMain.handle("lsp:codeActions", async (_event, filePath, startLine, startChar, endLine, endChar, codes) => {
    const doc = lspDocuments.get(filePath);
    if (!doc) return { actions: [] };
    const entry = lspServers.get(lspKey(doc.root, doc.serverId));
    if (!entry?.connection?.ready) return { actions: [] };
    try {
      const result = await lspRequest(entry.connection, "textDocument/codeAction", {
        textDocument: { uri: lspFileUri(filePath) },
        range: {
          start: { line: startLine, character: startChar },
          end: { line: endLine, character: endChar },
        },
        context: { diagnostics: [] },
      });
      const actions = [];
      for (const item of Array.isArray(result) ? result : []) {

        const edit = item.edit;
        if (!edit) continue;
        const files = await workspaceEditToFiles(edit);
        if (files.length) actions.push({ kind: item.kind || "action", title: item.title, files });
      }
      return { actions };
    } catch {
      return { actions: [] };
    }
  });

  electron.ipcMain.handle("lsp:stopAll", () => {
    lspStopAll();
    return { ok: true };
  });
}
