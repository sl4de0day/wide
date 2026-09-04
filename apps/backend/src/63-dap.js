

const DAP_PY_EXT = /\.pyw?$/i;

function dapRef(n) {
  return "dap:" + n;
}
function dapUnref(id) {
  const n = parseInt(String(id == null ? "" : id).replace(/^dap:/, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function dapFrame(msg) {
  const body = JSON.stringify(msg);
  return "Content-Length: " + Buffer.byteLength(body, "utf8") + "\r\n\r\n" + body;
}

function makeDapParser(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buf.slice(0, headerEnd).toString("utf8");
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        buf = buf.slice(headerEnd + 4);
        continue;
      }
      const len = parseInt(m[1], 10);
      const start = headerEnd + 4;
      if (buf.length < start + len) return;
      const body = buf.slice(start, start + len).toString("utf8");
      buf = buf.slice(start + len);
      try {
        onMessage(JSON.parse(body));
      } catch {

      }
    }
  };
}

function dapEmit(payload) {
  if (dbg && dbg.sender && !dbg.sender.isDestroyed()) dbg.sender.send("debug:event", payload);
}

function dapSend(command, args) {
  if (!dbg || dbg.kind !== "dap" || typeof dbg.write !== "function") {
    return Promise.reject(new Error("no debug session"));
  }
  const seq = ++dbg.seq;
  const req = { seq, type: "request", command, arguments: args || {} };
  return new Promise((resolve, reject) => {
    dbg.pending.set(seq, { resolve, reject });
    try {
      dbg.write(dapFrame(req));
    } catch (error) {
      dbg.pending.delete(seq);
      reject(error);
    }
  });
}

async function dapInitAndLaunch(startArgs, adapterID, startCommand) {
  await dapSend("initialize", {
    clientID: "wide",
    clientName: "Wide",
    adapterID: adapterID || "dap",
    locale: "en",
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: "path",
    supportsVariableType: true,
    supportsRunInTerminalRequest: false,
  });
  dapSendQuiet(startCommand || "launch", startArgs);
}

function dapSendQuiet(command, args) {
  dapSend(command, args).catch(() => {});
}

function dapHandle(msg) {
  if (!dbg || dbg.kind !== "dap") return;
  if (msg.type === "response") {
    const pending = dbg.pending.get(msg.request_seq);
    if (pending) {
      dbg.pending.delete(msg.request_seq);
      if (msg.success) pending.resolve(msg.body || {});
      else pending.reject(new Error(msg.message || (msg.command + " failed")));
    }
    return;
  }
  if (msg.type === "event") void dapEvent(msg);
}

async function dapEvent(msg) {
  switch (msg.event) {
    case "initialized":

      dbg.initialized = true;
      await dapApplyAllBreakpoints();
      try {
        await dapSend("setExceptionBreakpoints", { filters: dapExceptionFilters() });
      } catch {

      }
      dapSendQuiet("configurationDone", {});
      break;
    case "stopped": {
      const threadId = (msg.body && msg.body.threadId) || dbg.threadId || 1;
      dbg.threadId = threadId;
      const frames = await dapBuildFrames(threadId);
      dbg.paused = true;
      dapEmit({ type: "paused", reason: (msg.body && msg.body.reason) || "breakpoint", frames });
      break;
    }
    case "continued":
      dbg.paused = false;
      dapEmit({ type: "resumed" });
      break;
    case "output": {
      const category = (msg.body && msg.body.category) || "stdout";
      const text = (msg.body && msg.body.output) || "";
      if (category === "stderr") dapEmit({ type: "output", stream: "stderr", text });
      else if (category === "stdout") dapEmit({ type: "output", stream: "stdout", text });
      else dapEmit({ type: "console", level: category === "important" ? "error" : "log", text });
      break;
    }
    case "thread":
      if (msg.body && msg.body.reason === "started" && !dbg.threadId) dbg.threadId = msg.body.threadId;
      break;
    case "terminated":
    case "exited": {
      const code = msg.body && typeof msg.body.exitCode === "number" ? msg.body.exitCode : 0;
      dapEmit({ type: "exited", code });
      dapStop();
      break;
    }
    default:
      break;
  }
}

function dapExceptionFilters() {
  const mode = dbg && dbg.exceptionMode;
  if (mode === "all") return ["raised", "uncaught"];
  if (mode === "uncaught") return ["uncaught"];
  return [];
}

async function dapBuildFrames(threadId) {
  let stack;
  try {
    stack = await dapSend("stackTrace", { threadId, startFrame: 0, levels: 20 });
  } catch {
    return [];
  }
  const frames = [];
  for (const frame of stack.stackFrames || []) {
    let scopes = [];
    try {
      const sc = await dapSend("scopes", { frameId: frame.id });
      scopes = (sc.scopes || [])
        .filter((s) => !s.expensive)
        .map((s) => ({
          type: String(s.name || "scope").toLowerCase().replace(/\s+/g, "-"),
          name: s.name || "Scope",
          objectId: dapRef(s.variablesReference),
        }));
    } catch {

    }
    const filePath = (frame.source && frame.source.path) || "";
    frames.push({
      id: dapRef(frame.id),
      name: frame.name || "(anonymous)",
      url: filePath ? debugFileUrl(filePath) : "",
      line: Math.max(0, (frame.line || 1) - 1),
      column: Math.max(0, (frame.column || 1) - 1),
      scopes,
    });
  }
  return frames;
}

