"use strict";
const node_url = require("node:url");
const protocol = require("./chunks/protocol.js");
const parentPort = process.parentPort;
const entry = process.argv[2];
let commands = {};
const running = /* @__PURE__ */ new Map();
const pending = /* @__PURE__ */ new Map();
let nextCall = 0;
const post = (message) => parentPort.postMessage(message);
function call(method, params) {
  if (!(method in protocol.METHODS)) {
    return Promise.reject(new Error(`Unknown editor method: ${method}`));
  }
  const callId = ++nextCall;
  return new Promise((resolve, reject) => {
    pending.set(callId, { resolve, reject });
    post({ t: protocol.TO_HOST.CALL, callId, method, params });
  });
}
function contextFor(runId, base, signal) {
  const log = (...parts) => post({
    t: protocol.TO_HOST.LOG,
    runId,
    level: "info",
    text: parts.map((part) => typeof part === "string" ? part : safeInspect(part)).join(" ")
  });
  return {
    root: base.root,
    active: base.active,
    input: base.input ?? "",
    signal,
    log,
    fs: {
      read: (path) => call("fs.read", { path }),
      list: (path) => call("fs.list", { path }),
      write: (path, content) => call("fs.write", { path, content })
    },
    project: {
      files: () => call("project.files", {}),
      search: (query, options) => call("project.search", { query, options: options ?? {} })
    },
    editor: {
      open: (path) => call("editor.open", { path }),
      replace: (content) => call("editor.replace", { content }),
      insert: (text) => call("editor.insert", { text })
    },
    ui: {
      notify: (message) => call("ui.notify", { message }),
      output: (result) => call("ui.output", { result })
    }
  };
}
function safeInspect(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
parentPort.on("message", async (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.t === protocol.TO_TOOL.REPLY) {
    const waiting = pending.get(message.callId);
    if (!waiting) return;
    pending.delete(message.callId);
    if (message.ok) waiting.resolve(message.value);
    else waiting.reject(new Error(message.error));
    return;
  }
  if (message.t === protocol.TO_TOOL.CANCEL) {
    running.get(message.runId)?.abort(new Error("The run was cancelled."));
    return;
  }
  if (message.t !== protocol.TO_TOOL.RUN) return;
  const { runId, command, context } = message;
  const run = commands[command];
  if (typeof run !== "function") {
    post({ t: protocol.TO_HOST.FAILED, runId, message: `This tool has no command called "${command}".` });
    return;
  }
  const controller = new AbortController();
  running.set(runId, controller);
  try {
    const result = await run(contextFor(runId, context, controller.signal));
    post({ t: protocol.TO_HOST.DONE, runId, result: serialisable(result) });
  } catch (error) {
    post({
      t: protocol.TO_HOST.FAILED,
      runId,
      message: String(error?.message ?? error),
      stack: String(error?.stack ?? "")
    });
  } finally {
    running.delete(runId);
  }
});
function serialisable(value) {
  if (value === void 0) return null;
  try {
    structuredClone(value);
    return value;
  } catch {
    return String(value);
  }
}
async function load() {
  try {
    const module = await import(
      /* @vite-ignore */
      node_url.pathToFileURL(entry).href
    );
    const exported = module.default ?? module.commands ?? module;
    if (!exported || typeof exported !== "object") {
      throw new Error("The tool has no default export of commands.");
    }
    commands = exported;
    post({
      t: protocol.TO_HOST.READY,
      commands: Object.keys(commands).filter((id) => typeof commands[id] === "function")
    });
  } catch (error) {
    post({
      t: protocol.TO_HOST.FAILED,
      runId: null,
      message: `${entry}: ${error?.message ?? error}`,
      stack: String(error?.stack ?? "")
    });
  }
}
load();
