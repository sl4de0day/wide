



const SERVERS_BY_EXTENSION = (() => {
  const out = {};
  for (const entry of Object.values(LSP_SERVERS)) {
    if (!entry?.id || out[entry.id]) continue;
    out[entry.id] = entry.candidates;
  }
  return out;
})();

const PROBE_TIMEOUT_MS = 4000;

const PROVISION_TIMEOUT_MS = 10 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024;



const preparing = new Map();

function beginPrepare(id) {
  cancelPrepare(id);
  const track = { aborted: false, children: new Set(), requests: new Set() };
  preparing.set(id, track);
  return track;
}

function endPrepare(id, track) {
  if (preparing.get(id) === track) preparing.delete(id);
}


function cancelPrepare(id) {
  const track = preparing.get(id);
  if (!track) return false;
  track.aborted = true;
  for (const child of track.children) {
    try {
      killProcessTree(child);
    } catch {

    }
  }
  for (const request of track.requests) {
    try {
      request.destroy();
    } catch {

    }
  }
  preparing.delete(id);
  return true;
}


const SERVER_DIR = (id) => node_path.join(electron.app.getPath("userData"), "servers", id);



const managerEnv = () => ({
  ...process.env,
  CI: "1",
  DOTNET_NOLOGO: "1",
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
  npm_config_yes: "true",
  npm_config_fund: "false",
  npm_config_audit: "false",
  GIT_TERMINAL_PROMPT: "0",
  PIP_DISABLE_PIP_VERSION_CHECK: "1",
  PYTHONUNBUFFERED: "1",
});



const MANAGER_BOOTSTRAP = {
  gem: { package: "RubyInstallerTeam.Ruby.3.4", label: "Ruby" },
  go: { package: "GoLang.Go", label: "Go" },
  npm: { package: "OpenJS.NodeJS.LTS", label: "Node.js" },
  python: { package: "Python.Python.3.13", label: "Python" },
  dotnet: { package: "Microsoft.DotNet.SDK.9", label: ".NET SDK" },
  rustup: { package: "Rustlang.Rustup", label: "Rust" },
  cs: { package: "VirtusLab.Coursier", label: "Coursier" },
  java: { package: "EclipseAdoptium.Temurin.21.JDK", label: "Java" },
  elixir: { package: "ElixirLang.Elixir", label: "Elixir" },


  ollama: { package: "Ollama.Ollama", label: "Ollama" },
};



const PROVISIONERS = {
  python: {
    manager: "python",
    args: ["-m", "pip", "install", "--upgrade", "python-lsp-server"],
    provides: "pylsp",
    hint: ["Scripts"],
  },
  go: {
    manager: "go",
    args: ["install", "golang.org/x/tools/gopls@latest"],
    provides: "gopls",
    goBin: true,
  },
  rust: {
    manager: "rustup",
    args: ["component", "add", "rust-analyzer"],
    provides: "rust-analyzer",
  },
  php: {
    manager: "npm",
    args: ["install", "-g", "intelephense"],
    provides: "intelephense",
    npmBin: true,
  },
  ruby: {
    manager: "gem",
    args: ["install", "ruby-lsp"],
    provides: "ruby-lsp",
  },
  csharp: {
    manager: "dotnet",
    args: ["tool", "install", "--global", "csharp-ls"],
    provides: "csharp-ls",
    dotnetBin: true,
  },
  sql: {
    manager: "npm",
    args: ["install", "-g", "sql-language-server"],
    provides: "sql-language-server",
    npmBin: true,
  },
  graphql: {
    manager: "npm",
    args: ["install", "-g", "graphql-language-service-cli"],
    provides: "graphql-lsp",
    npmBin: true,
  },
  scala: {

    manager: "cs",
    args: ["install", "metals"],
    provides: "metals",
    csBin: true,
  },
  java: {
    archive: {

      url: "https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz&r=1",
      file: "jdtls.tar.gz",

      binaries: ["jdtls.bat", "jdtls"],
    },
    provides: "jdtls",

    needs: "java",
  },
  elixir: {
    archive: {
      github: "elixir-lsp/elixir-ls",
      asset: /^elixir-ls-v.*\.zip$/,
      file: "elixir-ls.zip",
      binaries: ["language_server.bat", "language_server.sh"],
    },
    provides: "language_server.bat",
    needs: "elixir",
  },
  kotlin: {
    archive: {
      github: "fwcd/kotlin-language-server",
      asset: /^server\.zip$/,
      file: "kotlin-ls.zip",
      binaries: ["kotlin-language-server.bat", "kotlin-language-server"],
    },
    provides: "kotlin-language-server",
    needs: "java",
  },


  vue: {
    manager: "npm",
    args: ["install", "-g", "@vue/language-server"],
    provides: "vue-language-server",
    npmBin: true,
  },
  svelte: {
    manager: "npm",
    args: ["install", "-g", "svelte-language-server"],
    provides: "svelteserver",
    npmBin: true,
  },


  angular: {
    manager: "npm",
    args: ["install", "-g", "@angular/language-server", "@angular/language-service", "typescript"],
    provides: "ngserver",
    npmBin: true,
  },
};



