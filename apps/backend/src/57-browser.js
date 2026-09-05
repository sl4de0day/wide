

const BROWSER_SCHEME = /^https?:\/\//i;

let browserRemotePort = 0;
let browserLastTab = "";

function browserOrigin(url) {
  const match = /^https?:\/\/[^/?#]+/i.exec(typeof url === "string" ? url : "");
  return match ? match[0].toLowerCase() : "";
}

function browserTargetId(tabId) {
  if (!tabId) return Promise.resolve("");
  const asked = electron
    .hostRequest("browser:cdp", { tabId, method: "Page.getFrameTree", params: {} })
    .then((result) => {
      const frame = result && result.frameTree && result.frameTree.frame;
      return frame && typeof frame.id === "string" ? frame.id : "";
    })
    .catch(() => "");
  return Promise.race([asked, new Promise((resolve) => setTimeout(() => resolve(""), 2000))]);
}

function browserPickPage(pages, activeUrl, targetId, trusted) {
  const byId = targetId ? pages.find((t) => t.id === targetId) || null : null;
  if (trusted) return byId;
  const exact = activeUrl ? pages.filter((t) => t.url === activeUrl) : [];
  if (exact.length === 1) return exact[0];
  if (byId) return byId;
  if (exact.length > 1) return exact[0];
  const origin = browserOrigin(activeUrl);
  const sameOrigin = origin ? pages.filter((t) => browserOrigin(t.url) === origin) : [];
  if (sameOrigin.length === 1) return sameOrigin[0];
  return pages[0] || null;
}

function browserDevtoolsUrl(port, activeUrl, targetId, trusted) {
  return new Promise((resolve) => {
    let tries = 0;
    const attempt = () => {
      tries += 1;
      const request = node_http.get(
        { host: "127.0.0.1", port, path: "/json/list", timeout: 2000 },
        (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => {
            let url = null;
            try {
              const list = JSON.parse(body);

              const pages = list.filter(
                (t) =>
                  t.type === "page" &&
                  t.id &&
                  t.url &&
                  !/\/devtools\//.test(t.url),
              );
              const page =
                browserPickPage(pages, activeUrl, targetId, trusted) ||
                (tries >= 6 ? browserPickPage(pages, activeUrl, targetId, false) : null);
              if (page) {

                url = `http://127.0.0.1:${port}/devtools/inspector.html?ws=127.0.0.1:${port}/devtools/page/${page.id}`;
              }
            } catch {

            }
            if (url) resolve(url);
            else if (tries < 12) setTimeout(attempt, 300);
            else resolve(null);
          });
        },
      );
      const retryOrGiveUp = () => {
        if (tries < 12) setTimeout(attempt, 300);
        else resolve(null);
      };
      request.on("error", retryOrGiveUp);
      request.on("timeout", () => {
        request.destroy();
        retryOrGiveUp();
      });
    };
    attempt();
  });
}

function registerBrowserHandlers() {

  debugFreePort().then(async (port) => {
    browserRemotePort = port;
    try {
      const reply = await electron.hostRequest("browser:setRemotePort", { port });
      const actual = reply && Number(reply.port);
      if (Number.isFinite(actual) && actual > 0) browserRemotePort = actual;
    } catch {
      void 0;
    }
  });

  electron.ipcMain.handle("browser:devtools", async (_event, open, activeUrl, tabId) => {
    if (!open) {
      electron.hostRequest("browser:devtools", { url: "" });
      return { ok: true };
    }
    if (!browserRemotePort) return { ok: false, error: "The browser has no debug port yet." };

    const want = typeof activeUrl === "string" ? activeUrl : "";
    const asked = typeof tabId === "string" ? tabId.trim() : "";
    const targetId = await browserTargetId(asked || browserLastTab);
    const url = await browserDevtoolsUrl(browserRemotePort, want, targetId, Boolean(asked && targetId));
    if (!url) return { ok: false, error: `Could not reach the browser's DevTools on port ${browserRemotePort}.` };
    electron.hostRequest("browser:devtools", { url });
    return { ok: true, url };
  });

  electron.ipcMain.handle("browser:navigate", async (_event, url, tabId) => {
    const gate = await requireInstalled("browser");
    if (gate) return gate;

    const target = typeof url === "string" ? url.trim() : "";
    const tab = typeof tabId === "string" ? tabId : "";

    if (!BROWSER_SCHEME.test(target)) {
      return { ok: false, error: "Only http and https can be opened in the browser." };
    }

    if (tab) browserLastTab = tab;
    electron.hostRequest("browser:navigate", { url: target, tabId: tab });
    return { ok: true, url: target };
  });

  electron.ipcMain.handle("browser:cdp", async (_event, tabId, method, params) => {
    const gate = await requireInstalled("browser");
    if (gate) return gate;
    const tab = typeof tabId === "string" ? tabId : "";
    try {
      const result = await electron.hostRequest("browser:cdp", {
        tabId: tab,
        method: typeof method === "string" ? method : "",
        params: params && typeof params === "object" ? params : {},
      });
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });
}
