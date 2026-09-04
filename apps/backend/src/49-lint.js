

const LINT_TIMEOUT_MS = 15_000;
const LINT_MAX_BYTES = 8 * 1024 * 1024;

function lintRunnerPath() {
  return node_path.resolve(__dirname, "..", "..", "sidecar", "workers", "eslint-runner.cjs");
}

function runLinter(job) {
  return new Promise((resolve) => {
    let child;
    try {
      child = node_child_process.spawn(process.execPath, [lintRunnerPath()], {
        cwd: job.root,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ ok: false, reason: "spawn-failed", detail: error.message });
      return;
    }

    let out = "";
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, reason: "timeout" });
    }, LINT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > LINT_MAX_BYTES) {
        child.kill();
        finish({ ok: false, reason: "too-large" });
        return;
      }
      out += chunk.toString("utf8");
    });

    child.stderr.resume();
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, reason: "spawn-failed", detail: error.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        finish(JSON.parse(out));
      } catch {
        finish({ ok: false, reason: "bad-output" });
      }
    });

    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(job));
  });
}

function registerLintHandlers() {

  electron.ipcMain.handle("lint:file", async (_event, root, filePath, text) => {
    if (!root || typeof filePath !== "string" || typeof text !== "string") {
      return { ok: false, reason: "bad-job" };
    }
    return runLinter({ root, filePath, text });
  });
}