async function dapSetFileBreakpoints(file) {
  if (!dbg || dbg.kind !== "dap") return;
  const lines = [...(dbg.bpByFile[file] || new Set())].sort((a, b) => a - b);
  try {
    await dapSend("setBreakpoints", {
      source: { path: file },
      breakpoints: lines.map((line) => ({ line: line + 1 })),
    });
  } catch {

  }
}

async function dapApplyAllBreakpoints() {
  const byFile = {};
  for (const bp of dbg.breakpoints || []) {
    (byFile[bp.file] = byFile[bp.file] || new Set()).add(bp.line);
  }
  dbg.bpByFile = byFile;
  for (const file of Object.keys(byFile)) await dapSetFileBreakpoints(file);
}

async function dapFindPython() {
  await refreshPath();
  for (const name of ["python", "python3", "py"]) {
    if (await commandExists(name)) return name;
  }
  return null;
}

async function dapHasDebugpy(python) {
  const out = await readCommand(python, ["-c", "import debugpy, sys; sys.stdout.write('ok')"]);
  return typeof out === "string" && out.indexOf("ok") !== -1;
}

async function dapStartPython(event, cwd, file, breakpoints) {

  try {
    await debugStop();
  } catch {

  }

  const python = await dapFindPython();
  if (!python) return { ok: false, error: "Python was not found on PATH. Install Python (and the Python Debugger extension)." };
  if (!(await dapHasDebugpy(python))) {
    return { ok: false, error: "debugpy is not installed. Install the Python Debugger extension (it runs: pip install debugpy)." };
  }

  let child;
  try {
    child = node_child_process.spawn(python, ["-m", "debugpy.adapter"], {
      cwd: cwd || undefined,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }

  dbg = {
    kind: "dap",
    child,
    sender: event.sender,
    seq: 0,
    pending: new Map(),
    breakpoints: breakpoints || [],
    bpByFile: {},
    root: cwd,
    file,
    threadId: null,
    paused: false,
    initialized: false,
    exceptionMode: "none",
    write: (s) => {
      if (child.stdin.writable) child.stdin.write(s);
    },
  };

  const sender = event.sender;
  const emit = (payload) => {
    if (sender && !sender.isDestroyed()) sender.send("debug:event", payload);
  };
  const parse = makeDapParser(dapHandle);
  child.stdout.on("data", (chunk) => parse(chunk));

  child.stderr.on("data", (chunk) => emit({ type: "output", stream: "stderr", text: chunk.toString("utf8") }));
  child.on("error", (error) => {
    emit({ type: "output", stream: "stderr", text: String(error && error.message ? error.message : error) });
    if (dbg && dbg.child === child) dbg = null;
  });
  child.on("close", () => {
    emit({ type: "closed" });
    if (dbg && dbg.child === child) dbg = null;
  });

  try {
    await dapInitAndLaunch(
      {
        request: "launch",
        name: "Wide: Python",
        type: "python",
        program: file,
        cwd: cwd || undefined,
        console: "internalConsole",
        justMyCode: false,
        stopOnEntry: false,
      },
      "debugpy",
    );
  } catch (error) {
    dapStop();
    return { ok: false, error: "debugpy did not start: " + String(error && error.message ? error.message : error) };
  }

  return { ok: true };
}

function dapConnectWithRetry(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = node_net.connect(port, "127.0.0.1");
      socket.once("connect", () => resolve(socket));
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() < deadline) setTimeout(attempt, 150);
        else resolve(null);
      });
    };
    attempt();
  });
}

async function dapFindDelve() {
  await refreshPath();
  const onPath = await commandExists("dlv");
  if (onPath) return onPath;
  const gopath = await readCommand("go", ["env", "GOPATH"]);
  if (gopath) {
    const root = gopath.trim().split(/\r?\n/)[0];
    const candidate = node_path.join(root, "bin", process.platform === "win32" ? "dlv.exe" : "dlv");
    try {
      if (node_fs.existsSync(candidate)) return candidate;
    } catch {

    }
  }
  return null;
}

