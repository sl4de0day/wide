


let webtoolsServer = null;
let webtoolsPort = 0;
let webtoolsStarting = null;

function webtoolsRoot() {
  return node_path.join(electron.app.getPath("userData"), "servers");
}

function cyberchefThemeSeed() {
  const palettes = {
    "default": { bg: "#3b4252", panel: "#2e3440", raised: "#434c5e", fg: "#d8dee9", bright: "#eceff4", dim: "#9aa6bd", line: "#434c5e", accent: "#88c0d0", string: "#a3be8c", error: "#bf616a" },
    "tokyo-night": { bg: "#1a1b26", panel: "#16161e", raised: "#292e42", fg: "#c0caf5", bright: "#ffffff", dim: "#787c99", line: "#292e42", accent: "#7aa2f7", string: "#9ece6a", error: "#f7768e" },
    "one-dark-pro": { bg: "#282c34", panel: "#21252b", raised: "#2c313a", fg: "#abb2bf", bright: "#ffffff", dim: "#828997", line: "#2c313a", accent: "#61afef", string: "#98c379", error: "#e06c75" },
    "ariake-dark": { bg: "#252a34", panel: "#2e323e", raised: "#363a47", fg: "#b9bed5", bright: "#fafafa", dim: "#8b90a0", line: "#363a47", accent: "#85b1df", string: "#59ccfa", error: "#ff6b6b" },
  };
  const script =
    "(function(){try{" +
    "var P=" + JSON.stringify(palettes) + ";" +
    "var id=new URLSearchParams(location.search).get('wct')||'default';" +
    "var p=P[id]||P['default'];" +
    "try{var o=JSON.parse(localStorage.getItem('options')||'{}')||{};o.theme='classic';localStorage.setItem('options',JSON.stringify(o));}catch(e){}" +
    "var v=':root,html,html.classic,html.dark,html.geocities{'" +
    "+'--primary-background-colour:'+p.bg+';--secondary-background-colour:'+p.panel+';'" +
    "+'--primary-font-colour:'+p.fg+';--secondary-font-colour:'+p.dim+';'" +
    "+'--title-background-colour:'+p.panel+';--title-colour:'+p.bright+';'" +
    "+'--banner-bg-colour:'+p.panel+';--banner-font-colour:'+p.fg+';'" +
    "+'--subbar-background-colour:'+p.panel+';--subbar-font-colour:'+p.dim+';'" +
    "+'--primary-border-colour:'+p.line+';--secondary-border-colour:'+p.line+';'" +
    "+'--operation-bg:'+p.raised+';--operation-font-colour:'+p.fg+';--operation-border-colour:'+p.line+';'" +
    "+'--rec-list-bg-colour:'+p.panel+';--rec-list-operation-bg:'+p.raised+';--rec-list-operation-font-colour:'+p.fg+';'" +
    "+'--input-bg-colour:'+p.bg+';--output-bg-colour:'+p.bg+';--input-font-colour:'+p.fg+';'" +
    "+'--arg-background:'+p.bg+';--arg-font-colour:'+p.fg+';--arg-border-colour:'+p.line+';'" +
    "+'--scrollbar-track:'+p.panel+';--scrollbar-foreground:'+p.raised+';'" +
    "+'--link-colour:'+p.accent+';--fixed-width-font-colour:'+p.accent+';--breakpoint-bg-colour:'+p.error+';'" +
    "+'}';" +
    "v+='body,#content-wrapper,#workspace-wrapper,.page{background:'+p.bg+'!important;color:'+p.fg+'!important;}';" +
    "v+='#operations,#rec-list,.op-list,#recipe-list,.category-title,.operationList{background:'+p.panel+'!important;color:'+p.fg+'!important;}';" +
    "v+='.operation,.op-title,.recipe-cont .operation{background:'+p.raised+'!important;color:'+p.fg+'!important;border-color:'+p.line+'!important;}';" +
    "v+='#input-text,#output-text,.cm-editor,.cm-scroller,.cm-gutters,#output-html{background:'+p.bg+'!important;color:'+p.fg+'!important;}';" +
    "v+='#banner,#notice-wrapper,.title,#controls,.io-info,#recipe{background:'+p.panel+'!important;color:'+p.fg+'!important;border-color:'+p.line+'!important;}';" +
    "v+='input,select,textarea,.form-control{background:'+p.bg+'!important;color:'+p.fg+'!important;border-color:'+p.line+'!important;}';" +
    "v+='a,.btn-link{color:'+p.accent+'!important;}';" +
    "var s=document.createElement('style');s.setAttribute('data-wide-cc','1');s.textContent=v;" +
    "(document.head||document.documentElement).appendChild(s);" +
    "}catch(e){}})();";
  return '<script data-wide-cc-theme="1">' + script + "</script>";
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
      if (node_path.extname(file).toLowerCase() === ".html" && /cyberchef/i.test(file)) {
        const seed = cyberchefThemeSeed();
        const html = data.toString("utf8");
        if (/<head(\s[^>]*)?>/i.test(html)) data = Buffer.from(html.replace(/<head(\s[^>]*)?>/i, (m) => m + seed), "utf8");
      }
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
