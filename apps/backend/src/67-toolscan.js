

const TOOLSCAN_MAX_OUT = 2 * 1024 * 1024;
const TOOLSCAN_TIMEOUT_MS = 180_000;

function registerToolScanHandlers() {
  electron.ipcMain.handle("toolscan:run", async (event, root, command) => {
    if (typeof command !== "string" || !command.trim()) return { ok: false, error: "No command." };
    await refreshPath();
    return await new Promise((resolve) => {
      let out = "";
      let err = "";
      let done = false;
      const finish = (result) => { if (!done) { done = true; resolve(result); } };

      let child;
      try {
        child = node_child_process.spawn(command, {
          cwd: root || undefined,
          windowsHide: true,
          shell: true,
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        return finish({ ok: false, error: String(error && error.message ? error.message : error) });
      }

      const timer = setTimeout(() => { killProcessTree(child); finish({ ok: true, output: out + err, timedOut: true }); }, TOOLSCAN_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => { if (out.length < TOOLSCAN_MAX_OUT) out += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { if (err.length < TOOLSCAN_MAX_OUT) err += chunk.toString("utf8"); });
      child.on("error", (error) => { clearTimeout(timer); finish({ ok: false, error: String(error && error.message ? error.message : error) }); });
      child.on("close", (code) => { clearTimeout(timer); finish({ ok: true, output: out + err, code: code == null ? 0 : code }); });
    });
  });
}
