

const wsConnections = new Map();
const sseControllers = new Map();

function closeAllRealtime() {
  for (const ws of wsConnections.values()) {
    try {
      ws.close();
    } catch {

    }
  }
  wsConnections.clear();
  for (const ctrl of sseControllers.values()) {
    try {
      ctrl.abort();
    } catch {

    }
  }
  sseControllers.clear();
}

function wsConnect(id, url, protocols) {
  if (wsConnections.has(id)) {
    try {
      wsConnections.get(id).close();
    } catch {

    }
    wsConnections.delete(id);
  }
  let ws;
  try {
    ws = protocols && protocols.length ? new WebSocket(url, protocols) : new WebSocket(url);
  } catch (err) {
    broadcast("ws:event", { id, type: "error", reason: String(err && err.message ? err.message : err) });
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
  wsConnections.set(id, ws);
  ws.addEventListener("open", () => broadcast("ws:event", { id, type: "open" }));
  ws.addEventListener("message", (ev) => {
    const data = typeof ev.data === "string" ? ev.data : "";
    if (typeof ev.data === "string") {
      broadcast("ws:event", { id, type: "message", data, binary: false });
    } else {

      broadcast("ws:event", { id, type: "message", data: "[binary frame]", binary: true });
    }
  });
  ws.addEventListener("close", (ev) => {

    if (wsConnections.get(id) === ws) wsConnections.delete(id);
    broadcast("ws:event", { id, type: "close", code: ev.code, reason: ev.reason });
  });
  ws.addEventListener("error", () => broadcast("ws:event", { id, type: "error", reason: "socket error" }));
  return { ok: true, id };
}

function wsSend(id, data) {
  const ws = wsConnections.get(id);
  if (!ws) return { ok: false, error: "No such connection." };
  if (ws.readyState !== 1) return { ok: false, error: "Socket is not open." };
  try {
    ws.send(String(data));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function wsClose(id) {
  const ws = wsConnections.get(id);
  if (ws) {
    try {
      ws.close();
    } catch {

    }
    wsConnections.delete(id);
  }
  return { ok: true };
}

async function sseOpen(id, url, headers) {
  if (sseControllers.has(id)) {
    try {
      sseControllers.get(id).abort();
    } catch {

    }
  }
  const ctrl = new AbortController();
  sseControllers.set(id, ctrl);
  const hdrs = Object.assign({ Accept: "text/event-stream" }, headers || {});
  (async () => {
    try {
      const res = await fetch(url, { headers: hdrs, signal: ctrl.signal });
      if (!res.ok) {
        broadcast("sse:event", { id, type: "error", data: `HTTP ${res.status}` });
        sseControllers.delete(id);
        return;
      }
      broadcast("sse:event", { id, type: "open" });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "";
      let dataLines = [];
      let lastEventId = "";
      const dispatch = () => {
        if (dataLines.length === 0 && !eventName) return;
        broadcast("sse:event", { id, type: "message", event: eventName || "message", data: dataLines.join("\n"), lastEventId });
        eventName = "";
        dataLines = [];
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line === "") {
            dispatch();
            continue;
          }
          if (line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          let val = colon < 0 ? "" : line.slice(colon + 1);
          if (val.startsWith(" ")) val = val.slice(1);
          if (field === "data") dataLines.push(val);
          else if (field === "event") eventName = val;
          else if (field === "id") lastEventId = val;
        }
      }
      dispatch();
      broadcast("sse:event", { id, type: "close" });
    } catch (err) {
      if (!ctrl.signal.aborted) broadcast("sse:event", { id, type: "error", data: String(err && err.message ? err.message : err) });
    } finally {

      if (sseControllers.get(id) === ctrl) sseControllers.delete(id);
    }
  })();
  return { ok: true, id };
}

function sseClose(id) {
  const ctrl = sseControllers.get(id);
  if (ctrl) {
    try {
      ctrl.abort();
    } catch {

    }
    sseControllers.delete(id);
  }
  return { ok: true };
}

function registerRealtimeHandlers() {
  electron.ipcMain.handle("ws:connect", async (_event, { id, url, protocols }) => wsConnect(id, url, protocols));
  electron.ipcMain.handle("ws:send", async (_event, { id, data }) => wsSend(id, data));
  electron.ipcMain.handle("ws:close", async (_event, { id }) => wsClose(id));
  electron.ipcMain.handle("sse:open", async (_event, { id, url, headers }) => sseOpen(id, url, headers));
  electron.ipcMain.handle("sse:close", async (_event, { id }) => sseClose(id));
}
