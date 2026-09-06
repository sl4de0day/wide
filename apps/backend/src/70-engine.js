

function registerEngineHandlers() {
  electron.ipcMain.handle("engine:entries", (_event, root) => listEntries(root));
  electron.ipcMain.handle("engine:start", async (_event, root, directory = "") => {
    if (!root) return fail$1("No project is open.");
    let served;
    try {
      served = directory ? resolveInProject(root, directory) : root;
    } catch (error) {
      return fail$1(error);
    }
    stopServer();
    try {
      server = await listen(served);

      const watching = startWatching(served, (relative) => pushReload(relative));
      return ok$1({ status: currentStatus(), directory, watching });
    } catch (error) {
      server = null;
      return fail$1(error);
    }
  });
  electron.ipcMain.handle("engine:stop", () => {
    detach();
    stopServer();
    return ok$1({ status: currentStatus() });
  });
  electron.ipcMain.handle("engine:status", () => currentStatus());
  electron.ipcMain.handle("engine:reload", (_event, path = "") => ({ reloaded: pushReload(path) }));
}

const PROJECT_DIR = ".wide";
const LEGACY_PROJECT_DIR = ".handcuffs";
function disposeEngine() {
  detach();
  stopServer();
}
const MANIFEST = "tool.json";
const PROJECT_TOOLS = node_path.join(PROJECT_DIR, "tools");
const LEGACY_PROJECT_TOOLS = node_path.join(LEGACY_PROJECT_DIR, "tools");
const ID = /^[a-z][a-z0-9-]{1,39}$/;
const userToolsDir = () => node_path.join(electron.app.getPath("userData"), "tools");
const projectToolsDir = (root) => node_path.join(root, PROJECT_TOOLS);
async function discover(root) {
  const sources = [
    root ? { origin: "project", dir: projectToolsDir(root) } : null,

    root ? { origin: "project", dir: node_path.join(root, LEGACY_PROJECT_TOOLS) } : null,
    { origin: "user", dir: userToolsDir() }
  ].filter(Boolean);
  const byId =  new Map();
  const problems = [];
  for (const source of sources) {
    for (const folder of await folders(source.dir)) {
      const outcome = await readManifest(folder, source.origin);
      if (outcome.problem) {
        problems.push(outcome.problem);
        continue;
      }
      if (byId.has(outcome.tool.id)) {
        const first = byId.get(outcome.tool.id);
        problems.push({
          where: folder,
          message: `Two tools call themselves "${outcome.tool.id}". The one in ${first.origin} is the one being used.`
        });
        continue;
      }
      byId.set(outcome.tool.id, outcome.tool);
    }
  }
  return { tools: [...byId.values()], problems };
}
async function folders(dir2) {
  try {
    const entries = await promises.readdir(dir2, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => node_path.join(dir2, entry.name)).sort();
  } catch {
    return [];
  }
}
async function readManifest(folder, origin) {
  const manifestPath = node_path.join(folder, MANIFEST);
  let raw;
  try {
    raw = await promises.readFile(manifestPath, "utf8");
  } catch {
    return { problem: { where: folder, message: `No ${MANIFEST} in this folder.` } };
  }
  let manifest2;
  try {
    manifest2 = JSON.parse(raw);
  } catch (error) {
    return { problem: { where: manifestPath, message: `Unreadable JSON: ${error.message}` } };
  }
  const complaint = (message) => ({ problem: { where: manifestPath, message } });
  if (!ID.test(manifest2.id ?? "")) {
    return complaint('"id" has to be lower-case letters, digits and dashes, 2 to 40 characters.');
  }
  if (typeof manifest2.name !== "string" || !manifest2.name.trim()) {
    return complaint('"name" is missing.');
  }
  if (!Array.isArray(manifest2.commands) || manifest2.commands.length === 0) {
    return complaint('"commands" has to list at least one command.');
  }
  const seen =  new Set();
  const commands = [];
  for (const command of manifest2.commands) {
    if (!ID.test(command?.id ?? "")) {
      return complaint(`A command id is missing or malformed: ${JSON.stringify(command?.id)}`);
    }
    if (seen.has(command.id)) return complaint(`Two commands share the id "${command.id}".`);
    seen.add(command.id);
    if (typeof command.title !== "string" || !command.title.trim()) {
      return complaint(`Command "${command.id}" has no "title".`);
    }
    commands.push({
      id: command.id,
      title: command.title,
      description: String(command.description ?? ""),

      prompt: typeof command.prompt === "string" ? command.prompt : ""
    });
  }
  const capabilities = Array.isArray(manifest2.capabilities) ? manifest2.capabilities : [];
  const unknown = capabilities.filter((name) => !protocol.CAPABILITIES.includes(name));
  if (unknown.length) {
    return complaint(
      `Unknown ${unknown.length === 1 ? "capability" : "capabilities"}: ${unknown.join(", ")}. Known ones are ${protocol.CAPABILITIES.join(", ")}.`
    );
  }
  const entry = node_path.resolve(folder, manifest2.entry ?? "tool.mjs");
  if (entry !== folder && !entry.startsWith(folder + node_path.sep)) {
    return complaint('"entry" points outside the tool folder.');
  }
  try {
    if (!(await promises.stat(entry)).isFile()) throw new Error("not a file");
  } catch {
    return complaint(`"entry" does not exist: ${manifest2.entry ?? "tool.mjs"}`);
  }
  return {
    tool: {
      id: manifest2.id,
      name: manifest2.name.trim(),
      description: String(manifest2.description ?? ""),
      version: String(manifest2.version ?? "0.0.0"),
      author: String(manifest2.author ?? ""),
      origin,
      folder,
      entry,
      capabilities,
      commands
    }
  };
}
const READY_MS = 1e4;
const RUN_MS = 3e4;
const MAX_LOG_LINES = 500;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const HOST_ENTRY = node_path.join(__dirname, "toolHost.js");
let nextRun = 0;
const active =  new Map();
function cancelRun(runId) {
  const run2 = active.get(runId);
  if (!run2) return false;
  run2.cancel();
  return true;
}
function disposeTools() {
  for (const run2 of active.values()) run2.kill();
  active.clear();
}
async function runTool({ tool, command, root, active: activeFile, input, emit }) {
  if (!root) return { ok: false, error: "No project is open." };
  if (!tool.commands.some((entry) => entry.id === command)) {
    return { ok: false, error: `${tool.name} has no command called "${command}".` };
  }
  const runId = ++nextRun;
  const child = electron.utilityProcess.fork(HOST_ENTRY, [tool.entry], {
    serviceName: `wide-tool-${tool.id}`,
    stdio: "pipe"
  });
  let logLines = 0;
  let settle = null;
  const finished = new Promise((resolve) => {
    settle = resolve;
  });
  let readyTimer = null;
  let runTimer = null;
  const record2 = {
    kill: () => {
      try {
        child.kill();
      } catch {
      }
    },
    cancel: () => child.postMessage({ t: protocol.TO_TOOL.CANCEL, runId })
  };
  active.set(runId, record2);
  const done = (value) => {
    clearTimeout(readyTimer);
    clearTimeout(runTimer);
    active.delete(runId);
    record2.kill();
    settle(value);
  };
  readyTimer = setTimeout(() => done({ ok: false, error: `${tool.name} did not start.` }), READY_MS);
  let said = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk) => {
      said += chunk;
      for (const line of String(chunk).split("\n")) {
        if (line.trim()) emit({ kind: "log", toolId: tool.id, text: line.trimEnd() });
      }
    });
  }
  child.on(
    "exit",
    (code) => done({
      ok: false,
      error: said.trim() ? `${tool.name} stopped: ${said.trim().split("\n")[0]}` : `${tool.name} stopped without answering (exit ${code}).`
    })
  );
  child.on("message", async (message) => {
    if (!message || typeof message !== "object") return;
    if (message.t === protocol.TO_HOST.READY) {
      clearTimeout(readyTimer);
      runTimer = setTimeout(() => {
        record2.cancel();
        setTimeout(
          () => done({
            ok: false,
            error: `${tool.name} ran for longer than ${RUN_MS / 1e3} seconds and was stopped.`
          }),
          1e3
        );
      }, RUN_MS);
      child.postMessage({
        t: protocol.TO_TOOL.RUN,
        runId,
        command,
        context: { root, active: activeFile ?? null, input: input ?? "" }
      });
      return;
    }
    if (message.t === protocol.TO_HOST.LOG) {
      if (logLines >= MAX_LOG_LINES) return;
      logLines += 1;
      emit({
        kind: "log",
        toolId: tool.id,
        text: logLines === MAX_LOG_LINES ? `… ${tool.name} has written ${MAX_LOG_LINES} lines; the rest is not shown.` : message.text
      });
      return;
    }
    if (message.t === protocol.TO_HOST.CALL) {
      let reply;
      try {
        reply = {
          t: protocol.TO_TOOL.REPLY,
          callId: message.callId,
          ok: true,
          value: await perform(message.method, message.params, { tool, root, emit })
        };
      } catch (error) {
        reply = {
          t: protocol.TO_TOOL.REPLY,
          callId: message.callId,
          ok: false,
          error: String(error?.message ?? error)
        };
      }
      try {
        child.postMessage(reply);
      } catch {
      }
      return;
    }
    if (message.t === protocol.TO_HOST.DONE) {
      done({ ok: true, result: message.result ?? null });
      return;
    }
    if (message.t === protocol.TO_HOST.FAILED) {
      done({ ok: false, error: message.message, stack: message.stack ?? "" });
    }
  });
  return { ...await finished, runId };
}
async function perform(method, params, { tool, root, emit }) {
  const needs = protocol.METHODS[method];
  if (!needs) throw new Error(`Unknown method: ${method}`);
  if (!tool.capabilities.includes(needs)) {
    throw new Error(
      `${tool.name} did not ask for the "${needs}" capability, so it cannot call ${method}. Add it to the "capabilities" list in tool.json.`
    );
  }
  const inside = (candidate) => resolveInProject(root, candidate);
  switch (method) {
    case "fs.read": {
      const path = inside(params.path);
      const text = await promises.readFile(path, "utf8");
      if (text.length > MAX_READ_BYTES) {
        throw new Error(`${params.path} is too large for a tool to read.`);
      }
      return text;
    }
    case "fs.list": {
      const path = inside(params.path);
      const entries = await promises.readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        path: node_path.join(path, entry.name),
        directory: entry.isDirectory()
      }));
    }
    case "fs.write": {
      const path = inside(params.path);
      if (typeof params.content !== "string") throw new Error("write() needs text.");
      await promises.mkdir(node_path.dirname(path), { recursive: true });
      await writeFileAtomic(path, params.content, "utf8");
      return null;
    }
    case "project.files": {
      const index = await indexProject(root);
      return (index.files ?? []).map((file) => file.relativePath ?? file.path ?? file);
    }
    case "project.search": {
      const found = await searchInFiles(root, {
        query: String(params.query ?? ""),
        regexp: Boolean(params.options?.regex),
        caseSensitive: Boolean(params.options?.caseSensitive)
      });
      if (found.error) throw new Error(found.error);
      const hits = [];
      for (const file of found.files ?? []) {
        for (const match of file.matches ?? []) {
          hits.push({
            path: file.path,
            relative: file.relativePath ?? node_path.relative(root, file.path),
            line: match.line,
            column: match.column ?? 0,
            text: match.text ?? ""
          });
        }
      }
      return hits;
    }
    case "editor.open":
      emit({ kind: "effect", toolId: tool.id, effect: "open", path: inside(params.path) });
      return null;
    case "editor.replace":
      if (typeof params.content !== "string") throw new Error("replace() needs text.");
      emit({ kind: "effect", toolId: tool.id, effect: "replace", content: params.content });
      return null;
    case "editor.insert":
      if (typeof params.text !== "string") throw new Error("insert() needs text.");
      emit({ kind: "effect", toolId: tool.id, effect: "insert", text: params.text });
      return null;
    case "ui.notify":
      emit({ kind: "notify", toolId: tool.id, message: String(params.message ?? "") });
      return null;
    case "ui.output":
      emit({ kind: "output", toolId: tool.id, result: params.result ?? "" });
      return null;
    default:
      throw new Error(`Unhandled method: ${method}`);
  }
}
const ok = (value) => ({ ok: true, ...value });
const fail = (error) => ({ ok: false, error: String(error?.message ?? error) });
const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
