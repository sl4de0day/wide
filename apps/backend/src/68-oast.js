

let oastChild = null;
let oastDomain = "";
let oastServer = "";

let builtinOastServer = null;
let builtinOastDomain = "";

const OAST_DOMAIN_RE = /^[a-z0-9]+\.[a-z0-9.\-]+$/i;

function stopBuiltinOast() {
  if (builtinOastServer) {
    try {
      builtinOastServer.close();
    } catch {
      void 0;
    }
  }
  builtinOastServer = null;
  builtinOastDomain = "";
}

function startBuiltinOast() {
  return new Promise((resolve) => {
    if (builtinOastServer) {
      resolve({ ok: true, running: true, domain: builtinOastDomain, server: "built-in" });
      return;
    }
    const server = node_http.createServer((req, res) => {
      const at = Date.now();
      const url = String(req.url || "/");
      const token = (url.split("/").filter(Boolean)[0] || "").slice(0, 128);
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 65536) chunks.push(chunk);
      });
      req.on("end", () => {
        broadcast("oast:interaction", {
          protocol: "http",
          "unique-id": token,
          "full-id": token,
          "raw-request": `${req.method} ${url} HTTP/1.1
Host: ${req.headers.host || ""}
`,
          "remote-address": req.socket.remoteAddress || "",
          timestamp: new Date(at).toISOString(),
          body: Buffer.concat(chunks).toString("utf8").slice(0, 4096),
        });
        try {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ok");
        } catch {
          void 0;
        }
      });
    });
    server.on("error", (error) => {
      builtinOastServer = null;
      resolve({ ok: false, error: String((error && error.message) || error) });
    });
    server.listen(0, "127.0.0.1", () => {
      builtinOastServer = server;
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      builtinOastDomain = `127.0.0.1:${port}`;
      broadcast("oast:status", { running: true, domain: builtinOastDomain, server: "built-in" });
      resolve({ ok: true, running: true, domain: builtinOastDomain, server: "built-in" });
    });
  });
}

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

  electron.ipcMain.handle("oast:startBuiltin", async () => {
    stopOast();
    return startBuiltinOast();
  });

  electron.ipcMain.handle("oast:start", async (_event, server, token) => {
    const host = typeof server === "string" ? server.trim() : "";
    if (!host) return { ok: false, error: "Enter your interactsh server first." };
    stopBuiltinOast();
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
      if (buffer.length > 4 * 1024 * 1024) {
        buffer = "";
        return;
      }
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
    stopBuiltinOast();
    broadcast("oast:status", { running: false, domain: "", server: oastServer });
    return { ok: true };
  });

  electron.ipcMain.handle("oast:status", async () => {
    await refreshPath();
    const bin = await commandExists("interactsh-client");
    if (builtinOastServer) {
      return { ok: true, installed: Boolean(bin), running: true, domain: builtinOastDomain, server: "built-in" };
    }
    return { ok: true, installed: Boolean(bin), running: Boolean(oastChild), domain: oastDomain, server: oastServer };
  });
}
