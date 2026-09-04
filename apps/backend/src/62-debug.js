

let dbg = null;

function debugBpKey(file, line) {
  return `${file}:${line}`;
}

function smResolveForScript(bp, scriptUrl, map) {
  if (map) {
    if (!smHasSource(map, bp.file)) return null;
    const g = smGeneratedPositionFor(map, bp.file, bp.line);
    if (!g) return null;
    return { url: scriptUrl, line: g.line, column: g.column };
  }
  if (smUrlBaseName(scriptUrl) === smBaseName(bp.file)) return { url: scriptUrl, line: bp.line, column: 0 };
  return null;
}

function debugResolveOriginal(source) {
  if (!source || !dbg) return null;
  const base = smBaseName(source);
  for (const bp of dbg.breakpoints) {
    if (smBaseName(bp.file) === base) return bp.file;
  }
  if (dbg.root) {
    const rel = String(source)
      .replace(/^webpack:\/\/[^/]*\//, "")
      .replace(/^\/@fs\//, "/")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");
    return node_path.join(dbg.root, rel.split("/").join(node_path.sep));
  }
  return null;
}

async function debugSetBpOnScript(bp, scriptUrl, map) {
  const where = smResolveForScript(bp, scriptUrl, map);
  if (!where || !dbg) return;
  const result = await debugSend("Debugger.setBreakpointByUrl", {
    url: where.url,
    lineNumber: where.line,
    columnNumber: where.column || 0,
    condition: bp.condition || undefined,
  });
  if (dbg && result && result.breakpointId) {
    const key = debugBpKey(bp.file, bp.line);
    const list = dbg.bpIds.get(key) || [];
    list.push(result.breakpointId);
    dbg.bpIds.set(key, list);
  }
}

async function debugOnScriptParsed(scriptId, scriptUrl, sourceMapURL) {
  const session = dbg;
  if (!session) return;
  const map = sourceMapURL ? await smLoad(scriptUrl, sourceMapURL) : null;
  if (dbg !== session) return;
  session.scriptMaps.set(scriptId, map);
  for (const bp of session.breakpoints) await debugSetBpOnScript(bp, scriptUrl, map);
}

async function debugBindBrowserBreakpoint(bp) {
  if (!dbg) return;
  for (const [scriptId, scriptUrl] of dbg.scripts) {
    await debugSetBpOnScript(bp, scriptUrl, dbg.scriptMaps.get(scriptId));
  }
}

function debugFreePort() {
  return new Promise((resolve) => {
    const probe = node_net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
    probe.on("error", () => resolve(9229));
  });
}

function debugFileUrl(filePath) {
  const posix = String(filePath).split("\\").join("/").replace(/^\/+/, "");
  const encoded = posix
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/%3A/gi, ":"))
    .join("/");
  return "file:///" + encoded;
}

function debugSend(method, params) {
  if (!dbg || !dbg.ws || dbg.ws.readyState !== 1) return Promise.resolve(null);
  const id = (dbg.seq += 1);
  const message = JSON.stringify({ id, method, params: params || {} });
  return new Promise((resolve) => {
    dbg.pending.set(id, resolve);
    try {
      dbg.ws.send(message);
    } catch {
      dbg.pending.delete(id);
      resolve(null);
    }
  });
}

function debugEmit(payload) {
  if (dbg && dbg.sender && !dbg.sender.isDestroyed()) dbg.sender.send("debug:event", payload);
}

