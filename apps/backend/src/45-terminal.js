

const sessions =  new Map();
let nextId = 1;

const WSL_UNC = /^\\\\wsl(?:\$|\.localhost)\\([^\\]+)\\?(.*)$/i;

function wslTarget(cwd) {
  if (typeof cwd !== "string") return null;
  const match = WSL_UNC.exec(cwd);
  if (!match) return null;
  const rest = (match[2] || "").split("\\").join("/");
  return { distro: match[1], path: "/" + rest.replace(/^\/+/, "") };
}

function shellFor(cwd) {
  if (process.platform === "win32") {
    const wsl = wslTarget(cwd);
    if (wsl) {

      return {
        file: "wsl.exe",
        args: ["-d", wsl.distro, "--cd", wsl.path],

        cwd: process.env.USERPROFILE || undefined,
        label: "wsl -d " + wsl.distro,
      };
    }
    return { file: process.env.ComSpec || "cmd.exe", args: [] };
  }
  return { file: process.env.SHELL || "/bin/bash", args: ["-l"] };
}
function disposeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.clearTimer?.();
  session.flush?.();
  try {

    killProcessTree(session.child);
  } catch {
    try { session.child.kill(); } catch {}
  }
}
function registerTerminalHandlers() {
  electron.ipcMain.handle("terminal:start", (event, options) => {
    if (!nodePty) return { error: "The terminal is not available here (no pty for this platform)." };
    const requested = options?.cwd || process.cwd();
    const { file, args, cwd: shellCwd, label } = shellFor(requested);
    const id = nextId++;
    let child;
    try {
      child = nodePty.spawn(file, args, {
        name: "xterm-256color",
        cols: options?.cols ?? 80,
        rows: options?.rows ?? 24,
        cwd: shellCwd ?? requested,
        env: { ...process.env, TERM: "xterm-256color" }
      });
    } catch (error) {
      return { error: `Could not start the shell: ${error.message}` };
    }
    const sender = event.sender;
    const send = (channel, payload) => {
      if (!sender.isDestroyed()) sender.send(channel, payload);
    };

    let pending = "";
    let flushTimer = null;
    const flush = () => {
      flushTimer = null;
      if (!pending) return;
      const text = pending;
      pending = "";
      send("terminal:data", { id, text });
    };
    const session = { child, flush, clearTimer: () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } } };
    child.onData((data) => {
      pending += data;
      if (pending.length >= 64 * 1024) {
        session.clearTimer();
        flush();
        return;
      }
      if (!flushTimer) flushTimer = setTimeout(flush, 12);
    });
    child.onExit(({ exitCode }) => {
      session.clearTimer();
      flush();
      sessions.delete(id);
      send("terminal:exit", { id, code: exitCode });
    });
    sessions.set(id, session);
    return { id, shell: label ?? file };
  });
  electron.ipcMain.handle("terminal:write", (_event, id, data) => {
    const session = sessions.get(id);
    if (!session) return { error: "Session is closed." };
    session.child.write(data);
    return {};
  });
  electron.ipcMain.handle("terminal:resize", (_event, id, cols, rows) => {
    const session = sessions.get(id);
    if (!session) return { error: "Session is closed." };
    try {
      session.child.resize(Math.max(1, cols | 0), Math.max(1, rows | 0));
    } catch {
    }
    return {};
  });
  electron.ipcMain.handle("terminal:dispose", (_event, id) => {
    disposeSession(id);
    return {};
  });
}
function disposeAllTerminals() {
  for (const id of [...sessions.keys()]) disposeSession(id);
}
