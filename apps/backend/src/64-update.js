const WIDE_VERSION = "0.56926";
const WIDE_REPO = "sl4de0day/wide";
const WIDE_ASSET_RE = /Wide-Setup-.*\.exe$/i;
const WIDE_SUMS_RE = /^SHA256SUMS(\.txt)?$/i;
const WIDE_MAX_ATTEMPTS = 2;

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

function updateStateFile() {
  return node_path.join(electron.app.getPath("userData"), "update-state.json");
}

async function readUpdateState() {
  try {
    const parsed = JSON.parse(await promises.readFile(updateStateFile(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeUpdateState(state) {
  try {
    await promises.writeFile(updateStateFile(), JSON.stringify(state, null, 2), "utf8");
  } catch {
    void 0;
  }
}

async function noteAttempt(version) {
  if (!version) return;
  const state = await readUpdateState();
  const attempt =
    state.attempt && state.attempt.version === version
      ? state.attempt
      : { version, count: 0 };
  attempt.count = (parseInt(attempt.count, 10) || 0) + 1;
  state.attempt = attempt;
  await writeUpdateState(state);
}

function sha256File(file) {
  return new Promise((resolve) => {
    try {
      const hash = node_crypto.createHash("sha256");
      const stream = node_fs.createReadStream(file);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", () => resolve(""));
    } catch {
      resolve("");
    }
  });
}

async function expectedHashFor(sumsUrl, assetName) {
  if (!sumsUrl || !assetName) return "";
  const temp = node_path.join(node_os.tmpdir(), `wide-sums-${process.pid}.txt`);
  const got = await download(sumsUrl, temp);
  if (!got.ok) return "";
  let text = "";
  try {
    text = await promises.readFile(temp, "utf8");
  } catch {
    text = "";
  }
  try {
    await promises.unlink(temp);
  } catch {
    void 0;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match && node_path.basename(match[2].trim()) === assetName) {
      return match[1].toLowerCase();
    }
  }
  return "";
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

async function settleAttempt(latest) {
  const state = await readUpdateState();
  if (!state.attempt) return { blocked: false, attempts: 0 };
  if (compareVersions(WIDE_VERSION, state.attempt.version) >= 0) {
    delete state.attempt;
    await writeUpdateState(state);
    return { blocked: false, attempts: 0 };
  }
  const attempts = parseInt(state.attempt.count, 10) || 0;
  const blocked = state.attempt.version === latest && attempts >= WIDE_MAX_ATTEMPTS;
  return { blocked, attempts };
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
  const sums = assets.find((a) => a && typeof a.name === "string" && WIDE_SUMS_RE.test(a.name));
  const settled = await settleAttempt(latest);
  return {
    ok: true,
    configured: true,
    current: WIDE_VERSION,
    latest,
    url: asset ? String(asset.browser_download_url) : `https://github.com/${WIDE_REPO}/releases/latest`,
    asset: asset ? String(asset.name) : "",
    sums: sums ? String(sums.browser_download_url) : "",
    notes: typeof release.body === "string" ? release.body : "",
    available: compareVersions(latest, WIDE_VERSION) > 0,
    blocked: settled.blocked,
    attempts: settled.attempts,
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
    const settled = await settleAttempt(latest);
    return {
      ok: true,
      configured: true,
      current: WIDE_VERSION,
      latest,
      url: typeof manifest.url === "string" ? manifest.url : "",
      asset: typeof manifest.asset === "string" ? manifest.asset : "",
      sums: typeof manifest.sums === "string" ? manifest.sums : "",
      notes: typeof manifest.notes === "string" ? manifest.notes : "",
      available: compareVersions(latest, WIDE_VERSION) > 0,
      blocked: settled.blocked,
      attempts: settled.attempts,
    };
  });

  electron.ipcMain.handle("update:download", async (_event, arg) => {
    const info = arg && typeof arg === "object" ? arg : { url: arg };
    const url = typeof info.url === "string" ? info.url : "";
    const version = typeof info.version === "string" ? info.version : "";
    const assetName = typeof info.asset === "string" ? info.asset : "";
    const sumsUrl = typeof info.sums === "string" ? info.sums : "";
    if (!/^https:\/\//i.test(url)) {
      return { ok: false, error: "The update download link must be https." };
    }

    const expected = await expectedHashFor(sumsUrl, assetName);
    if (!expected) {
      await noteAttempt(version);
      return {
        ok: false,
        error: "This release publishes no usable SHA256SUMS entry, so the update cannot be verified.",
      };
    }

    const target = node_path.join(node_os.tmpdir(), `Wide-Setup-${version || "latest"}.exe`);
    const staged = await sha256File(target);
    if (staged && staged === expected) {
      return { ok: true, path: target, verified: true, cached: true };
    }

    broadcast("update:progress", { phase: "download", state: "start" });
    const result = await download(url, target);
    if (!result.ok) {
      broadcast("update:progress", { phase: "download", state: "error", error: result.detail });
      return { ok: false, error: result.detail || "The update could not be downloaded." };
    }

    const actual = await sha256File(target);
    if (actual !== expected) {
      try {
        await promises.unlink(target);
      } catch {
        void 0;
      }
      await noteAttempt(version);
      broadcast("update:progress", { phase: "download", state: "error", error: "checksum" });
      return { ok: false, error: "The downloaded update did not match its published checksum." };
    }

    broadcast("update:progress", { phase: "download", state: "done", bytes: result.size });
    return { ok: true, path: target, bytes: result.size, verified: true };
  });

  electron.ipcMain.handle("update:install", async (_event, arg) => {
    const info = arg && typeof arg === "object" ? arg : { path: arg };
    const installerPath = typeof info.path === "string" ? info.path : "";
    const version = typeof info.version === "string" ? info.version : "";
    if (!installerPath) {
      return { ok: false, error: "No installer to run." };
    }
    await noteAttempt(version);
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

  electron.ipcMain.handle("app:installLanguage", async () => {
    try {
      const file = node_path.join(node_path.dirname(process.execPath), "wide.ini");
      const text = await promises.readFile(file, "utf8");
      const match = /^\s*Language\s*=\s*([A-Za-z]{2})\s*$/m.exec(text);
      return { ok: true, language: match ? match[1].toLowerCase() : "" };
    } catch {
      return { ok: true, language: "" };
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
