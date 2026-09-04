

let oastChild = null;
let oastDomain = "";
let oastServer = "";

const OAST_DOMAIN_RE = /^[a-z0-9]+\.[a-z0-9.\-]+$/i;

function stopOast() {
  if (oastChild) {
    try {
      killProcessTree(oastChild);
    } catch {

    }
  }
  oastChild = null;
  oastDomain = "";
}

function registerOastHandlers() {

  electron.ipcMain.handle("oast:start", async (_event, server, token) => {
    const host = typeof server === "string" ? server.trim() : "";
    if (!host) return { ok: false, error: "Enter your interactsh server first." };
    if (oastChild) return { ok: true, running: true, domain: oastDomain, server: oastServer };

    await refreshPath();
    const bin = await commandExists("interactsh-client");
    if (!bin) {
      return { ok: false, error: "interactsh-client is not installed. Install it from Extensions." };
    }

    const args = ["-json", "-server", host];
    if (typeof token === "string" && token.trim()) args.push("-token", token.trim());

    let child;
    try {
      child = node_child_process.spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
    oastChild = child;
    oastServer = host;
    oastDomain = "";

    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        if (line.startsWith("{")) {
          try {
            broadcast("oast:interaction", JSON.parse(line));
          } catch {

          }
        } else if (!oastDomain && OAST_DOMAIN_RE.test(line) && line.includes(".")) {
          oastDomain = line;
          broadcast("oast:status", { running: true, domain: oastDomain, server: oastServer });
        }
      }
    };
    child.stdout.on("data", onData);

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (oastDomain) return;
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line && OAST_DOMAIN_RE.test(line) && line.includes(".")) {
          oastDomain = line;
          broadcast("oast:status", { running: true, domain: oastDomain, server: oastServer });
          break;
        }
      }
    });
    child.on("exit", () => {
      if (oastChild === child) {
        oastChild = null;
        oastDomain = "";
        broadcast("oast:status", { running: false, domain: "", server: oastServer });
      }
    });

    return { ok: true, running: true, domain: oastDomain, server: oastServer };
  });

  electron.ipcMain.handle("oast:stop", async () => {
    stopOast();
    broadcast("oast:status", { running: false, domain: "", server: oastServer });
    return { ok: true };
  });

  electron.ipcMain.handle("oast:status", async () => {
    await refreshPath();
    const bin = await commandExists("interactsh-client");
    return { ok: true, installed: Boolean(bin), running: Boolean(oastChild), domain: oastDomain, server: oastServer };
  });
}