function debugHandle(message) {
  let data;
  try {
    data = JSON.parse(message);
  } catch {
    return;
  }
  if (typeof data.id === "number") {
    const resolve = dbg && dbg.pending.get(data.id);
    if (resolve) {
      dbg.pending.delete(data.id);
      resolve(data.result ?? (data.error ? { error: data.error } : null));
    }
    return;
  }

  const method = data.method;
  const params = data.params || {};
  if (method === "Debugger.scriptParsed") {
    if (dbg) {
      dbg.scripts.set(params.scriptId, params.url);

      if (dbg.browser) void debugOnScriptParsed(params.scriptId, params.url, params.sourceMapURL);
    }
    return;
  }
  if (method === "Debugger.paused") {

    if (params.reason === "Break on start") {
      debugSend("Runtime.runIfWaitingForDebugger");
      debugSend("Debugger.resume");
      return;
    }
    if (dbg) dbg.paused = true;
    const frames = (params.callFrames || []).map((frame) => {
      const scriptId = frame.location.scriptId;
      let url = frame.url || (dbg && dbg.scripts.get(scriptId)) || "";
      let line = frame.location.lineNumber;
      const column = frame.location.columnNumber || 0;

      if (dbg && dbg.browser) {
        const orig = smOriginalPositionFor(dbg.scriptMaps.get(scriptId), line, column);
        if (orig && orig.source) {
          const abs = debugResolveOriginal(orig.source);
          if (abs) {
            url = debugFileUrl(abs);
            line = orig.line;
          }
        }
      }
      return {
        id: frame.callFrameId,
        name: frame.functionName || "(anonymous)",
        url,
        line,
        column,
        scopes: (frame.scopeChain || []).map((scope) => ({
          type: scope.type,
          name: scope.name || scope.type,
          objectId: scope.object && scope.object.objectId,
        })),
      };
    });
    debugEmit({ type: "paused", reason: params.reason, frames });
    return;
  }
  if (method === "Debugger.resumed") {
    if (dbg) dbg.paused = false;
    debugEmit({ type: "resumed" });
    return;
  }
  if (method === "Runtime.consoleAPICalled") {
    const text = (params.args || []).map((arg) => describe(arg)).join(" ");
    debugEmit({ type: "console", level: params.type || "log", text });
    return;
  }
  if (method === "Runtime.exceptionThrown") {
    const detail = params.exceptionDetails || {};
    const text = detail.exception ? describe(detail.exception) : detail.text || "Uncaught";
    debugEmit({ type: "console", level: "error", text });
    return;
  }
}

async function debugStop() {
  const session = dbg;
  dbg = null;
  if (!session) return;
  try {
    session.ws && session.ws.close();
  } catch {

  }
  if (session.browser) {

    try {
      electron.hostRequest("browser:debug", { port: 0 });
    } catch {

    }
    return;
  }
  try {
    if (session.child) killProcessTree(session.child);
  } catch {

  }
}

async function debugStart(event, cwd, file, breakpoints) {
  await debugStop();
  const port = await debugFreePort();
  let child;
  try {
    child = node_child_process.spawn(
      process.execPath,
      [`--inspect-brk=127.0.0.1:${port}`, file],
      { cwd: cwd || undefined, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }

  dbg = {
    child,
    ws: null,
    port,
    seq: 0,
    pending: new Map(),
    scripts: new Map(),
    scriptMaps: new Map(),
    bpIds: new Map(),
    root: cwd || "",
    paused: false,
    sender: event.sender,
    breakpoints: breakpoints || [],
  };

  child.stdout.on("data", (chunk) => debugEmit({ type: "output", stream: "stdout", text: chunk.toString("utf8") }));
  child.on("close", (code) => {
    debugEmit({ type: "exited", code: code ?? 0 });
    debugStop();
  });

  const wsUrl = await new Promise((resolve) => {
    let settled = false;
    const done = (url) => {
      if (!settled) {
        settled = true;
        resolve(url);
      }
    };
    const timer = setTimeout(() => done(null), 10000);
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      const match = text.match(/ws:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timer);
        done(match[0]);
        return;
      }

      if (/Waiting for the debugger to disconnect/i.test(text)) {
        try {
          dbg && dbg.ws && dbg.ws.close();
        } catch {

        }
        return;
      }
      debugEmit({ type: "output", stream: "stderr", text });
    });
  });

  if (!wsUrl || !dbg) {
    await debugStop();
    return { ok: false, error: "The debugger did not open." };
  }

  const ws = new WebSocket(wsUrl);
  dbg.ws = ws;
  ws.addEventListener("message", (message) => debugHandle(message.data));
  ws.addEventListener("close", () => debugEmit({ type: "closed" }));
  ws.addEventListener("error", () => debugEmit({ type: "closed" }));

  await new Promise((resolve) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    setTimeout(resolve, 5000);
  });
  if (!dbg) return { ok: false, error: "The session ended before it began." };

  await debugSend("Runtime.enable");
  await debugSend("Debugger.enable");

  for (const bp of dbg.breakpoints) {
    await debugSend("Debugger.setBreakpointByUrl", {
      url: debugFileUrl(bp.file),
      lineNumber: bp.line,
      columnNumber: 0,
      condition: bp.condition || undefined,
    });
  }
  await debugSend("Runtime.runIfWaitingForDebugger");
  return { ok: true, port };
}

