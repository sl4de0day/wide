



const EXTENSIONS_FILE = () =>
  node_path.join(electron.app.getPath("userData"), "extensions.json");





const OPTIONAL_EXTENSIONS = new Set(["codeberg", "github", "comment-cleaner", "javascript", "typescript", "html", "css", "php", "python", "csharp", "java", "go", "ruby", "rust", "elixir", "kotlin", "sql", "graphql", "wasm", "scala", "erlang", "vue", "svelte", "angular", "ai-assistant", "trufflehog", "nuclei", "ffuf", "katana", "httpx", "dalfox", "subfinder", "interactsh", "sqlmap", "arjun", "curlconverter", "retirejs", "secretfinder", "jwt-tool", "commix", "sublist3r", "seclists", "python-debugger", "go-debugger", "ruby-debugger", "cyberchef", "wappalyzer", "js-miner", "selector-test"]);



let installedCache = null;

async function readInstalled() {
  if (installedCache) return installedCache;
  try {
    const parsed = JSON.parse(await promises.readFile(EXTENSIONS_FILE(), "utf8"));
    const list = Array.isArray(parsed.installed) ? parsed.installed : [];
    installedCache = new Set(list.filter((id) => OPTIONAL_EXTENSIONS.has(id)));
  } catch {



    installedCache = new Set();
  }
  return installedCache;
}



let writeQueue = Promise.resolve();

function serialise(work) {
  const next = writeQueue.then(work, work);

  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function writeInstalled(set) {
  installedCache = set;
  const installed = [...set];

  await writeExtensionsFile();
  return installed;
}



let serverCache = null;

async function readServers() {
  if (serverCache) return serverCache;
  try {
    const parsed = JSON.parse(await promises.readFile(EXTENSIONS_FILE(), "utf8"));
    serverCache = parsed.servers && typeof parsed.servers === "object" ? parsed.servers : {};
  } catch {
    serverCache = {};
  }
  return serverCache;
}



let settingsCache = null;

async function readExtensionSettings() {
  if (settingsCache) return settingsCache;
  try {
    const parsed = JSON.parse(await promises.readFile(EXTENSIONS_FILE(), "utf8"));
    settingsCache = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};
  } catch {
    settingsCache = {};
  }
  return settingsCache;
}


async function writeExtensionsFile() {
  const installed = [...(await readInstalled())];
  const servers = await readServers();
  const settings = await readExtensionSettings();
  try {
    await writeFileAtomic(EXTENSIONS_FILE(), JSON.stringify({ installed, servers, settings }, null, 2), "utf8");
  } catch (error) {
    console.warn("[extensions] The extensions file could not be saved:", error.message);
  }
}



async function rememberServer(id, found) {




  return serialise(async () => {
    const servers = { ...(await readServers()), [id]: found };
    serverCache = servers;
    await writeExtensionsFile();
    return servers;
  });
}


async function writeExtensionSettings(id, record) {


  return serialise(async () => {
    const next = { ...(await readExtensionSettings()), [id]: record };
    settingsCache = next;
    await writeExtensionsFile();
    return next;
  });
}



const BUILTIN_TOOLS = new Set(["proxy", "browser"]);


async function extensionInstalled(id) {
  if (BUILTIN_TOOLS.has(id)) return true;
  return (await readInstalled()).has(id);
}



async function requireInstalled(id) {
  if (await extensionInstalled(id)) return null;
  return { installed: false, error: "That extension is not installed." };
}

function registerExtensionHandlers() {
  electron.ipcMain.handle("extensions:list", async () => ({
    installed: [...(await readInstalled())],
    optional: [...OPTIONAL_EXTENSIONS],
  }));



  const change = (channel, apply) =>
    electron.ipcMain.handle(channel, async (_event, id) =>
      serialise(async () => {
        if (!OPTIONAL_EXTENSIONS.has(id)) {
          return {
            ok: false,
            error: "There is no such extension.",
            installed: [...(await readInstalled())],
          };
        }
        const next = new Set(await readInstalled());
        apply(next, id);
        return { ok: true, id, installed: await writeInstalled(next) };
      })
    );

  change("extensions:install", (set, id) => set.add(id));
  change("extensions:remove", (set, id) => set.delete(id));



  electron.ipcMain.handle("extensions:getSettings", async () => ({
    ok: true,
    settings: await readExtensionSettings(),
  }));



  electron.ipcMain.handle("extensions:setSettings", async (_event, id, record) => {
    if (!OPTIONAL_EXTENSIONS.has(id)) return { ok: false, error: "There is no such extension." };
    const clean = {
      values: record?.values && typeof record.values === "object" ? record.values : {},
      serverCommand: typeof record?.serverCommand === "string" ? record.serverCommand.trim() : "",
      init: record?.init && typeof record.init === "object" ? record.init : {},
      env: record?.env && typeof record.env === "object" ? record.env : {},
    };
    const settings = await writeExtensionSettings(id, clean);
    return { ok: true, id, settings };
  });
}