const TOOL_PROVISIONERS = {

  trufflehog: { manager: "go", args: ["install", "github.com/trufflesecurity/trufflehog/v3@latest"], provides: "trufflehog", goBin: true },
  nuclei: { manager: "go", args: ["install", "github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"], provides: "nuclei", goBin: true },
  ffuf: { manager: "go", args: ["install", "github.com/ffuf/ffuf/v2@latest"], provides: "ffuf", goBin: true },
  katana: { manager: "go", args: ["install", "github.com/projectdiscovery/katana/cmd/katana@latest"], provides: "katana", goBin: true },
  httpx: { manager: "go", args: ["install", "github.com/projectdiscovery/httpx/cmd/httpx@latest"], provides: "httpx", goBin: true },
  dalfox: { manager: "go", args: ["install", "github.com/hahwul/dalfox/v2@latest"], provides: "dalfox", goBin: true },
  subfinder: { manager: "go", args: ["install", "github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest"], provides: "subfinder", goBin: true },
  interactsh: { manager: "go", args: ["install", "github.com/projectdiscovery/interactsh/cmd/interactsh-client@latest"], provides: "interactsh-client", goBin: true },


  sqlmap: { manager: "python", args: ["-m", "pip", "install", "--upgrade", "sqlmap"], provides: "sqlmap", hint: ["Scripts"] },
  arjun: { manager: "python", args: ["-m", "pip", "install", "--upgrade", "arjun"], provides: "arjun", hint: ["Scripts"] },





  "python-debugger": { manager: "python", args: ["-m", "pip", "install", "--upgrade", "debugpy"], provides: "debugpy", hint: ["Scripts"] },
  "go-debugger": { manager: "go", args: ["install", "github.com/go-delve/delve/cmd/dlv@latest"], provides: "dlv", goBin: true },
  "ruby-debugger": { manager: "gem", args: ["install", "debug"], provides: "rdbg" },


  curlconverter: { manager: "npm", args: ["install", "-g", "curlconverter"], provides: "curlconverter", npmBin: true },
  retirejs: { manager: "npm", args: ["install", "-g", "retire"], provides: "retire", npmBin: true },


  secretfinder: { kind: "git", repo: "https://github.com/m4ll0k/SecretFinder", launcher: "SecretFinder.py", requirements: "requirements.txt", label: "SecretFinder.py" },
  "jwt-tool": { kind: "git", repo: "https://github.com/ticarpi/jwt_tool", launcher: "jwt_tool.py", requirements: "requirements.txt", label: "jwt_tool.py" },
  commix: { kind: "git", repo: "https://github.com/commixproject/commix", launcher: "commix.py", label: "commix.py" },
  sublist3r: { kind: "git", repo: "https://github.com/aboul3la/Sublist3r", launcher: "sublist3r.py", requirements: "requirements.txt", label: "sublist3r.py" },
  seclists: { kind: "git", repo: "https://github.com/danielmiessler/SecLists", label: "SecLists" },

  cyberchef: {
    kind: "asset",
    archive: { github: "gchq/CyberChef", asset: /^CyberChef_v[\d.]+\.zip$/i, file: "cyberchef.zip" },
    find: /^CyberChef_v[\d.]+\.html$/i,
    provides: "CyberChef",
  },
  wappalyzer: {
    kind: "asset",
    archive: { url: "https://codeload.github.com/enthec/webappanalyzer/tar.gz/refs/heads/main", file: "webappanalyzer.tar.gz" },
    merge: "wappalyzer",
    provides: "Wappalyzer",
  },
  "js-miner": { kind: "builtin", provides: "JS Miner" },
  "selector-test": { kind: "builtin", provides: "Selector Test" },
};



