const WIDE_VERSION = "0.45926";
const WIDE_REPO = "sl4de0day/wide";
const WIDE_ASSET_RE = /Wide-Setup-.*\.exe$/i;

function compareVersions(a, b) {
  const pa = String(a || "").replace(/^v/i, "").split(".");
  const pb = String(b || "").replace(/^v/i, "").split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const na = parseInt(pa[i], 10) || 0;
    const nb = parseInt(pb[i], 10) || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function fetchJson(url, headers) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return Promise.resolve({ ok: false, error: "That is not a valid URL." });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return Promise.resolve({ ok: false, error: "The update URL must be http or https." });
  }
  const transport = target.protocol === "https:" ? node_https : node_http;
  return new Promise((resolve) => {
    const request = transport.get(target, { headers: headers || {} }, (response) => {
      if (!response.statusCode || response.statusCode >= 400) {
        response.resume();
        resolve({ ok: false, error: `The update server returned ${response.statusCode || "no status"}.` });
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 4 << 20) {
          request.destroy(new Error("The update response is too large."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          resolve({ ok: true, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch {
          resolve({ ok: false, error: "The update response was not valid JSON." });
        }
      });
    });
    request.on("error", (error) => resolve({ ok: false, error: String(error.message || error) }));
    request.setTimeout(10000, () => request.destroy(new Error("The update check timed out.")));
  });
}

async function checkGithubRelease() {
  const api = `https://api.github.com/repos/${WIDE_REPO}/releases/latest`;
  const result = await fetchJson(api, { "User-Agent": "Wide", Accept: "application/vnd.github+json" });
  if (!result.ok) return { ok: false, error: result.error, current: WIDE_VERSION };
  const release = result.json || {};
  const latest = String(release.tag_name || release.name || "").replace(/^v/i, "");
  if (!latest) return { ok: false, error: "The latest release has no version tag.", current: WIDE_VERSION };
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((a) => a && typeof a.name === "string" && WIDE_ASSET_RE.test(a.name));
  return {
    ok: true,
    configured: true,
    current: WIDE_VERSION,
    latest,
    url: asset ? String(asset.browser_download_url) : `https://github.com/${WIDE_REPO}/releases/latest`,
    notes: typeof release.body === "string" ? release.body : "",
    available: compareVersions(latest, WIDE_VERSION) > 0,
  };
}

function registerUpdateHandlers() {
  electron.ipcMain.handle("update:check", async (_event, manifestUrl) => {
    const override = typeof manifestUrl === "string" ? manifestUrl.trim() : "";
    if (!override) return checkGithubRelease();
    const result = await fetchJson(override);
    if (!result.ok) return { ok: false, error: result.error, current: WIDE_VERSION };
    const manifest = result.json || {};
    const latest = String(manifest.version || "");
    if (!latest) return { ok: false, error: "The manifest has no version.", current: WIDE_VERSION };
    return {
      ok: true,
      configured: true,
      current: WIDE_VERSION,
      latest,
      url: typeof manifest.url === "string" ? manifest.url : "",
      notes: typeof manifest.notes === "string" ? manifest.notes : "",
      available: compareVersions(latest, WIDE_VERSION) > 0,
    };
  });

  electron.ipcMain.handle("update:download", async (_event, url) => {
    if (typeof url !== "string" || !/^https:\/\//i.test(url)) {
      return { ok: false, error: "The update download link must be https." };
    }
    const os = require("node:os");
    const path = require("node:path");
    const target = path.join(os.tmpdir(), `Wide-Setup-${WIDE_VERSION}-${Date.now()}.exe`);
    broadcast("update:progress", { phase: "download", state: "start" });
    const result = await download(url, target);
    if (!result.ok) {
      broadcast("update:progress", { phase: "download", state: "error", error: result.detail });
      return { ok: false, error: result.detail || "The update could not be downloaded." };
    }
    broadcast("update:progress", { phase: "download", state: "done", bytes: result.size });
    return { ok: true, path: target, bytes: result.size };
  });

  electron.ipcMain.handle("update:install", async (_event, installerPath) => {
    if (typeof installerPath !== "string" || !installerPath) {
      return { ok: false, error: "No installer to run." };
    }
    try {
      const child = node_child_process.spawn(installerPath, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/NOCANCEL"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
    broadcast("update:progress", { phase: "install", state: "start" });
    setTimeout(() => {
      try {
        electron.app.quit();
      } catch {
        void 0;
      }
    }, 400);
    return { ok: true };
  });

  electron.ipcMain.handle("update:open", async (_event, url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: "That is not a valid link." };
    }
    try {
      electron.shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });

  electron.ipcMain.handle("shell:openExternal", async (_event, arg) => {
    const url = typeof arg === "string" ? arg : arg && typeof arg.url === "string" ? arg.url : "";
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: "That is not a valid link." };
    }
    try {
      electron.shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });
}
