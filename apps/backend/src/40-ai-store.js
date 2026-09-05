

const AI_CONFIG_FILE = () =>
  node_path.join(electron.app.getPath("userData"), "ai-config.json");
const AI_KEYS_FILE = () =>
  node_path.join(electron.app.getPath("userData"), "ai-keys.bin");
const AI_SESSION_DIR = () =>
  node_path.join(electron.app.getPath("userData"), "ai-sessions");

const AI_PROVIDERS = new Set(["gemini", "deepseek", "claude"]);

const AI_DEFAULT_CONFIG = {

  tab: "cloud",
  provider: "deepseek",
  cloudModel: {
    gemini: "gemini-3.7-flash",
    deepseek: "deepseek-v4-pro",
    claude: "",
    "claude-code": "",
  },
  localModel: "",

  allowWrites: true,

  claudeCodeSignedIn: false,
};

let aiConfigCache = null;

async function readAiConfig() {
  if (aiConfigCache) return aiConfigCache;
  try {
    const parsed = JSON.parse(await promises.readFile(AI_CONFIG_FILE(), "utf8"));
    aiConfigCache = { ...AI_DEFAULT_CONFIG, ...parsed, cloudModel: { ...AI_DEFAULT_CONFIG.cloudModel, ...(parsed.cloudModel ?? {}) } };
  } catch {
    aiConfigCache = { ...AI_DEFAULT_CONFIG, cloudModel: { ...AI_DEFAULT_CONFIG.cloudModel } };
  }
  return aiConfigCache;
}

async function writeAiConfig(next) {
  aiConfigCache = next;
  try {
    await promises.writeFile(AI_CONFIG_FILE(), JSON.stringify(next, null, 2), "utf8");
  } catch (error) {
    console.warn("[ai] The settings could not be saved:", error.message);
  }
  return next;
}

let aiKeyCache = null;

function aiKeysAreLegacy(blob) {
  const isLegacy = electron.safeStorage.isLegacyEncrypted;
  return typeof isLegacy === "function" && isLegacy.call(electron.safeStorage, blob);
}

function secretsNeedReseal() {
  const isStale = electron.safeStorage.isStaleSeal;
  return typeof isStale === "function" && isStale.call(electron.safeStorage) === true;
}

let aiKeysUnreadable = false;

async function readAiKeys() {
  if (aiKeyCache) return aiKeyCache;
  let rewrite = false;
  try {
    const blob = await promises.readFile(AI_KEYS_FILE());
    aiKeyCache = JSON.parse(electron.safeStorage.decryptString(blob));
    aiKeysUnreadable = false;
    rewrite = aiKeysAreLegacy(blob) || secretsNeedReseal();
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      aiKeysUnreadable = true;
      console.warn("[ai] The saved keys could not be read:", error.message);
    }
    aiKeyCache = {};
  }
  if (rewrite) await writeAiKeys(aiKeyCache);
  return aiKeyCache;
}

async function preserveUnreadable(file) {
  for (let n = 1; n <= 20; n += 1) {
    const kept = `${file}.unreadable-${n}`;
    try {
      await promises.access(kept);
      continue;
    } catch {
      void 0;
    }
    try {
      await promises.rename(file, kept);
      console.warn(`[ai] The previous file could not be decrypted and was kept as ${kept}`);
    } catch {
      void 0;
    }
    return;
  }
}

async function writeAiKeys(keys) {
  aiKeyCache = keys;
  if (aiKeysUnreadable) {
    aiKeysUnreadable = false;
    await preserveUnreadable(AI_KEYS_FILE());
  }
  try {
    await promises.writeFile(AI_KEYS_FILE(), electron.safeStorage.encryptString(JSON.stringify(keys)));
  } catch (error) {
    console.warn("[ai] The keys could not be saved:", error.message);
  }
}

async function aiKeyFor(provider) {
  const keys = await readAiKeys();
  return typeof keys[provider] === "string" ? keys[provider] : "";
}

const AI_ID_PATTERN = /^[0-9a-f]{32}$/;

function newSessionId() {
  return node_crypto.randomBytes(16).toString("hex");
}

function sessionFile(id) {
  if (!AI_ID_PATTERN.test(String(id || ""))) return "";
  return node_path.join(AI_SESSION_DIR(), `${id}.json`);
}

const MAX_SESSION_MESSAGES = 200;