async function dapStartTcp(event, cwd, file, breakpoints, opts) {
  try {
    await debugStop();
  } catch {

  }

  const port = await debugFreePort();
  let child;
  try {
    child = node_child_process.spawn(opts.bin, opts.args(port, file), {
      cwd: cwd || undefined,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }

  const sender = event.sender;
  const emit = (payload) => {
    if (sender && !sender.isDestroyed()) sender.send("debug:event", payload);
  };

  child.stderr.on("data", (chunk) => emit({ type: "output", stream: "stderr", text: chunk.toString("utf8") }));
  child.on("close", () => {
    emit({ type: "closed" });
    if (dbg && dbg.child === child) dbg = null;
  });

  const socket = await dapConnectWithRetry(port, 6000);
  if (!socket) {
    killProcessTree(child);
    return { ok: false, error: "The " + opts.label + " DAP server did not start." };
  }

  dbg = {
    kind: "dap",
    child,
    socket,
    sender,
    seq: 0,
    pending: new Map(),
    breakpoints: breakpoints || [],
    bpByFile: {},
    root: cwd,
    file,
    threadId: null,
    paused: false,
    initialized: false,
    exceptionMode: "none",
    write: (s) => socket.write(s),
  };

  const parse = makeDapParser(dapHandle);
  socket.on("data", (chunk) => parse(chunk));
  socket.on("error", () => {});
  socket.on("close", () => {
    emit({ type: "closed" });
    if (dbg && dbg.socket === socket) dbg = null;
  });

  try {
    await dapInitAndLaunch(opts.startArgs, opts.adapterID, opts.startCommand);
  } catch (error) {
    dapStop();
    return { ok: false, error: opts.label + " did not start: " + String(error && error.message ? error.message : error) };
  }

  return { ok: true };
}

async function dapStartGo(event, cwd, file, breakpoints) {
  const dlv = await dapFindDelve();
  if (!dlv) return { ok: false, error: "Delve (dlv) was not found. Install the Go Debugger extension (it runs: go install …/dlv@latest)." };
  return dapStartTcp(event, cwd, file, breakpoints, {
    bin: dlv,
    label: "Delve",
    args: (port) => ["dap", "--listen=127.0.0.1:" + port],
    startCommand: "launch",
    startArgs: { request: "launch", name: "Wide: Go", type: "go", mode: "debug", program: file, cwd: cwd || undefined, stopOnEntry: false },
    adapterID: "go",
  });
}

async function dapStartRuby(event, cwd, file, breakpoints) {
  await refreshPath();
  const rdbg = await commandExists("rdbg");
  if (!rdbg) return { ok: false, error: "rdbg was not found. Install the Ruby Debugger extension (it runs: gem install debug)." };
  return dapStartTcp(event, cwd, file, breakpoints, {
    bin: rdbg,
    label: "rdbg",
    args: (port, f) => ["--open", "--host=127.0.0.1", "--port=" + port, "--stop-at-load", "--", f],
    startCommand: "attach",
    startArgs: { request: "attach", name: "Wide: Ruby" },
    adapterID: "ruby",
  });
}

function dapResume() {
  dapSendQuiet("continue", { threadId: dbg.threadId || 1 });
  return { ok: true };
}
function dapStepOver() {
  dapSendQuiet("next", { threadId: dbg.threadId || 1 });
  return { ok: true };
}
function dapStepInto() {
  dapSendQuiet("stepIn", { threadId: dbg.threadId || 1 });
  return { ok: true };
}
function dapStepOut() {
  dapSendQuiet("stepOut", { threadId: dbg.threadId || 1 });
  return { ok: true };
}
function dapPause() {
  dapSendQuiet("pause", { threadId: dbg.threadId || 1 });
  return { ok: true };
}

function dapPauseOnExceptions(state) {
  dbg.exceptionMode = state === "all" || state === "uncaught" ? state : "none";
  dapSendQuiet("setExceptionBreakpoints", { filters: dapExceptionFilters() });
  return { ok: true };
}

async function dapProperties(objectId) {
  const variablesReference = dapUnref(objectId);
  if (!variablesReference) return { properties: [] };
  try {
    const res = await dapSend("variables", { variablesReference });
    return {
      properties: (res.variables || []).map((v) => ({
        name: v.name,
        value: v.value != null ? String(v.value) : "",
        objectId: v.variablesReference ? dapRef(v.variablesReference) : null,
      })),
    };
  } catch {
    return { properties: [] };
  }
}

async function dapEvaluate(callFrameId, expression) {
  const args = { expression, context: "repl" };
  if (callFrameId != null) args.frameId = dapUnref(callFrameId);
  try {
    const res = await dapSend("evaluate", args);
    return { value: res.result != null ? String(res.result) : "", objectId: res.variablesReference ? dapRef(res.variablesReference) : null };
  } catch (error) {
    return { value: "", error: String(error && error.message ? error.message : error) };
  }
}

async function dapSetBreakpoint(file, line, on) {
  if (!dbg || dbg.kind !== "dap") return { ok: true };
  const set = (dbg.bpByFile[file] = dbg.bpByFile[file] || new Set());
  if (on) set.add(line);
  else set.delete(line);
  await dapSetFileBreakpoints(file);
  return { ok: true, id: null };
}

function dapStop() {
  if (!dbg || dbg.kind !== "dap") return { ok: true };
  const session = dbg;
  dbg = null;
  try {
    if (session.socket) session.socket.destroy();
  } catch {

  }
  try {
    if (session.child && session.child.stdin && session.child.stdin.writable) session.child.stdin.end();
  } catch {

  }
  if (session.child) killProcessTree(session.child);
  return { ok: true };
}
