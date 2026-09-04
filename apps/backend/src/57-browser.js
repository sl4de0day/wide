

const BROWSER_SCHEME = /^https?:\/\//i;

let browserRemotePort = 0;

function browserDevtoolsUrl(port, activeUrl) {
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
                (activeUrl && pages.find((t) => t.url === activeUrl)) || pages[0];
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

  debugFreePort().then((port) => {
    browserRemotePort = port;
    electron.hostRequest("browser:setRemotePort", { port });
  });

  electron.ipcMain.handle("browser:devtools", async (_event, open, activeUrl) => {
    if (!open) {
      electron.hostRequest("browser:devtools", { url: "" });
      return { ok: true };
    }
    if (!browserRemotePort) return { ok: false, error: "The browser has no debug port yet." };

    const want = typeof activeUrl === "string" ? activeUrl : "";
    const url = await browserDevtoolsUrl(browserRemotePort, want);
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

    electron.hostRequest("browser:navigate", { url: target, tabId: tab });
    return { ok: true, url: target };
  });

  electron.ipcMain.handle("browser:cdp", async (_event, tabId, method, params) => {
    const gate = await requireInstalled("browser");
    if (gate) return gate;
    try {
      const result = await electron.hostRequest("browser:cdp", {
        tabId: typeof tabId === "string" ? tabId : "",
        method: typeof method === "string" ? method : "",
        params: params && typeof params === "object" ? params : {},
      });
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });
}