function sessionTitle(messages) {
  const first = (Array.isArray(messages) ? messages : []).find(
    (message) => message && message.role === "user" && typeof message.content === "string"
  );
  const text = String(first?.content ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

async function readAiSession(id) {
  const file = sessionFile(id);
  if (!file) return null;
  try {
    const parsed = JSON.parse(await promises.readFile(file, "utf8"));
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    return {

      id: typeof parsed.id === "string" && parsed.id ? parsed.id : String(id),
      root: parsed.root ?? "",
      title: parsed.title || sessionTitle(messages),
      createdAt: Number(parsed.createdAt) || 0,
      updatedAt: Number(parsed.updatedAt) || 0,
      messages,
    };
  } catch {
    return null;
  }
}

async function writeAiSession(id, root, messages, stamp) {
  const file = sessionFile(id);
  if (!file) return null;
  const trimmed = Array.isArray(messages) ? messages.slice(-MAX_SESSION_MESSAGES) : [];
  const existing = await readAiSession(id);
  const record = {
    id: String(id),
    root: root || existing?.root || "",

    title: existing?.title || sessionTitle(trimmed),
    createdAt: existing?.createdAt || stamp,
    updatedAt: stamp,
    messages: trimmed,
  };
  try {
    await promises.mkdir(AI_SESSION_DIR(), { recursive: true });
    await promises.writeFile(file, JSON.stringify(record, null, 2), "utf8");
  } catch (error) {
    console.warn("[ai] The conversation could not be saved:", error.message);
    return null;
  }
  return record;
}

async function listAiSessions(root) {
  let names = [];
  try {
    names = await promises.readdir(AI_SESSION_DIR());
  } catch {
    return [];
  }
  const wanted = String(root || "").toLowerCase();
  const found = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const record = await readAiSession(name.slice(0, -5));
    if (!record) continue;

    if (record.root && String(record.root).toLowerCase() !== wanted) continue;
    found.push({
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      count: record.messages.length,
    });
  }
  found.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  return found;
}

function registerAiStoreHandlers() {
  electron.ipcMain.handle("ai:config", async (_event, patch) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    if (!patch || typeof patch !== "object") {
      return { ok: true, config: await readAiConfig() };
    }
    const current = await readAiConfig();
    const next = {
      ...current,
      ...patch,
      cloudModel: { ...current.cloudModel, ...(patch.cloudModel ?? {}) },
    };
    return { ok: true, config: await writeAiConfig(next) };
  });

  electron.ipcMain.handle("ai:keyStatus", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const keys = await readAiKeys();
    const configured = {};
    for (const provider of AI_PROVIDERS) {
      configured[provider] = Boolean(keys[provider]);
    }
    return { ok: true, configured };
  });

  electron.ipcMain.handle("ai:setKey", async (_event, provider, key) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    if (!AI_PROVIDERS.has(provider)) return { ok: false, error: "There is no such provider." };

    const keys = { ...(await readAiKeys()) };
    const value = typeof key === "string" ? key.trim() : "";
    if (value) keys[provider] = value;
    else delete keys[provider];
    await writeAiKeys(keys);
    return { ok: true, configured: Boolean(value) };
  });

  electron.ipcMain.handle("ai:sessions", async (_event, root) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    return { ok: true, sessions: await listAiSessions(root) };
  });

  electron.ipcMain.handle("ai:session", async (_event, id) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const record = await readAiSession(id);
    if (!record) return { ok: false, error: "There is no such conversation." };
    return { ok: true, session: record };
  });

  electron.ipcMain.handle("ai:newSession", async (_event, root) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const now = Date.now();
    return {
      ok: true,
      session: { id: newSessionId(), root: root || "", title: "", createdAt: now, updatedAt: now, messages: [] },
    };
  });

  electron.ipcMain.handle("ai:saveSession", async (_event, id, root, messages) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const record = await writeAiSession(id, root, messages, Date.now());
    if (!record) return { ok: false, error: "The conversation could not be saved." };
    return { ok: true, session: { ...record, messages: undefined }, messages: record.messages };
  });

  electron.ipcMain.handle("ai:deleteSession", async (_event, id) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const file = sessionFile(id);
    if (!file) return { ok: false, error: "There is no such conversation." };
    try {
      await promises.rm(file, { force: true });
    } catch {

    }
    return { ok: true };
  });
}