function debugBrowserTarget(port) {
  return new Promise((resolve) => {
    let tries = 0;
    const attempt = () => {
      tries += 1;
      const request = node_http.get(
        { host: "127.0.0.1", port, path: "/json/list", timeout: 2000 },
        (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => {
            let target = null;
            try {
              const list = JSON.parse(body);
              target = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl) || list[0];
            } catch {

            }
            if (target && target.webSocketDebuggerUrl) resolve(target.webSocketDebuggerUrl);
            else if (tries < 15) setTimeout(attempt, 400);
            else resolve(null);
          });
        },
      );
      request.on("error", () => {
        if (tries < 15) setTimeout(attempt, 400);
        else resolve(null);
      });
    };
    attempt();
  });
}

async function debugAttachBrowser(event, breakpoints, root) {
  await debugStop();
  const port = await debugFreePort();
  try {
    await electron.hostRequest("browser:debug", { port });
  } catch {

  }

  const wsUrl = await debugBrowserTarget(port);
  if (!wsUrl) {
    electron.hostRequest("browser:debug", { port: 0 });
    return { ok: false, error: "Could not reach the browser's debugger." };
  }

  dbg = {
    child: null,
    ws: null,
    port,
    seq: 0,
    pending: new Map(),
    scripts: new Map(),
    scriptMaps: new Map(),
    bpIds: new Map(),
    root: root || "",
    paused: false,
    sender: event.sender,
    breakpoints: breakpoints || [],
    browser: true,
  };
  const ws = new WebSocket(wsUrl);
  dbg.ws = ws;
  ws.addEventListener("message", (message) => debugHandle(message.data));
  ws.addEventListener("close", () => debugEmit({ type: "closed" }));
  ws.addEventListener("error", () => debugEmit({ type: "closed" }));
  await new Promise((resolve) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    setTimeout(resolve, 5000);
  });
  if (!dbg) return { ok: false, error: "The session ended before it began." };

  await debugSend("Runtime.enable");
  await debugSend("Debugger.enable");

  return { ok: true, port, browser: true };
}