async function refreshPath() {
  if (process.platform !== "win32") return false;

  const read = async (root, key) => {
    const out = await readCommand("reg", ["query", root, "/v", key]);
    if (!out) return "";

    const line = out.split(/\r?\n/).find((row) => /\s(REG_EXPAND_SZ|REG_SZ)\s/.test(row));
    if (!line) return "";
    return line.split(/\s(?:REG_EXPAND_SZ|REG_SZ)\s+/)[1]?.trim() ?? "";
  };

  const [machine, user] = await Promise.all([
    read("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "Path"),
    read("HKCU\\Environment", "Path"),
  ]);
  if (!machine && !user) return false;



  const expand = (value) =>
    value.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);

  const seen = new Set();
  const merged = [];
  for (const part of `${expand(machine)};${expand(user)};${process.env.PATH ?? ""}`.split(";")) {
    const dir = part.trim().replace(/[\\/]+$/, "");
    if (!dir) continue;
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(dir);
  }
  process.env.PATH = merged.join(";");
  return true;
}



function commandExists(command) {
  return new Promise((resolve) => {
    let child;
    try {
      child = node_child_process.spawn(
        process.platform === "win32" ? "where" : "which",
        [command],
        { shell: false, windowsHide: true }
      );
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
    }, PROBE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      if (out.length < 4096) out += chunk;
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (code !== 0) return finish(null);
      const first = out.split(/\r?\n/).find((line) => line.trim().length > 0);
      finish(first ? first.trim() : command);
    });
  });
}


