

const OPENCODE_PACKAGE = "opencode-ai";

const OPENCODE_PROBE_TTL_MS = 30000;

const OPENCODE_VERSION_TIMEOUT_MS = 8000;

const OPENCODE_HOST = "127.0.0.1";

const OPENCODE_USER = "opencode";

const OPENCODE_START_TIMEOUT_MS = 30000;

const OPENCODE_HEALTH_ATTEMPTS = 10;

const OPENCODE_IDLE_MS = 15 * 60 * 1000;

const OPENCODE_TAIL_BYTES = 4096;

const OPENCODE_MODELS_TTL_MS = 60000;

let openCodeProbe = null;

let openCodeInstalling = null;

let openCodeServer = null;

let openCodeStarting = null;

let openCodeIdleTimer = null;

let openCodeActive = 0;

let openCodeLastError = "";

let openCodeModelsCache = null;

async function openCodeShimTarget(at) {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(at)) return null;
  let text;
  try {
    text = await promises.readFile(at, "utf8");
  } catch {
    return null;
  }
  const found = text.match(/%~?dp0%?[\\/]?([^"\r\n]+?\.exe)\b/i);
  if (!found) return null;
  const target = node_path.resolve(node_path.dirname(at), found[1].replace(/^[\\/]+/, ""));
  try {
    await promises.access(target);
    return target;
  } catch {
    return null;
  }
}

async function openCodeResolve(at) {
  if (!at) return null;
  if (process.platform !== "win32") return at;
  let candidate = at;
  if (!/\.(cmd|bat|exe)$/i.test(candidate)) {
    for (const suffix of [".exe", ".cmd", ".bat"]) {
      try {
        await promises.access(candidate + suffix);
        candidate += suffix;
        break;
      } catch {

      }
    }
  }
  return (await openCodeShimTarget(candidate)) ?? candidate;
}

async function openCodeCandidates() {
  await refreshPath();
  const found = [];

  const onPath = await commandExists("opencode");
  if (onPath) found.push({ at: await openCodeResolve(onPath), source: "cli" });

  const dirs = [node_path.join(electron.app.getPath("home"), ".opencode", "bin")];
  const prefix = await readCommand("npm", ["prefix", "-g"]);
  if (prefix) dirs.push(prefix, node_path.join(prefix, "bin"));
  const inDirs = await findIn(dirs, "opencode");
  if (inDirs) found.push({ at: await openCodeResolve(inDirs), source: "cli" });

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const desktop = node_path.join(
      process.env.LOCALAPPDATA,
      "Programs",
      "ai.opencode.desktop",
      "resources",
      "opencode-cli.exe"
    );
    try {
      await promises.access(desktop);
      found.push({ at: desktop, source: "desktop" });
    } catch {

    }
  }

  const seen = new Set();
  return found.filter((entry) => {
    if (!entry.at) return false;
    const key = process.platform === "win32" ? entry.at.toLowerCase() : entry.at;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function openCodeSpawn(at, args, options) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(at)) {
    const line = [`"${at}"`, ...args.map((arg) => `"${String(arg).replace(/"/g, "")}"`)].join(" ");
    return node_child_process.spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  return node_child_process.spawn(at, args, options);
}

function openCodeVersion(at) {
  return new Promise((resolve) => {
    let child;
    try {
      child = openCodeSpawn(at, ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }

    let out = "";
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      killProcessTree(child);
      finish(null);
    }, OPENCODE_VERSION_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      if (out.length < 4096) out += chunk;
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      const found = code === 0 ? out.match(/\d+\.\d+\.\d+[0-9A-Za-z.+-]*/) : null;
      finish(found ? found[0] : null);
    });
  });
}

function openCodeCompareVersions(left, right) {
  const parse = (value) => String(value).split(/[^0-9]+/).filter(Boolean).slice(0, 3).map(Number);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function openCodeApiOf(version) {
  return Number(String(version).split(".")[0]) >= 2 ? "v2" : "v1";
}

async function openCodeStatus({ fresh = false } = {}) {
  if (!fresh && openCodeProbe && Date.now() - openCodeProbe.at < OPENCODE_PROBE_TTL_MS) {
    return openCodeProbe.value;
  }

  const candidates = await openCodeCandidates();
  const probed = await Promise.all(
    candidates.map(async (entry) => ({ ...entry, version: await openCodeVersion(entry.at) }))
  );
  const working = probed
    .filter((entry) => entry.version)
    .sort((left, right) => openCodeCompareVersions(right.version, left.version));

  let value;
  if (working.length > 0) {
    const best = working[0];
    value = {
      ok: true,
      installed: true,
      broken: false,
      path: best.at,
      version: best.version,
      source: best.source,
      api: openCodeApiOf(best.version),
      found: probed.map((entry) => ({ path: entry.at, version: entry.version ?? "", source: entry.source })),
    };
  } else if (probed.length > 0) {
    value = { ok: true, installed: false, broken: true, path: probed[0].at, source: probed[0].source };
  } else {
    value = { ok: true, installed: false, broken: false };
  }

  openCodeProbe = { at: Date.now(), value };
  return value;
}

function openCodeInstall(track) {
  if (openCodeInstalling) return openCodeInstalling;

  openCodeInstalling = (async () => {
    const npm = await commandExists("npm");
    if (!npm) {
      const bootstrap = await bootstrapManager("npm", track);
      if (!bootstrap.ok) {
        return { ok: false, error: bootstrap.detail || "Node.js could not be installed." };
      }
    }

    const run = await runManager(
      "npm",
      ["install", "-g", `--allow-scripts=${OPENCODE_PACKAGE}`, `${OPENCODE_PACKAGE}@latest`],
      { track }
    );
    if (!run.ok) return { ok: false, error: run.detail ?? "The install failed." };

    openCodeProbe = null;
    const status = await openCodeStatus({ fresh: true });
    if (status.installed) return { ok: true, path: status.path, version: status.version };
    return {
      ok: false,
      error: status.broken ? "It installed but did not start." : "It installed but could not be found.",
    };
  })().finally(() => {
    openCodeInstalling = null;
  });

  return openCodeInstalling;
}

function openCodeFreePort() {
  return new Promise((resolve, reject) => {
    const probe = node_net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, OPENCODE_HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function openCodeRequest(server, method, route, body, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined || body === null ? null : Buffer.from(JSON.stringify(body), "utf8");
    const request = node_http.request(
      {
        host: OPENCODE_HOST,
        port: server.port,
        method,
        path: route,
        headers: {
          accept: "application/json",
          authorization: `Basic ${Buffer.from(`${OPENCODE_USER}:${server.password}`).toString("base64")}`,
          ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        },
      },
      (response) => {
        const decoder = new StringDecoder("utf8");
        let text = "";
        response.on("data", (chunk) => {
          text += decoder.write(chunk);
        });
        response.on("end", () => {
          text += decoder.end();
          let json = null;
          if (/json/i.test(String(response.headers["content-type"] ?? ""))) {
            try {
              json = JSON.parse(text);
            } catch {
              json = null;
            }
          }
          resolve({ status: response.statusCode ?? 0, headers: response.headers, text, json });
        });
        response.on("error", reject);
      }
    );
    request.setTimeout(timeout, () => request.destroy(new Error("The OpenCode server did not answer in time.")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function openCodeHealthy(server) {
  const route = server.api === "v2" ? "/api/info" : "/global/health";
  try {
    const reply = await openCodeRequest(server, "GET", route, null, { timeout: 3000 });
    return reply.status === 200 && reply.json !== null && typeof reply.json === "object";
  } catch {
    return false;
  }
}

function openCodeTail(text, chunk) {
  const next = text + chunk;
  return next.length > OPENCODE_TAIL_BYTES ? next.slice(-OPENCODE_TAIL_BYTES) : next;
}

function openCodeLastLine(text) {
  return (
    String(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^error:\s*unexpected error$/i.test(line))
      .slice(-1)[0] ?? ""
  );
}

function openCodeScheduleIdle() {
  if (openCodeIdleTimer) clearTimeout(openCodeIdleTimer);
  openCodeIdleTimer = setTimeout(() => {
    openCodeIdleTimer = null;
    if (openCodeActive > 0) {
      openCodeScheduleIdle();
      return;
    }
    openCodeStop();
  }, OPENCODE_IDLE_MS);
  openCodeIdleTimer.unref?.();
}

async function openCodeLaunch() {
  const status = await openCodeStatus();
  if (!status.installed) {
    throw new Error(status.broken ? "The OpenCode CLI was found but does not run." : "The OpenCode CLI is not installed.");
  }

  const port = await openCodeFreePort();
  const password = node_crypto.randomBytes(24).toString("base64url");
  const child = openCodeSpawn(status.path, ["serve", "--port", String(port), "--hostname", OPENCODE_HOST], {
    cwd: electron.app.getPath("home"),
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: OPENCODE_USER },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const server = {
    child,
    port,
    password,
    url: `http://${OPENCODE_HOST}:${port}`,
    version: status.version,
    api: status.api,
    source: status.source,
    path: status.path,
    startedAt: 0,
    stderr: "",
  };

  const stdoutDecoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");
  let stdout = "";

  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("The OpenCode server took too long to start."));
    }, OPENCODE_START_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout = openCodeTail(stdout, stdoutDecoder.write(chunk));
      if (/listening on https?:\/\//i.test(stdout)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => {
      server.stderr = openCodeTail(server.stderr, stderrDecoder.write(chunk));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const said = openCodeLastLine(server.stderr) || openCodeLastLine(stdout);
      reject(new Error(said || `The OpenCode server exited with code ${code ?? -1}.`));
    });
  });

  child.on("exit", (code) => {
    if (openCodeServer?.child !== child) return;
    openCodeServer = null;
    const said = openCodeLastLine(server.stderr);
    openCodeLastError = said || `The OpenCode server stopped with code ${code ?? -1}.`;
  });

  try {
    await listening;
    let healthy = false;
    for (let attempt = 0; attempt < OPENCODE_HEALTH_ATTEMPTS && !healthy; attempt += 1) {
      healthy = await openCodeHealthy(server);
      if (!healthy) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!healthy) throw new Error("The OpenCode server started but does not answer.");
  } catch (error) {
    killProcessTree(child);
    throw error;
  }

  server.startedAt = Date.now();
  return server;
}

async function openCodeEnsure() {
  if (openCodeServer && openCodeServer.child.exitCode === null) {
    openCodeScheduleIdle();
    return openCodeServer;
  }
  if (openCodeStarting) return openCodeStarting;

  openCodeStarting = openCodeLaunch()
    .then((server) => {
      openCodeServer = server;
      openCodeLastError = "";
      openCodeScheduleIdle();
      return server;
    })
    .catch((error) => {
      openCodeLastError = String(error.message || error);
      throw error;
    })
    .finally(() => {
      openCodeStarting = null;
    });

  return openCodeStarting;
}

async function openCodeAcquire() {
  const server = await openCodeEnsure();
  openCodeActive += 1;
  let released = false;
  return {
    server,
    release() {
      if (released) return;
      released = true;
      openCodeActive = Math.max(0, openCodeActive - 1);
      openCodeScheduleIdle();
    },
  };
}

function openCodeStop() {
  if (openCodeIdleTimer) {
    clearTimeout(openCodeIdleTimer);
    openCodeIdleTimer = null;
  }
  const server = openCodeServer;
  openCodeServer = null;
  openCodeModelsCache = null;
  openCodeActive = 0;
  if (server) killProcessTree(server.child);
}

function openCodeServerState() {
  const server = openCodeServer;
  return {
    ok: true,
    running: Boolean(server),
    starting: Boolean(openCodeStarting),
    port: server?.port ?? 0,
    version: server?.version ?? "",
    api: server?.api ?? "",
    source: server?.source ?? "",
    since: server?.startedAt ?? 0,
    error: server ? "" : openCodeLastError,
  };
}

function openCodeCostIsFree(cost, id) {
  const entry = Array.isArray(cost) ? cost[0] : cost;
  if (entry && typeof entry === "object") {
    const input = Number(entry.input ?? NaN);
    const output = Number(entry.output ?? NaN);
    if (Number.isFinite(input) && Number.isFinite(output)) {
      return input === 0 && output === 0;
    }
  }
  return /(^|[-_/])free($|[-_/])/i.test(String(id ?? ""));
}

function openCodeSortModels(models, defaultKey) {
  return [...models].sort((left, right) => {
    if (left.key === defaultKey && right.key !== defaultKey) return -1;
    if (right.key === defaultKey && left.key !== defaultKey) return 1;
    if (left.free !== right.free) return left.free ? -1 : 1;
    const leftOpenCode = left.providerId === "opencode";
    const rightOpenCode = right.providerId === "opencode";
    if (leftOpenCode !== rightOpenCode) return leftOpenCode ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function openCodeNormalizeModelsV2(modelsJson, defaultJson, providersJson) {
  const providerNames = new Map();
  const providerList = Array.isArray(providersJson?.data) ? providersJson.data : [];
  for (const item of providerList) {
    if (item && typeof item.id === "string") {
      providerNames.set(item.id, String(item.name || item.id));
    }
  }

  const rawList = Array.isArray(modelsJson?.data) ? modelsJson.data : [];
  const models = [];
  const seen = new Set();

  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    if (item.enabled === false) continue;
    if (item.status && item.status !== "active") continue;
    const id = String(item.modelID || item.id || "").trim();
    const providerId = String(item.providerID || item.settings?.provider || "opencode").trim();
    if (!id || !providerId) continue;
    const key = `${providerId}/${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const providerName = providerNames.get(providerId) || (providerId === "opencode" ? "OpenCode" : providerId);
    const name = String(item.name || id).trim();
    const free = openCodeCostIsFree(item.cost, id);
    const reasoning = Boolean(
      item.compatibility?.reasoningField || (Array.isArray(item.variants) && item.variants.length > 0)
    );
    const tools = Boolean(item.capabilities?.tools);
    const context = Number(item.limit?.context ?? 0) || 0;
    const output = Number(item.limit?.output ?? 0) || 0;

    models.push({
      key,
      id,
      providerId,
      providerName,
      name,
      free,
      reasoning,
      tools,
      context,
      output,
    });
  }

  const def = defaultJson?.data;
  const defProvider = String(def?.providerID || "opencode").trim();
  const defId = String(def?.modelID || def?.id || "").trim();
  const candidateDefault = defId ? `${defProvider}/${defId}` : "";
  const sorted = openCodeSortModels(models, candidateDefault);
  const defaultModel = sorted.find((entry) => entry.key === candidateDefault)?.key ?? sorted[0]?.key ?? "";
  return { models: sorted, defaultModel };
}

function openCodeNormalizeModelsV1(configJson) {
  const providerList = Array.isArray(configJson?.providers) ? configJson.providers : [];
  const defaults = configJson?.default && typeof configJson.default === "object" ? configJson.default : {};
  const models = [];
  const seen = new Set();

  for (const provider of providerList) {
    if (!provider || typeof provider !== "object") continue;
    const providerId = String(provider.id || "opencode").trim();
    const providerName = String(provider.name || (providerId === "opencode" ? "OpenCode" : providerId)).trim();
    const map = provider.models && typeof provider.models === "object" ? provider.models : {};
    for (const [rawKey, item] of Object.entries(map)) {
      if (!item || typeof item !== "object") continue;
      if (item.status && item.status !== "active") continue;
      const id = String(item.id || rawKey || "").trim();
      if (!id) continue;
      const key = `${providerId}/${id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const name = String(item.name || id).trim();
      const free = openCodeCostIsFree(item.cost, id);
      const reasoning = Boolean(
        item.capabilities?.reasoning ||
          item.capabilities?.interleaved ||
          (item.variants && typeof item.variants === "object" && Object.keys(item.variants).length > 0)
      );
      const tools = Boolean(item.capabilities?.toolcall || item.capabilities?.tools);
      const context = Number(item.limit?.context ?? 0) || 0;
      const output = Number(item.limit?.output ?? 0) || 0;

      models.push({
        key,
        id,
        providerId,
        providerName,
        name,
        free,
        reasoning,
        tools,
        context,
        output,
      });
    }
  }

  let candidateDefault = "";
  if (typeof defaults.opencode === "string" && defaults.opencode) {
    candidateDefault = `opencode/${defaults.opencode}`;
  } else {
    const firstPair = Object.entries(defaults).find(([, val]) => typeof val === "string" && val);
    if (firstPair) candidateDefault = `${firstPair[0]}/${firstPair[1]}`;
  }

  const sorted = openCodeSortModels(models, candidateDefault);
  const defaultModel = sorted.find((entry) => entry.key === candidateDefault)?.key ?? sorted[0]?.key ?? "";
  return { models: sorted, defaultModel };
}

async function openCodeModels({ fresh = false } = {}) {
  if (
    !fresh &&
    openCodeModelsCache &&
    openCodeServer &&
    openCodeModelsCache.port === openCodeServer.port &&
    Date.now() - openCodeModelsCache.at < OPENCODE_MODELS_TTL_MS
  ) {
    return openCodeModelsCache.value;
  }

  const lease = await openCodeAcquire();
  try {
    const { server } = lease;
    let normalized;
    if (server.api === "v2") {
      const [modelsReply, defaultReply, providersReply] = await Promise.all([
        openCodeRequest(server, "GET", "/api/model", null, { timeout: 10000 }),
        openCodeRequest(server, "GET", "/api/model/default", null, { timeout: 5000 }).catch(() => ({ json: null })),
        openCodeRequest(server, "GET", "/api/provider", null, { timeout: 5000 }).catch(() => ({ json: null })),
      ]);
      if (modelsReply.status !== 200 || !modelsReply.json) {
        throw new Error(`OpenCode model list returned status ${modelsReply.status}.`);
      }
      normalized = openCodeNormalizeModelsV2(modelsReply.json, defaultReply.json, providersReply.json);
    } else {
      const reply = await openCodeRequest(server, "GET", "/config/providers", null, { timeout: 10000 });
      if (reply.status !== 200 || !reply.json) {
        throw new Error(`OpenCode model list returned status ${reply.status}.`);
      }
      normalized = openCodeNormalizeModelsV1(reply.json);
    }

    const config = await readAiConfig();
    const currentChoice = String(config.cloudModel?.opencode ?? "").trim();
    const validChoice = normalized.models.find(
      (entry) => entry.key === currentChoice || entry.id === currentChoice
    );
    const chosen = validChoice?.key || normalized.defaultModel || "";
    if (chosen && currentChoice !== chosen) {
      await writeAiConfig({
        ...config,
        cloudModel: { ...config.cloudModel, opencode: chosen },
      });
    }

    const value = {
      ok: true,
      models: normalized.models,
      defaultModel: normalized.defaultModel,
      selectedModel: chosen,
      api: server.api,
      version: server.version,
    };
    openCodeModelsCache = { at: Date.now(), port: server.port, value };
    return value;
  } finally {
    lease.release();
  }
}

function openCodeResolveModel(raw, catalog) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const wanted = String(raw || "").trim();
  if (wanted) {
    const exact = models.find((entry) => entry.key === wanted || entry.id === wanted);
    if (exact) return { providerID: exact.providerId, modelID: exact.id, key: exact.key, name: exact.name };
    if (wanted.includes("/")) {
      const slash = wanted.indexOf("/");
      const providerID = wanted.slice(0, slash).trim() || "opencode";
      const modelID = wanted.slice(slash + 1).trim();
      if (modelID) return { providerID, modelID, key: `${providerID}/${modelID}`, name: modelID };
    }
    return { providerID: "opencode", modelID: wanted, key: `opencode/${wanted}`, name: wanted };
  }
  const fallback =
    models.find((entry) => entry.key === catalog?.defaultModel) ||
    models[0] ||
    { providerId: "opencode", id: "big-pickle", key: "opencode/big-pickle", name: "Big Pickle" };
  return {
    providerID: fallback.providerId,
    modelID: fallback.id,
    key: fallback.key,
    name: fallback.name,
  };
}

function openCodeMapToolName(name) {
  const clean = String(name || "").replace(/^mcp__(?:wide__)?|^wide_/, "");
  const key = clean.toLowerCase();
  if (key === "read") return "read_file";
  if (key === "write") return "write_file";
  if (key === "edit" || key === "patch" || key === "multiedit") return "edit_file";
  if (key === "list" || key === "ls") return "list_dir";
  if (key === "grep" || key === "glob") return "search";
  if (key === "shell" || key === "bash") return "run_command";
  return clean || name || "tool";
}

async function openCodeEnsureWideMcp(bridgePort, token, root) {
  try {
    const home = electron.app.getPath("home");
    const globalConfigDir = node_path.join(home, ".config", "opencode");
    const globalConfigFile = node_path.join(globalConfigDir, "opencode.json");

    const mcpEntry = {
      type: "local",
      command: [process.execPath, node_path.join(appRoot(), "sidecar", "ai-mcp.cjs")],
      environment: {
        WIDE_AI_PORT: String(bridgePort),
        WIDE_AI_TOKEN: token,
        WIDE_AI_ROOT: root || "",
      },
    };

    const updateConfig = async (filePath) => {
      let existing = {};
      try {
        existing = JSON.parse(await promises.readFile(filePath, "utf8"));
      } catch {
        existing = {};
      }
      if (!existing || typeof existing !== "object") existing = {};
      if (!existing.mcp || typeof existing.mcp !== "object") existing.mcp = {};
      if (!existing.mcp.servers || typeof existing.mcp.servers !== "object") existing.mcp.servers = {};
      existing.mcp.servers.wide = mcpEntry;
      await promises.mkdir(node_path.dirname(filePath), { recursive: true });
      await promises.writeFile(filePath, JSON.stringify(existing, null, 2), "utf8");
    };

    await updateConfig(globalConfigFile);

    if (root) {
      await updateConfig(node_path.join(root, ".opencode", "opencode.json")).catch(() => {});
    }
  } catch (error) {
    console.error("[openCodeEnsureWideMcp] Failed to configure MCP:", error);
  }
}

function openCodeExtractMessageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function openCodeBuildPrompt({ messages, system, projectInstructions, root, effort }) {
  const sections = [];
  const trimmedSystem = String(system || "").trim();
  if (trimmedSystem) sections.push(`System Instructions:\n${trimmedSystem}`);
  if (projectInstructions && !trimmedSystem.includes(projectInstructions)) {
    sections.push(`Project AI Instructions (.wide/ai-instructions.md):\n${projectInstructions}`);
  }
  if (root) {
    sections.push(`Active Project Workspace: ${root}`);
  }
  if (effort === "thinking") {
    sections.push("Reason carefully step by step before giving your final answer.");
  }

  const list = Array.isArray(messages) ? messages : [];
  const relevant = list.filter((item) => item && (item.role === "user" || item.role === "assistant"));
  if (relevant.length <= 1) {
    const single = openCodeExtractMessageText(relevant[0]);
    if (single) sections.push(single);
  } else {
    const historyLines = [];
    for (let index = 0; index < relevant.length - 1; index += 1) {
      const item = relevant[index];
      const text = openCodeExtractMessageText(item).trim();
      if (!text) continue;
      historyLines.push(`${item.role === "user" ? "User" : "Assistant"}: ${text}`);
    }
    if (historyLines.length > 0) {
      sections.push(`Conversation History:\n${historyLines.join("\n\n")}`);
    }
    const latest = openCodeExtractMessageText(relevant[relevant.length - 1]).trim();
    if (latest) {
      sections.push(`Current User Request:\n${latest}`);
    }
  }
  return sections.join("\n\n");
}

function openCodeRunTurnV2({ server, resolved, promptText, root, allowWrites, signal, send }) {
  return new Promise((resolve) => {
    let settled = false;
    let sessionID = "";
    let sseRequest = null;
    let answered = false;
    let inputTokens = 0;
    let outputTokens = 0;
    const t0 = Date.now();
    const toolNames = new Map();

    const filter =
      typeof aiCreateToolTagFilter === "function"
        ? aiCreateToolTagFilter(
            (delta) => {
              if (delta) {
                answered = true;
                send({ type: "text", text: delta });
              }
            },
            (thinkDelta) => {
              if (thinkDelta) send({ type: "thinking", text: thinkDelta });
            }
          )
        : {
            push(delta) {
              if (delta) {
                answered = true;
                send({ type: "text", text: delta });
              }
            },
            flush() {},
          };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      if (typeof aiUnregisterTurnBridge === "function") {
        aiUnregisterTurnBridge(wideBridgeGlobalToken);
      }
      if (sseRequest) {
        try {
          sseRequest.destroy();
        } catch {
          void 0;
        }
        sseRequest = null;
      }
      if (sessionID) {
        const target = sessionID;
        sessionID = "";
        void openCodeRequest(server, "DELETE", `/api/session/${encodeURIComponent(target)}`, null, {
          timeout: 4000,
        }).catch(() => {});
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        filter.flush();
      } catch {
        void 0;
      }
      if (inputTokens > 0 || outputTokens > 0) {
        send({
          type: "usage",
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
        });
        if (typeof aiRecordCloudUsage === "function") {
          aiRecordCloudUsage("opencode", inputTokens, outputTokens);
        }
      }
      cleanup();
      resolve(result);
    };

    const onAbort = () => {
      if (sessionID) {
        void openCodeRequest(
          server,
          "POST",
          `/api/session/${encodeURIComponent(sessionID)}/interrupt`,
          null,
          { timeout: 3000 }
        ).catch(() => {});
      }
      finish({ ok: false, error: "stopped", answered });
    };

    if (signal?.aborted) {
      finish({ ok: false, error: "stopped", answered: false });
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    (async () => {
      try {
        if (typeof claudeToolBridge === "function") {
          const bridge = await claudeToolBridge();
          if (typeof aiRegisterTurnBridge === "function") {
            aiRegisterTurnBridge(wideBridgeGlobalToken, root, send);
          }
          await openCodeEnsureWideMcp(bridge.port, wideBridgeGlobalToken, root);
        }
      } catch (err) {
        console.error("[openCodeRunTurnV2] Tool bridge setup error:", err);
      }

      const permissions = [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "*.env", effect: "deny" },
        { action: "read", resource: "*.env.*", effect: "deny" },
        { action: "question", resource: "*", effect: "deny" },
        { action: "browser", resource: "*", effect: "deny" },
      ];
      if (allowWrites === false) {
        permissions.push({ action: "edit", resource: "*", effect: "deny" });
        permissions.push({ action: "write", resource: "*", effect: "deny" });
      }

      const sessionBody = {
        title: "Wide",
        agent: allowWrites === false ? "plan" : "build",
        model: { providerID: resolved.providerID, id: resolved.modelID },
        permissions,
        ...(root ? { location: { directory: root } } : {}),
      };

      let created;
      try {
        created = await openCodeRequest(server, "POST", "/api/session", sessionBody, { timeout: 10000 });
      } catch (error) {
        finish({ ok: false, error: String(error.message || error), answered: false });
        return;
      }

      const sid = String(created.json?.data?.id || created.json?.id || "").trim();
      if (created.status !== 200 || !sid) {
        const detail = String(created.json?.message || created.text || `HTTP ${created.status}`).trim();
        finish({ ok: false, error: detail || "OpenCode session could not be created.", answered: false });
        return;
      }
      sessionID = sid;

      let sseBuffer = "";
      const sseDecoder = new StringDecoder("utf8");

      const handleEventLine = (line) => {
        if (!line.startsWith("data:")) return;
        let evt;
        try {
          evt = JSON.parse(line.slice(5).trim());
        } catch {
          return;
        }
        if (!evt || typeof evt !== "object") return;
        const data = evt.data;
        if (!data || data.sessionID !== sessionID) return;

        if (evt.type === "session.reasoning.delta") {
          const delta = String(data.delta ?? "");
          if (delta) send({ type: "thinking", text: delta });
          return;
        }

        if (evt.type === "session.text.delta") {
          const delta = String(data.delta ?? "");
          if (delta) filter.push(delta);
          return;
        }

        if (evt.type === "session.tool.input.started") {
          const id = String(data.id ?? "");
          const mapped = openCodeMapToolName(data.name);
          if (id) toolNames.set(id, mapped);
          return;
        }

        if (evt.type === "session.tool.called") {
          const id = String(data.id ?? "");
          const mapped = toolNames.get(id) || openCodeMapToolName(data.name);
          if (id) toolNames.set(id, mapped);
          send({ type: "tool_start", id, name: mapped, input: data.input ?? {} });
          return;
        }

        if (evt.type === "session.tool.success") {
          const id = String(data.id ?? "");
          const mapped = toolNames.get(id) || "tool";
          const content = Array.isArray(data.content)
            ? data.content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("")
            : String(data.content ?? "");
          send({ type: "tool_end", id, name: mapped, result: content });
          return;
        }

        if (evt.type === "session.tool.failed") {
          const id = String(data.id ?? "");
          const mapped = toolNames.get(id) || "tool";
          const errText = String(data.error?.message || data.error || "Tool failed.");
          send({ type: "tool_end", id, name: mapped, result: errText });
          return;
        }

        if (evt.type === "permission.asked") {
          const reqId = String(data.id || data.requestID || "").trim();
          if (reqId) {
            void openCodeRequest(
              server,
              "POST",
              `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(reqId)}/reply`,
              { effect: "deny" },
              { timeout: 3000 }
            ).catch(() => {});
          }
          return;
        }

        if (evt.type === "session.usage.updated" || evt.type === "session.step.ended") {
          const tok = data.tokens;
          if (tok && typeof tok === "object") {
            const inTok = Number(tok.input ?? 0) || 0;
            const outTok = (Number(tok.output ?? 0) || 0) + (Number(tok.reasoning ?? 0) || 0);
            if (inTok > 0) inputTokens = inTok;
            if (outTok > 0) outputTokens = outTok;
          }
          return;
        }

        if (evt.type === "session.execution.succeeded") {
          if (typeof aiRecordCloudHeaders === "function") {
            aiRecordCloudHeaders("opencode", {}, 200, Date.now() - t0);
          }
          finish({ ok: true, answered });
          return;
        }

        if (evt.type === "session.execution.failed" || evt.type === "session.step.failed") {
          const errObj = data.error;
          const status = Number(errObj?.status ?? 500) || 500;
          const code = String(errObj?.type ?? "");
          const msg = String(errObj?.message || "OpenCode reported an error.");
          if (typeof aiRecordCloudHeaders === "function") {
            aiRecordCloudHeaders("opencode", {}, status, Date.now() - t0);
          }
          finish({
            ok: false,
            error: msg,
            code,
            status,
            rateLimited: status === 429 || /free-limit|rate/i.test(code),
            answered,
          });
          return;
        }

        if (evt.type === "session.execution.interrupted") {
          finish({ ok: false, error: "stopped", answered });
        }
      };

      const connected = new Promise((resolveConnected, rejectConnected) => {
        sseRequest = node_http.request(
          {
            host: OPENCODE_HOST,
            port: server.port,
            method: "GET",
            path: "/api/event",
            headers: {
              accept: "text/event-stream",
              authorization: `Basic ${Buffer.from(`${OPENCODE_USER}:${server.password}`).toString("base64")}`,
            },
          },
          (response) => {
            if (response.statusCode !== 200) {
              rejectConnected(new Error(`OpenCode event stream returned HTTP ${response.statusCode}.`));
              return;
            }
            resolveConnected();
            response.on("data", (chunk) => {
              sseBuffer += sseDecoder.write(chunk);
              let cut;
              while ((cut = sseBuffer.indexOf("\n")) >= 0) {
                const line = sseBuffer.slice(0, cut).trim();
                sseBuffer = sseBuffer.slice(cut + 1);
                if (line) handleEventLine(line);
              }
            });
            response.on("end", () => {
              if (!settled) {
                finish(answered ? { ok: true, answered: true } : { ok: false, error: "OpenCode event stream closed unexpectedly.", answered: false });
              }
            });
            response.on("error", (error) => {
              if (!settled) finish({ ok: false, error: String(error.message || error), answered });
            });
          }
        );
        sseRequest.on("error", rejectConnected);
        sseRequest.end();
      });

      try {
        await connected;
      } catch (error) {
        finish({ ok: false, error: String(error.message || error), answered: false });
        return;
      }

      try {
        const promptReply = await openCodeRequest(
          server,
          "POST",
          `/api/session/${encodeURIComponent(sessionID)}/prompt`,
          { text: promptText },
          { timeout: 15000 }
        );
        if (promptReply.status !== 200) {
          const detail = String(promptReply.json?.message || promptReply.text || `HTTP ${promptReply.status}`).trim();
          finish({ ok: false, error: detail || "OpenCode rejected the prompt.", answered });
        }
      } catch (error) {
        if (!settled) {
          finish({ ok: false, error: String(error.message || error), answered });
        }
      }
    })();
  });
}

function openCodeRunTurnV1({ server, resolved, promptText, system, signal, send }) {
  return new Promise((resolve) => {
    let settled = false;
    let sessionID = "";
    let sseRequest = null;
    let answered = false;
    const partTypes = new Map();
    const t0 = Date.now();

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      if (sseRequest) {
        try {
          sseRequest.destroy();
        } catch {
          void 0;
        }
        sseRequest = null;
      }
      if (sessionID) {
        const target = sessionID;
        sessionID = "";
        void openCodeRequest(server, "DELETE", `/session/${encodeURIComponent(target)}`, null, {
          timeout: 4000,
        }).catch(() => {});
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAbort = () => {
      if (sessionID) {
        void openCodeRequest(server, "POST", `/session/${encodeURIComponent(sessionID)}/abort`, null, {
          timeout: 3000,
        }).catch(() => {});
      }
      finish({ ok: false, error: "stopped", answered });
    };

    if (signal?.aborted) {
      finish({ ok: false, error: "stopped", answered: false });
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    (async () => {
      let created;
      try {
        created = await openCodeRequest(server, "POST", "/session", { title: "Wide" }, { timeout: 10000 });
      } catch (error) {
        finish({ ok: false, error: String(error.message || error), answered: false });
        return;
      }

      const sid = String(created.json?.id || "").trim();
      if (created.status !== 200 || !sid) {
        finish({ ok: false, error: "OpenCode session could not be created.", answered: false });
        return;
      }
      sessionID = sid;

      let sseBuffer = "";
      const sseDecoder = new StringDecoder("utf8");

      sseRequest = node_http.request(
        {
          host: OPENCODE_HOST,
          port: server.port,
          method: "GET",
          path: "/event",
          headers: {
            accept: "text/event-stream",
            authorization: `Basic ${Buffer.from(`${OPENCODE_USER}:${server.password}`).toString("base64")}`,
          },
        },
        (response) => {
          response.on("data", (chunk) => {
            sseBuffer += sseDecoder.write(chunk);
            let cut;
            while ((cut = sseBuffer.indexOf("\n")) >= 0) {
              const line = sseBuffer.slice(0, cut).trim();
              sseBuffer = sseBuffer.slice(cut + 1);
              if (!line.startsWith("data:")) continue;
              let evt;
              try {
                evt = JSON.parse(line.slice(5).trim());
              } catch {
                continue;
              }
              const props = evt?.properties;
              if (!props || props.sessionID !== sessionID) continue;
              if (evt.type === "message.part.updated" && props.part?.id) {
                partTypes.set(props.part.id, props.part.type);
              } else if (evt.type === "message.part.delta" && props.delta) {
                const kind = partTypes.get(props.partID) || "text";
                if (kind === "reasoning") {
                  send({ type: "thinking", text: String(props.delta) });
                } else if (kind === "text") {
                  answered = true;
                  send({ type: "text", text: String(props.delta) });
                }
              }
            }
          });
        }
      );
      sseRequest.on("error", () => {});
      sseRequest.end();

      try {
        const reply = await openCodeRequest(
          server,
          "POST",
          `/session/${encodeURIComponent(sessionID)}/message`,
          {
            model: { providerID: resolved.providerID, modelID: resolved.modelID },
            ...(system ? { system } : {}),
            parts: [{ type: "text", text: promptText }],
          },
          { timeout: 120000 }
        );
        if (reply.status !== 200) {
          const detail = String(reply.json?.message || reply.text || `HTTP ${reply.status}`).trim();
          finish({ ok: false, error: detail || "OpenCode request failed.", answered });
          return;
        }
        if (!answered && Array.isArray(reply.json?.parts)) {
          const fullText = reply.json.parts
            .filter((part) => part && part.type === "text" && typeof part.text === "string")
            .map((part) => part.text)
            .join("");
          if (fullText) {
            answered = true;
            send({ type: "text", text: fullText });
          }
        }
        const tok = reply.json?.info?.tokens;
        if (tok && typeof tok === "object") {
          const inTok = Number(tok.input ?? 0) || 0;
          const outTok = (Number(tok.output ?? 0) || 0) + (Number(tok.reasoning ?? 0) || 0);
          if (inTok > 0 || outTok > 0) {
            send({ type: "usage", input: inTok, output: outTok, total: inTok + outTok });
            if (typeof aiRecordCloudUsage === "function") aiRecordCloudUsage("opencode", inTok, outTok);
          }
        }
        if (typeof aiRecordCloudHeaders === "function") {
          aiRecordCloudHeaders("opencode", {}, 200, Date.now() - t0);
        }
        finish({ ok: true, answered });
      } catch (error) {
        finish({ ok: false, error: String(error.message || error), answered });
      }
    })();
  });
}

const OPENCODE_FALLBACK_ORDER = [
  "opencode/glm-5.3-flash-free",
  "opencode/mimo-v2.6-flash-free",
  "opencode/nemotron-3.5-super-vl-free",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/flint-40b-free",
  "opencode/crouton-alpha-free",
  "opencode/pulse-alpha-free",
  "opencode/beam-free",
  "opencode/deepseek-v4.1-flash-free",
  "opencode/big-pickle",
];

async function aiRunOpenCodeTurn({
  root,
  model,
  system,
  messages,
  projectInstructions = "",
  allowWrites = true,
  effort = "fast",
  signal,
  send,
}) {
  let lease;
  try {
    lease = await openCodeAcquire();
  } catch (error) {
    const message = String(error.message || error);
    send({ type: "error", message });
    return { ok: false, error: message };
  }

  try {
    const catalog = await openCodeModels().catch(() => ({ models: [], defaultModel: "" }));
    const config = await readAiConfig();
    const wanted = String(model || config.cloudModel?.opencode || "").trim();
    const primary = openCodeResolveModel(wanted, catalog);
    const promptText = openCodeBuildPrompt({ messages, system, projectInstructions, root, effort });

    const candidates = [primary];
    for (const key of OPENCODE_FALLBACK_ORDER) {
      if (candidates.some((entry) => entry.key === key)) continue;
      const found = catalog.models?.find((entry) => entry.key === key);
      if (found) {
        candidates.push({
          providerID: found.providerId,
          modelID: found.id,
          key: found.key,
          name: found.name,
        });
      }
    }

    let lastResult = { ok: false, error: "OpenCode could not complete the request." };
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const result =
        lease.server.api === "v2"
          ? await openCodeRunTurnV2({
              server: lease.server,
              resolved: candidate,
              promptText,
              root,
              allowWrites,
              signal,
              send,
            })
          : await openCodeRunTurnV1({
              server: lease.server,
              resolved: candidate,
              promptText,
              system,
              signal,
              send,
            });

      lastResult = result;
      if (result.ok) {
        if (index > 0) {
          const latestConfig = await readAiConfig();
          await writeAiConfig({
            ...latestConfig,
            cloudModel: { ...latestConfig.cloudModel, opencode: candidate.key },
          });
        }
        return { ok: true, answered: result.answered };
      }
      if (signal?.aborted || result.error === "stopped" || result.answered || !result.rateLimited) {
        break;
      }
    }

    if (lastResult.error && lastResult.error !== "stopped") {
      send({ type: "error", message: lastResult.error });
    }
    return { ok: false, error: lastResult.error || "OpenCode request failed." };
  } finally {
    lease.release();
  }
}

function registerOpenCodeHandlers() {

  electron.ipcMain.handle("ai:openCodeStatus", async (_event, fresh) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    return openCodeStatus({ fresh: fresh === true });
  });

  electron.ipcMain.handle("ai:openCodeInstall", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    return openCodeInstall(null);
  });

  electron.ipcMain.handle("ai:openCodeServer", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    return openCodeServerState();
  });

  electron.ipcMain.handle("ai:openCodeStart", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    try {
      await openCodeEnsure();
      return openCodeServerState();
    } catch (error) {
      return { ...openCodeServerState(), ok: false, error: String(error.message || error) };
    }
  });

  electron.ipcMain.handle("ai:openCodeStop", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    openCodeStop();
    return openCodeServerState();
  });

  electron.ipcMain.handle("ai:openCodeModels", async (_event, fresh) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    try {
      return await openCodeModels({ fresh: fresh === true });
    } catch (error) {
      return {
        ok: false,
        error: String(error.message || error),
        models: [],
        defaultModel: "",
        selectedModel: "",
      };
    }
  });
}