function registerDebugHandlers() {

  electron.ipcMain.handle("debug:start", (event, cwd, file, breakpoints) => {
    const name = String(file || "");
    if (/\.pyw?$/i.test(name)) return dapStartPython(event, cwd, file, breakpoints);
    if (/\.go$/i.test(name)) return dapStartGo(event, cwd, file, breakpoints);
    if (/\.rb$/i.test(name)) return dapStartRuby(event, cwd, file, breakpoints);
    return debugStart(event, cwd, file, breakpoints);
  });

  electron.ipcMain.handle("debug:startBrowser", (event, breakpoints, root) =>
    debugAttachBrowser(event, breakpoints, root));

  electron.ipcMain.handle("debug:stop", async () => {
    await debugStop();
    return { ok: true };
  });

  const dap = () => dbg && dbg.kind === "dap";
  electron.ipcMain.handle("debug:resume", () => (dap() ? dapResume() : debugSend("Debugger.resume").then(() => ({ ok: true }))));
  electron.ipcMain.handle("debug:stepOver", () => (dap() ? dapStepOver() : debugSend("Debugger.stepOver").then(() => ({ ok: true }))));
  electron.ipcMain.handle("debug:stepInto", () => (dap() ? dapStepInto() : debugSend("Debugger.stepInto").then(() => ({ ok: true }))));
  electron.ipcMain.handle("debug:stepOut", () => (dap() ? dapStepOut() : debugSend("Debugger.stepOut").then(() => ({ ok: true }))));
  electron.ipcMain.handle("debug:pause", () => (dap() ? dapPause() : debugSend("Debugger.pause").then(() => ({ ok: true }))));

  electron.ipcMain.handle("debug:pauseOnExceptions", (_event, state) => {
    if (dap()) return dapPauseOnExceptions(state);
    const allowed = state === "all" || state === "uncaught" ? state : "none";
    return debugSend("Debugger.setPauseOnExceptions", { state: allowed }).then(() => ({ ok: true }));
  });

  electron.ipcMain.handle("debug:properties", async (_event, objectId) => {
    if (dap()) return dapProperties(objectId);
    if (!objectId) return { properties: [] };
    const result = await debugSend("Runtime.getProperties", {
      objectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
      generatePreview: true,
    });
    const properties = (result?.result || [])
      .filter((prop) => prop.enumerable !== false)
      .map((prop) => ({
        name: prop.name,
        value: prop.value ? describe(prop.value) : "",

        objectId: prop.value && prop.value.objectId ? prop.value.objectId : null,
      }));
    return { properties };
  });

  electron.ipcMain.handle("debug:evaluate", async (_event, callFrameId, expression) => {
    if (dbg && dbg.kind === "dap") return dapEvaluate(callFrameId, expression);
    if (!dbg) return { value: "", error: "Nothing is running." };
    let result;
    if (callFrameId) {
      result = await debugSend("Debugger.evaluateOnCallFrame", {
        callFrameId,
        expression,
        returnByValue: false,
        generatePreview: true,
      });
    } else {
      result = await debugSend("Runtime.evaluate", {
        expression,
        includeCommandLineAPI: true,
        returnByValue: false,
        generatePreview: true,
      });
    }
    if (!result || result.error) return { value: "", error: result?.error?.message };

    if (result.exceptionDetails) {
      const ex = result.exceptionDetails.exception;
      return { value: ex ? describe(ex) : result.exceptionDetails.text, error: "throws" };
    }
    const remote = result.result;
    return {
      value: remote ? describe(remote) : "",
      objectId: remote && remote.objectId ? remote.objectId : null,
    };
  });

  electron.ipcMain.handle("debug:setBreakpoint", async (_event, file, line, on, id, condition) => {
    if (!dbg) return { ok: true };
    if (dbg.kind === "dap") return dapSetBreakpoint(file, line, on);

    if (dbg.browser) {
      const key = debugBpKey(file, line);
      if (on) {
        dbg.bpIds.set(key, []);
        await debugBindBrowserBreakpoint({ file, line, condition });
        const ids = dbg.bpIds.get(key) || [];
        return { ok: true, id: ids[0] ?? null };
      }
      for (const bid of dbg.bpIds.get(key) || []) {
        await debugSend("Debugger.removeBreakpoint", { breakpointId: bid });
      }
      dbg.bpIds.delete(key);
      return { ok: true };
    }
    if (on) {
      const result = await debugSend("Debugger.setBreakpointByUrl", {
        url: debugFileUrl(file),
        lineNumber: line,
        columnNumber: 0,
        condition: condition || undefined,
      });
      return { ok: true, id: result?.breakpointId ?? null };
    }
    if (id) await debugSend("Debugger.removeBreakpoint", { breakpointId: id });
    return { ok: true };
  });
}