function runManager(command, args, { timeout = PROVISION_TIMEOUT_MS, track = null } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = node_child_process.spawn(command, args, {
        shell: process.platform === "win32",
        windowsHide: true,
        env: managerEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ ok: false, detail: String(error.message || error) });
      return;
    }


    child.stdin?.end();

    track?.children.add(child);

    let stderr = "";
    let stdout = "";
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      track?.children.delete(child);
      resolve(track?.aborted ? { ok: false, cancelled: true, detail: "" } : value);
    };
    const timer = setTimeout(() => {
      killProcessTree(child);
      finish({ ok: false, detail: "The installer took too long and was stopped." });
    }, timeout);

    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 16384) stderr += chunk;
    });
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < 16384) stdout += chunk;
    });
    child.on("error", (error) => finish({ ok: false, detail: String(error.message || error) }));
    child.on("close", (code) => {
      if (code === 0) return finish({ ok: true });


      const said = `${stderr}\n${stdout}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      finish({
        ok: false,
        detail: said[said.length - 1] || `The installer exited with code ${code}.`,
      });
    });
  });
}


function readCommand(command, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = node_child_process.spawn(command, args, {
        shell: process.platform === "win32",
        windowsHide: true,
        env: managerEnv(),
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      resolve(null);
      return;
    }
    child.stdin?.end();
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
    }, PROBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      if (out.length < 4096) out += chunk;
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 && out.trim() ? out.trim() : null));
  });
}



async function extraBinDirs(spec) {
  const dirs = [];
  const home = electron.app.getPath("home");
  if (spec.goBin) {
    const gopath = await readCommand("go", ["env", "GOPATH"]);
    if (gopath) dirs.push(node_path.join(gopath, "bin"));
    const gobin = await readCommand("go", ["env", "GOBIN"]);
    if (gobin) dirs.push(gobin);
  }
  if (spec.npmBin) {
    const prefix = await readCommand("npm", ["prefix", "-g"]);
    if (prefix) dirs.push(prefix, node_path.join(prefix, "bin"));
  }
  if (spec.dotnetBin) dirs.push(node_path.join(home, ".dotnet", "tools"));
  if (spec.csBin) {
    dirs.push(node_path.join(home, "AppData", "Local", "Coursier", "data", "bin"));
    dirs.push(node_path.join(home, ".local", "share", "coursier", "bin"));
  }
  if (spec.hint) {
    const where = await readCommand(process.platform === "win32" ? "where" : "which", ["python"]);
    const first = where ? where.split(/\r?\n/)[0].trim() : "";
    if (first) for (const leaf of spec.hint) dirs.push(node_path.join(node_path.dirname(first), leaf));
  }
  return dirs.filter(Boolean);
}


async function findIn(dirs, command) {
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = node_path.join(dir, command + suffix);
      try {
        await promises.access(candidate);
        return candidate;
      } catch {

      }
    }
  }
  return null;
}


async function findUnder(root, names, depth = 5) {
  let entries;
  try {
    entries = await promises.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const dirs = [];
  for (const entry of entries) {
    if (entry.isDirectory()) dirs.push(node_path.join(root, entry.name));
    else if (wanted.has(entry.name.toLowerCase())) return node_path.join(root, entry.name);
  }
  if (depth <= 0) return null;
  for (const dir of dirs) {
    const found = await findUnder(dir, names, depth - 1);
    if (found) return found;
  }
  return null;
}



function download(url, target, redirects = 6, track = null) {
  return new Promise((resolve) => {
    if (redirects < 0) {
      resolve({ ok: false, detail: "Too many redirects." });
      return;
    }
    let request;
    try {
      request = node_https.get(
        url,
        { headers: { "user-agent": "Wide", accept: "*/*" }, timeout: DOWNLOAD_TIMEOUT_MS },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume();
            const next = new URL(response.headers.location, url).toString();

            if (!next.startsWith("https://")) {
              resolve({ ok: false, detail: "The download was redirected off https." });
              return;
            }
            resolve(download(next, target, redirects - 1, track));
            return;
          }
          if (status !== 200) {
            response.resume();
            resolve({ ok: false, detail: `The download answered ${status}.` });
            return;
          }

          let size = 0;
          let failed = null;
          const file = node_fs.createWriteStream(target);
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_ARCHIVE_BYTES && !failed) {
              failed = "The download was larger than expected and was stopped.";
              response.destroy();
              file.destroy();
            }
          });
          response.pipe(file);
          file.on("error", (error) => resolve({ ok: false, detail: String(error.message) }));
          file.on("finish", () =>
            failed ? resolve({ ok: false, detail: failed }) : resolve({ ok: true, size })
          );
        }
      );
    } catch (error) {
      resolve({ ok: false, detail: String(error.message || error) });
      return;
    }
    track?.requests.add(request);
    request.on("close", () => track?.requests.delete(request));
    request.on("timeout", () => {
      request.destroy();
      resolve({ ok: false, detail: "The download timed out." });
    });

    request.on("error", (error) =>
      resolve(
        track?.aborted
          ? { ok: false, cancelled: true, detail: "" }
          : { ok: false, detail: String(error.message) }
      )
    );
  });
}


function latestAsset(repo, pattern, track = null) {
  return new Promise((resolve) => {
    const request = node_https.get(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers: { "user-agent": "Wide", accept: "application/vnd.github+json" },
        timeout: PROBE_TIMEOUT_MS * 4,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          resolve(null);
          return;
        }
        let body = "";
        response.on("data", (chunk) => {
          if (body.length < 1024 * 1024) body += chunk;
        });
        response.on("end", () => {
          try {
            const release = JSON.parse(body);
            const asset = (release.assets ?? []).find((item) => pattern.test(item.name));
            resolve(asset ? asset.browser_download_url : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    track?.requests.add(request);
    request.on("close", () => track?.requests.delete(request));
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.on("error", () => resolve(null));
  });
}



async function installArchive(id, spec, track = null) {
  const archive = spec.archive;
  const url = archive.github
    ? await latestAsset(archive.github, archive.asset, track)
    : archive.url;
  if (!url) return { ok: false, detail: "The latest release could not be found." };

  const dir = SERVER_DIR(id);
  const temp = node_path.join(electron.app.getPath("temp"), `wide-${id}-${process.pid}`);
  try {
    await promises.rm(dir, { recursive: true, force: true });
    await promises.mkdir(dir, { recursive: true });
    await promises.mkdir(temp, { recursive: true });
  } catch (error) {
    return { ok: false, detail: String(error.message) };
  }

  const file = node_path.join(temp, archive.file);
  const fetched = await download(url, file, 6, track);
  if (!fetched.ok) return fetched;

  const unpacked = await runManager("tar", ["-xf", file, "-C", dir], {
    timeout: DOWNLOAD_TIMEOUT_MS,
    track,
  });
  await promises.rm(temp, { recursive: true, force: true }).catch(() => {});
  if (!unpacked.ok) {
    return { ok: false, detail: unpacked.detail || "The archive could not be unpacked." };
  }

  const binary = await findUnder(dir, archive.binaries);
  if (!binary) return { ok: false, detail: "The archive unpacked but the launcher was not in it." };
  return { ok: true, path: binary };
}


async function findFileMatching(root, pattern, depth = 5) {
  let entries;
  try {
    entries = await promises.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = [];
  for (const entry of entries) {
    if (entry.isDirectory()) dirs.push(node_path.join(root, entry.name));
    else if (pattern.test(entry.name)) return node_path.join(root, entry.name);
  }
  if (depth <= 0) return null;
  for (const dir of dirs) {
    const found = await findFileMatching(dir, pattern, depth - 1);
    if (found) return found;
  }
  return null;
}

async function collectJsonUnder(root, folderName, depth = 6) {
  const files = [];
  const walk = async (dir, left, inside) => {
    let entries;
    try {
      entries = await promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = node_path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (left > 0) await walk(full, left - 1, inside || entry.name === folderName);
      } else if (inside && entry.name.toLowerCase().endsWith(".json")) {
        files.push(full);
      }
    }
  };
  await walk(root, depth, false);
  return files.sort();
}

async function mergeWappalyzer(dir) {
  const techFiles = await collectJsonUnder(dir, "technologies");
  if (!techFiles.length) return { ok: false, detail: "The ruleset unpacked but no technology files were found." };
  const technologies = {};
  for (const file of techFiles) {
    try {
      Object.assign(technologies, JSON.parse(await promises.readFile(file, "utf8")));
    } catch {
      void 0;
    }
  }
  let categories = {};
  const categoriesFile = await findFileMatching(dir, /^categories\.json$/i);
  if (categoriesFile) {
    try {
      categories = JSON.parse(await promises.readFile(categoriesFile, "utf8"));
    } catch {
      void 0;
    }
  }
  if (!Object.keys(technologies).length) {
    return { ok: false, detail: "The ruleset unpacked but no technologies could be read." };
  }
  const out = node_path.join(dir, "technologies.json");
  try {
    await promises.writeFile(out, JSON.stringify({ technologies, categories }), "utf8");
  } catch (error) {
    return { ok: false, detail: String(error.message) };
  }
  return { ok: true, path: out };
}

async function webAssetPath(id, spec) {
  const dir = SERVER_DIR(id);
  if (spec.merge === "wappalyzer") {
    const merged = node_path.join(dir, "technologies.json");
    try {
      await promises.access(merged);
      return merged;
    } catch {
      return null;
    }
  }
  if (spec.find) return findFileMatching(dir, spec.find);
  return null;
}

async function installWebAsset(id, spec, track = null) {
  const archive = spec.archive;
  const url = archive.github ? await latestAsset(archive.github, archive.asset, track) : archive.url;
  if (!url) return { ok: false, detail: "The latest release could not be found." };

  const dir = SERVER_DIR(id);
  const temp = node_path.join(electron.app.getPath("temp"), `wide-${id}-${process.pid}`);
  try {
    await promises.rm(dir, { recursive: true, force: true });
    await promises.mkdir(dir, { recursive: true });
    await promises.mkdir(temp, { recursive: true });
  } catch (error) {
    return { ok: false, detail: String(error.message) };
  }

  const file = node_path.join(temp, archive.file);
  const fetched = await download(url, file, 6, track);
  if (!fetched.ok) {
    await promises.rm(temp, { recursive: true, force: true }).catch(() => {});
    return fetched;
  }

  const unpacked = await runManager("tar", ["-xf", file, "-C", dir], {
    timeout: DOWNLOAD_TIMEOUT_MS,
    track,
  });
  await promises.rm(temp, { recursive: true, force: true }).catch(() => {});
  if (!unpacked.ok) {
    return { ok: false, detail: unpacked.detail || "The download could not be unpacked." };
  }

  if (spec.merge === "wappalyzer") return mergeWappalyzer(dir);
  if (spec.find) {
    const found = await findFileMatching(dir, spec.find);
    if (!found) return { ok: false, detail: "The download unpacked but the expected file was not in it." };
    return { ok: true, path: found };
  }
  return { ok: true, path: dir };
}


async function bootstrapManager(manager, track = null) {
  const bootstrap = MANAGER_BOOTSTRAP[manager];
  if (!bootstrap) return { ok: false, detail: "" };
  if (!(await commandExists("winget"))) {
    return { ok: false, detail: "winget is not on this machine." };
  }
  const run = await runManager("winget", [
    "install",
    "--id",
    bootstrap.package,
    "--exact",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--disable-interactivity",
  ], { track });
  if (!run.ok) return run;


  await refreshPath();
  const at = await commandExists(manager);
  return at
    ? { ok: true, path: at }
    : { ok: false, toolchain: bootstrap.label, detail: run.detail ?? "" };
}

function registerPrepareHandlers() {




  electron.ipcMain.handle("extensions:prepare", async (_event, id) => {
    const track = beginPrepare(id);
    try {
      return await prepareServer(id, track);
    } finally {
      endPrepare(id, track);
    }
  });



  electron.ipcMain.handle("extensions:cancelPrepare", async (_event, id) => ({
    ok: true,
    cancelled: cancelPrepare(id),
  }));

  electron.ipcMain.handle("extensions:servers", async () => ({
    ok: true,
    servers: await readServers(),
  }));
}





async function gitClone(id, spec, track) {
  const dir = SERVER_DIR(id);
  await promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  await promises.mkdir(node_path.dirname(dir), { recursive: true });
  return runManager("git", ["clone", "--depth", "1", spec.repo, dir], {
    track,
    timeout: DOWNLOAD_TIMEOUT_MS,
  });
}



async function prepareTool(id, spec, track) {
  const stopped = () => track.aborted;
  const cancelled = { ok: true, id, cancelled: true };
  await refreshPath();

  const remember = async (state, path, extra) => {
    const server = { command: spec.provides || spec.label || id, path: path || "", state, ...extra };
    await rememberServer(id, server);
    return { ok: true, id, server };
  };

  if (spec.kind === "builtin") {
    return remember("installed", "");
  }

  if (spec.kind === "asset") {
    const existing = await webAssetPath(id, spec);
    if (existing) return remember("present", existing);
    const done = await installWebAsset(id, spec, track);
    if (stopped() || done.cancelled) return cancelled;
    if (!done.ok) return remember("failed", "", { detail: done.detail ?? "" });
    return remember("installed", done.path);
  }

  if (spec.kind === "git") {
    const dir = SERVER_DIR(id);
    const launcher = spec.launcher ? node_path.join(dir, spec.launcher) : dir;

    try {
      await promises.access(launcher);
      return remember("present", launcher);
    } catch {

    }
    if (!(await commandExists("git"))) {
      return remember("no-manager", "", {
        manager: "git",
        detail: "Git is needed to fetch this and is not on this machine.",
      });
    }
    const cloned = await gitClone(id, spec, track);
    if (stopped() || cloned.cancelled) return cancelled;
    if (!cloned.ok) return remember("failed", "", { detail: cloned.detail ?? "" });



    if (spec.requirements) {
      if (!(await commandExists("python"))) {
        const boot = await bootstrapManager("python", track);
        if (stopped()) return cancelled;
        if (!boot.ok) {
          return remember("no-manager", launcher, {
            manager: "python",
            detail: boot.detail ?? "",
          });
        }
      }
      const req = node_path.join(dir, spec.requirements);
      await runManager("python", ["-m", "pip", "install", "-r", req], { track });
      if (stopped()) return cancelled;
    }
    return remember("installed", launcher);
  }


  const here = (await commandExists(spec.provides)) || (await findIn(await extraBinDirs(spec), spec.provides));
  if (here) return remember("present", here);

  if (!(await commandExists(spec.manager))) {
    const boot = await bootstrapManager(spec.manager, track);
    if (stopped()) return cancelled;
    if (!boot.ok) {
      return remember("no-manager", "", { manager: boot.toolchain ?? spec.manager, detail: boot.detail ?? "" });
    }
  }
  const run = await runManager(spec.manager, spec.args, { track });
  if (stopped() || run.cancelled) return cancelled;
  if (!run.ok) return remember("failed", "", { manager: spec.manager, detail: run.detail ?? "" });

  const at = (await commandExists(spec.provides)) || (await findIn(await extraBinDirs(spec), spec.provides));
  if (!at) {
    return remember("failed", "", {
      manager: spec.manager,
      detail: "The installer finished but the command could not be found afterwards.",
    });
  }
  return remember("installed", at);
}

async function prepareServer(id, track) {
  const stopped = () => track.aborted;
  const cancelled = { ok: true, id, cancelled: true };


    if (TOOL_PROVISIONERS[id]) return prepareTool(id, TOOL_PROVISIONERS[id], track);
    const candidates = SERVERS_BY_EXTENSION[id];
    if (!candidates) {
      const server = { command: "", path: "", state: "none" };
      await rememberServer(id, server);
      return { ok: true, id, server };
    }
    const spec = PROVISIONERS[id];


    await refreshPath();


    for (const [command] of candidates) {
      const at = await commandExists(command);
      if (at) {
        const server = { command, path: at, state: "present" };
        await rememberServer(id, server);
        return { ok: true, id, server };
      }
    }

    if (spec?.archive) {
      const already = await findUnder(SERVER_DIR(id), spec.archive.binaries);
      if (already) {
        const server = { command: spec.provides, path: already, state: "present" };
        await rememberServer(id, server);
        return { ok: true, id, server };
      }
    }

    const fail = async (state, extra) => {
      const server = { command: spec?.provides ?? candidates[0][0], path: "", state, ...extra };
      await rememberServer(id, server);
      return { ok: true, id, server };
    };

    if (!spec) {


      return fail("manual", { detail: "There is no Windows build of this server to install." });
    }


    if (spec.needs && !(await commandExists(spec.needs))) {
      const bootstrap = await bootstrapManager(spec.needs, track);
      if (stopped()) return cancelled;
      if (!bootstrap.ok) {
        return fail("no-manager", {
          manager: bootstrap.toolchain ?? spec.needs,
          detail: bootstrap.detail ?? "",
        });
      }
    }

    if (stopped()) return cancelled;


    if (spec.archive) {
      const result = await installArchive(id, spec, track);
      if (stopped() || result.cancelled) return cancelled;
      if (!result.ok) return fail("failed", { detail: result.detail ?? "" });
      const server = { command: spec.provides, path: result.path, state: "installed" };
      await rememberServer(id, server);
      return { ok: true, id, server };
    }

    if (!(await commandExists(spec.manager))) {
      const bootstrap = await bootstrapManager(spec.manager, track);
      if (stopped()) return cancelled;
      if (!bootstrap.ok) {
        return fail("no-manager", {
          manager: bootstrap.toolchain ?? spec.manager,
          detail: bootstrap.detail ?? "",
        });
      }
    }

    const run = await runManager(spec.manager, spec.args, { track });
    if (stopped() || run.cancelled) return cancelled;
    if (!run.ok) return fail("failed", { manager: spec.manager, detail: run.detail ?? "" });

    let at = await commandExists(spec.provides);
    if (!at) at = await findIn(await extraBinDirs(spec), spec.provides);
    if (!at) {
      return fail("failed", {
        manager: spec.manager,
        detail: "The installer finished but the command could not be found afterwards.",
      });
    }

    const server = { command: spec.provides, path: at, state: "installed" };
    await rememberServer(id, server);
    return { ok: true, id, server };
}
