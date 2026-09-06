


let webtoolsServer = null;
let webtoolsPort = 0;
let webtoolsStarting = null;

function webtoolsRoot() {
  return node_path.join(electron.app.getPath("userData"), "servers");
}

function startWebtoolsServer() {
  if (webtoolsPort) return Promise.resolve(webtoolsPort);
  if (webtoolsStarting) return webtoolsStarting;
  webtoolsStarting = new Promise((resolve) => {
    const root = webtoolsRoot();
    const server = node_http.createServer(async (request, response) => {
      const rawPath = (request.url || "/").split("?")[0];
      let rel = rawPath;
      try {
        rel = decodeURIComponent(rawPath);
      } catch {
        void 0;
      }
      rel = rel.replace(/^\/+/, "");
      const target = resolveUnder(root, rel);
      if (!target) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("403 Forbidden");
        return;
      }
      let file = target;
      try {
        const stat = await promises.stat(target);
        if (stat.isDirectory()) file = node_path.join(target, "index.html");
      } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("404 Not Found");
        return;
      }
      let data;
      try {
        data = await promises.readFile(file);
      } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("404 Not Found");
        return;
      }
      const mime = MIME[node_path.extname(file).toLowerCase()] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
      response.end(data);
    });
    server.on("error", () => {
      webtoolsStarting = null;
      resolve(0);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      webtoolsServer = server;
      webtoolsPort = address && typeof address === "object" ? address.port : 0;
      resolve(webtoolsPort);
    });
  });
  return webtoolsStarting;
}

function registerWebtoolsHandlers() {
  electron.ipcMain.handle("webtools:cyberchef", async () => {
    const gate = await requireInstalled("cyberchef");
    if (gate) return gate;
    const servers = await readServers();
    const record = servers && servers.cyberchef;
    let htmlPath = record && record.path ? record.path : null;
    if (!htmlPath) htmlPath = await webAssetPath("cyberchef", { find: /^CyberChef.*\.html$/i });
    if (!htmlPath) return { ok: false, error: "CyberChef has not been unpacked yet." };
    const port = await startWebtoolsServer();
    if (!port) return { ok: false, error: "The local server could not start." };
    const root = webtoolsRoot();
    const rel = node_path.relative(root, htmlPath).split(node_path.sep).join("/");
    return { ok: true, url: `http://127.0.0.1:${port}/${rel}` };
  });

  electron.ipcMain.handle("webtools:wappalyzer", async () => {
    const gate = await requireInstalled("wappalyzer");
    if (gate) return gate;
    const merged = node_path.join(SERVER_DIR("wappalyzer"), "technologies.json");
    try {
      const parsed = JSON.parse(await promises.readFile(merged, "utf8"));
      return { ok: true, technologies: parsed.technologies || {}, categories: parsed.categories || {} };
    } catch {
      return { ok: false, error: "The Wappalyzer ruleset is not ready yet." };
    }
  });
}
