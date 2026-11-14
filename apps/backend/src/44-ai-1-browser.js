const aiBrowserSession = {
  open: false,
  active: false,
  url: "about:blank",
  title: "New Tab",
  loading: false,
  screenshot: "",
  lastAction: "idle",
  actions: [],
  domSummary: [],
  logs: [],
  canGoBack: false,
  canGoForward: false,
  proxyPort: 0,
  browserLabel: "",
  installing: false,
  installStatus: "",
};

const aiBrowserRuntime = {
  playwright: null,
  browser: null,
  context: null,
  page: null,
  cdp: null,
  executablePath: "",
  browserLabel: "",
  proxyPort: 0,
  bypassProxy: false,
  consoleLogs: [],
  lastFrameAt: 0,
  emitFn: null,
  closing: false,
  launchPromise: null,
  installPromise: null,
};

function aiBrowserBroadcast(payload) {
  try {
    if (typeof aiBrowserRuntime.emitFn === "function") {
      aiBrowserRuntime.emitFn(payload);
    }
  } catch {
    void 0;
  }
  try {
    if (typeof broadcast === "function") {
      broadcast("ai:event", payload);
    }
  } catch {
    void 0;
  }
}

function aiBrowserRequirePlaywright() {
  if (aiBrowserRuntime.playwright) return aiBrowserRuntime.playwright;
  const candidates = ["playwright-core"];
  try {
    const base = typeof appRoot === "function" ? appRoot() : node_path.resolve(__dirname, "..", "..");
    candidates.push(node_path.join(base, "node_modules", "playwright-core"));
  } catch {
    void 0;
  }
  candidates.push(node_path.join(process.cwd(), "node_modules", "playwright-core"));
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (mod && mod.chromium) {
        aiBrowserRuntime.playwright = mod;
        return mod;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`playwright-core is not available: ${String(lastError?.message || lastError || "not found")}`);
}

function aiBrowserDetectInstalled() {
  const candidates = [];
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || node_path.join(node_os.homedir(), "AppData", "Local");
    candidates.push(
      { label: "Google Chrome", kind: "chrome", path: node_path.join(pf, "Google", "Chrome", "Application", "chrome.exe") },
      { label: "Google Chrome", kind: "chrome", path: node_path.join(pf86, "Google", "Chrome", "Application", "chrome.exe") },
      { label: "Google Chrome", kind: "chrome", path: node_path.join(local, "Google", "Chrome", "Application", "chrome.exe") },
      { label: "Microsoft Edge", kind: "edge", path: node_path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe") },
      { label: "Microsoft Edge", kind: "edge", path: node_path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe") },
      { label: "Microsoft Edge", kind: "edge", path: node_path.join(local, "Microsoft", "Edge", "Application", "msedge.exe") },
      { label: "Brave", kind: "brave", path: node_path.join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") },
      { label: "Brave", kind: "brave", path: node_path.join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") },
      { label: "Chromium", kind: "chromium", path: node_path.join(local, "Chromium", "Application", "chrome.exe") }
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      { label: "Google Chrome", kind: "chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
      { label: "Microsoft Edge", kind: "edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
      { label: "Brave", kind: "brave", path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
      { label: "Chromium", kind: "chromium", path: "/Applications/Chromium.app/Contents/MacOS/Chromium" }
    );
  } else {
    candidates.push(
      { label: "Google Chrome", kind: "chrome", path: "/usr/bin/google-chrome" },
      { label: "Google Chrome", kind: "chrome", path: "/usr/bin/google-chrome-stable" },
      { label: "Chromium", kind: "chromium", path: "/usr/bin/chromium" },
      { label: "Chromium", kind: "chromium", path: "/usr/bin/chromium-browser" },
      { label: "Microsoft Edge", kind: "edge", path: "/usr/bin/microsoft-edge" },
      { label: "Brave", kind: "brave", path: "/usr/bin/brave-browser" }
    );
  }

  for (const item of candidates) {
    try {
      if (item.path && node_fs.existsSync(item.path)) {
        return { installed: true, executablePath: item.path, kind: item.kind, label: item.label };
      }
    } catch {
      void 0;
    }
  }

  try {
    const pw = aiBrowserRequirePlaywright();
    const bundled = pw.chromium.executablePath();
    if (bundled && node_fs.existsSync(bundled)) {
      return { installed: true, executablePath: bundled, kind: "playwright", label: "Chromium" };
    }
  } catch {
    void 0;
  }

  return { installed: false, executablePath: "", kind: "", label: "" };
}

function aiBrowserCliPath() {
  const roots = [];
  try {
    const base = typeof appRoot === "function" ? appRoot() : node_path.resolve(__dirname, "..", "..");
    roots.push(node_path.join(base, "node_modules", "playwright-core", "cli.js"));
  } catch {
    void 0;
  }
  roots.push(node_path.join(process.cwd(), "node_modules", "playwright-core", "cli.js"));
  for (const candidate of roots) {
    if (node_fs.existsSync(candidate)) return candidate;
  }
  return "";
}

async function aiBrowserInstallChromium(emit) {
  if (aiBrowserRuntime.installPromise) return aiBrowserRuntime.installPromise;
  const cli = aiBrowserCliPath();
  if (!cli) {
    return { ok: false, error: "playwright-core installer CLI was not found." };
  }

  aiBrowserSession.installing = true;
  aiBrowserSession.installStatus = "Downloading Chromium browser runtime...";
  aiBrowserBroadcast({
    type: "browser_action",
    action: "status",
    url: aiBrowserSession.url,
    title: "Installing Chromium",
    status: aiBrowserSession.installStatus,
    installing: true,
    timestamp: Date.now(),
  });
  if (typeof emit === "function") {
    try { emit({ type: "status", text: aiBrowserSession.installStatus }); } catch {}
  }

  aiBrowserRuntime.installPromise = new Promise((resolve) => {
    const child = node_child_process.spawn(process.execPath, [cli, "install", "chromium"], {
      windowsHide: true,
      env: { ...process.env, CI: "1" },
    });
    let output = "";
    const pushLine = (chunk) => {
      const text = chunk.toString("utf8");
      output += text;
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const last = lines[lines.length - 1];
      if (last) {
        aiBrowserSession.installStatus = last.slice(0, 140);
        try {
          if (typeof broadcast === "function") {
            broadcast("ai:browserProgress", { status: aiBrowserSession.installStatus, installing: true });
          }
        } catch {
          void 0;
        }
      }
    };
    child.stdout?.on("data", pushLine);
    child.stderr?.on("data", pushLine);
    child.on("error", (err) => {
      aiBrowserSession.installing = false;
      aiBrowserSession.installStatus = String(err.message || err);
      resolve({ ok: false, error: aiBrowserSession.installStatus });
    });
    child.on("close", (code) => {
      aiBrowserSession.installing = false;
      const detected = aiBrowserDetectInstalled();
      if (code === 0 && detected.installed) {
        aiBrowserSession.installStatus = `${detected.label} ready`;
        resolve({ ok: true, ...detected });
      } else {
        aiBrowserSession.installStatus = output.slice(-240).trim() || `Installer exited with code ${code}`;
        resolve({ ok: false, error: aiBrowserSession.installStatus });
      }
    });
  }).finally(() => {
    aiBrowserRuntime.installPromise = null;
  });

  return aiBrowserRuntime.installPromise;
}

function aiBrowserActiveProxyPort() {
  if (aiBrowserRuntime.bypassProxy) return 0;
  try {
    if (typeof proxyServer !== "undefined" && proxyServer && typeof proxyPort === "number" && proxyPort > 0) {
      return proxyPort;
    }
  } catch {
    void 0;
  }
  return 0;
}

function aiBrowserStateFile() {
  try {
    return node_path.join(electron.app.getPath("userData"), "ai-browser-state.json");
  } catch {
    return "";
  }
}

async function aiBrowserSaveStorageState() {
  if (!aiBrowserRuntime.context) return;
  const target = aiBrowserStateFile();
  if (!target) return;
  try {
    await aiBrowserRuntime.context.storageState({ path: target });
  } catch {
    void 0;
  }
}

function aiBrowserPushLog(entry) {
  aiBrowserRuntime.consoleLogs.push({
    ...entry,
    timestamp: Date.now(),
  });
  if (aiBrowserRuntime.consoleLogs.length > 200) {
    aiBrowserRuntime.consoleLogs.splice(0, aiBrowserRuntime.consoleLogs.length - 200);
  }
}

async function aiBrowserSyncNavState() {
  const page = aiBrowserRuntime.page;
  if (!page || page.isClosed()) return;
  try {
    aiBrowserSession.url = page.url() || "about:blank";
    aiBrowserSession.title = (await page.title().catch(() => "")) || aiBrowserSession.url;
  } catch {
    void 0;
  }
  try {
    if (aiBrowserRuntime.cdp) {
      const hist = await aiBrowserRuntime.cdp.send("Page.getNavigationHistory");
      const idx = Number(hist?.currentIndex ?? 0);
      const len = Array.isArray(hist?.entries) ? hist.entries.length : 0;
      aiBrowserSession.canGoBack = idx > 0;
      aiBrowserSession.canGoForward = idx >= 0 && idx < len - 1;
      return;
    }
    const nav = await page.evaluate(() => ({ len: window.history.length }));
    aiBrowserSession.canGoBack = nav.len > 1;
    aiBrowserSession.canGoForward = false;
  } catch {
    aiBrowserSession.canGoBack = false;
    aiBrowserSession.canGoForward = false;
  }
}

function aiBrowserEmitFrame(force = false) {
  const now = Date.now();
  if (!force && now - aiBrowserRuntime.lastFrameAt < 65) return;
  aiBrowserRuntime.lastFrameAt = now;
  aiBrowserBroadcast({
    type: "browser_frame",
    url: aiBrowserSession.url,
    title: aiBrowserSession.title,
    loading: aiBrowserSession.loading,
    screenshot: aiBrowserSession.screenshot,
    proxyPort: aiBrowserSession.proxyPort,
    browserLabel: aiBrowserSession.browserLabel,
    canGoBack: aiBrowserSession.canGoBack,
    canGoForward: aiBrowserSession.canGoForward,
    timestamp: now,
  });
}

function aiBrowserEmitAction(action, target, extra = {}) {
  const now = Date.now();
  const safeExtra = { ...extra };
  delete safeExtra.screenshot;
  const entry = {
    id: `act-${now}-${Math.random().toString(36).slice(2, 6)}`,
    action,
    url: aiBrowserSession.url,
    title: aiBrowserSession.title,
    target: target ? String(target).slice(0, 120) : undefined,
    loading: aiBrowserSession.loading,
    proxyPort: aiBrowserSession.proxyPort,
    browserLabel: aiBrowserSession.browserLabel,
    timestamp: now,
    ...safeExtra,
  };
  aiBrowserSession.lastAction = action;
  aiBrowserSession.actions.push(entry);
  if (aiBrowserSession.actions.length > 60) {
    aiBrowserSession.actions.splice(0, aiBrowserSession.actions.length - 60);
  }
  aiBrowserBroadcast({
    type: "browser_action",
    ...entry,
    screenshot: aiBrowserSession.screenshot,
    canGoBack: aiBrowserSession.canGoBack,
    canGoForward: aiBrowserSession.canGoForward,
    openPanel: true,
  });
}

async function aiBrowserAttachPage(page, context) {
  aiBrowserRuntime.page = page;
  aiBrowserRuntime.context = context;

  page.on("console", (msg) => {
    const type = msg.type();
    aiBrowserPushLog({ kind: "console", level: type, text: msg.text() });
  });
  page.on("pageerror", (error) => {
    aiBrowserPushLog({ kind: "pageerror", level: "error", text: String(error?.message || error) });
  });
  page.on("requestfailed", (req) => {
    aiBrowserPushLog({
      kind: "network",
      level: "error",
      text: `${req.method()} ${req.url()} -> ${req.failure()?.errorText || "failed"}`,
    });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      aiBrowserPushLog({
        kind: "network",
        level: res.status() >= 500 ? "error" : "warning",
        text: `${res.status()} ${res.request().method()} ${res.url()}`,
      });
    }
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      aiBrowserSession.url = frame.url() || aiBrowserSession.url;
      void aiBrowserSyncNavState().then(() => aiBrowserEmitFrame(true));
    }
  });
  page.on("load", () => {
    aiBrowserSession.loading = false;
    void aiBrowserSyncNavState().then(() => {
      aiBrowserEmitFrame(true);
      void aiBrowserSaveStorageState();
    });
  });
  page.on("close", () => {
    if (aiBrowserRuntime.page === page) {
      aiBrowserRuntime.page = null;
    }
  });

  context.on("page", async (newPage) => {
    if (newPage !== aiBrowserRuntime.page) {
      try {
        const href = newPage.url();
        await newPage.close().catch(() => {});
        if (href && /^https?:\/\//i.test(href) && aiBrowserRuntime.page && !aiBrowserRuntime.page.isClosed()) {
          await aiBrowserRuntime.page.goto(href, { waitUntil: "domcontentloaded" }).catch(() => {});
        }
      } catch {
        void 0;
      }
    }
  });

  try {
    const cdp = await context.newCDPSession(page);
    aiBrowserRuntime.cdp = cdp;
    cdp.on("Page.screencastFrame", (evt) => {
      try {
        if (evt.sessionId) {
          void cdp.send("Page.screencastFrameAck", { sessionId: evt.sessionId }).catch(() => {});
        }
        if (evt.data) {
          aiBrowserSession.screenshot = `data:image/jpeg;base64,${evt.data}`;
          aiBrowserEmitFrame(false);
        }
      } catch {
        void 0;
      }
    });
    await cdp.send("Page.enable").catch(() => {});
    await cdp
      .send("Page.startScreencast", {
        format: "jpeg",
        quality: 75,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 1,
      })
      .catch(() => {});
  } catch {
    aiBrowserRuntime.cdp = null;
  }
}

async function aiBrowserEnsureReady({ clearSession = false, bypassProxy = false, emit = null } = {}) {
  if (emit) aiBrowserRuntime.emitFn = emit;
  aiBrowserRuntime.bypassProxy = Boolean(bypassProxy);
  const desiredProxyPort = aiBrowserActiveProxyPort();

  if (
    aiBrowserRuntime.page &&
    !aiBrowserRuntime.page.isClosed() &&
    !clearSession &&
    aiBrowserRuntime.proxyPort === desiredProxyPort
  ) {
    return aiBrowserRuntime.page;
  }

  if (aiBrowserRuntime.launchPromise) {
    return aiBrowserRuntime.launchPromise;
  }

  aiBrowserRuntime.launchPromise = (async () => {
    const pw = aiBrowserRequirePlaywright();
    let detected = aiBrowserDetectInstalled();
    if (!detected.installed) {
      const installed = await aiBrowserInstallChromium(emit);
      if (!installed.ok) {
        throw new Error(`No Chromium browser detected and automatic installation failed: ${installed.error}`);
      }
      detected = aiBrowserDetectInstalled();
    }

    const currentUrl =
      !clearSession && aiBrowserRuntime.page && !aiBrowserRuntime.page.isClosed()
        ? aiBrowserRuntime.page.url()
        : "";

    if (aiBrowserRuntime.context) {
      if (!clearSession) await aiBrowserSaveStorageState();
      try { await aiBrowserRuntime.cdp?.detach().catch(() => {}); } catch {}
      await aiBrowserRuntime.context.close().catch(() => {});
      aiBrowserRuntime.context = null;
      aiBrowserRuntime.page = null;
      aiBrowserRuntime.cdp = null;
    }

    const needNewBrowser =
      !aiBrowserRuntime.browser ||
      !aiBrowserRuntime.browser.isConnected() ||
      aiBrowserRuntime.executablePath !== detected.executablePath;

    if (needNewBrowser) {
      if (aiBrowserRuntime.browser) {
        await aiBrowserRuntime.browser.close().catch(() => {});
        aiBrowserRuntime.browser = null;
      }
      const launchArgs = [
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-dev-shm-usage",
        "--ignore-certificate-errors",
        "--allow-insecure-localhost",
        "--window-size=1280,800",
      ];
      if (process.platform === "linux") launchArgs.push("--no-sandbox");

      aiBrowserRuntime.browser = await pw.chromium.launch({
        executablePath: detected.executablePath || undefined,
        headless: true,
        args: launchArgs,
      });
      aiBrowserRuntime.executablePath = detected.executablePath;
      aiBrowserRuntime.browserLabel = detected.label;
      aiBrowserSession.browserLabel = detected.label;
    }

    const statePath = aiBrowserStateFile();
    if (clearSession && statePath) {
      try { await promises.rm(statePath, { force: true }); } catch {}
    }

    const contextOptions = {
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      acceptDownloads: true,
    };
    if (!clearSession && statePath && node_fs.existsSync(statePath)) {
      contextOptions.storageState = statePath;
    }
    if (desiredProxyPort > 0) {
      contextOptions.proxy = { server: `http://127.0.0.1:${desiredProxyPort}` };
    }

    const context = await aiBrowserRuntime.browser.newContext(contextOptions);
    const page = await context.newPage();
    aiBrowserRuntime.proxyPort = desiredProxyPort;
    aiBrowserSession.proxyPort = desiredProxyPort;
    aiBrowserSession.open = true;
    aiBrowserSession.active = true;

    await aiBrowserAttachPage(page, context);

    if (currentUrl && /^https?:\/\//i.test(currentUrl)) {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
      await aiBrowserSyncNavState();
    }

    return page;
  })().finally(() => {
    aiBrowserRuntime.launchPromise = null;
  });

  return aiBrowserRuntime.launchPromise;
}

async function aiBrowserSnapRefs(page, { interactiveOnly = true, selector = "", maxNodes = 120 } = {}) {
  const capped = Math.max(10, Math.min(300, Number(maxNodes) || 120));
  const data = await page.evaluate(
    ({ interactiveOnly: onlyInteractive, rootSel, limit }) => {
      document.querySelectorAll("[data-wide-ref]").forEach((el) => el.removeAttribute("data-wide-ref"));
      const root = rootSel ? document.querySelector(rootSel) : document.body;
      if (!root) return { nodes: [], text: "", title: document.title || "", url: location.href };

      const interactiveSelector =
        "a[href], button, input, select, textarea, summary, [role='button'], [role='link'], [role='textbox'], [role='searchbox'], [role='checkbox'], [role='radio'], [role='combobox'], [role='switch'], [role='tab'], [role='menuitem'], [contenteditable='true'], [tabindex]:not([tabindex='-1'])";
      const allSelector = onlyInteractive
        ? interactiveSelector
        : `${interactiveSelector}, h1, h2, h3, label, img[alt], [role='heading']`;

      const nodes = [];
      const seen = new Set();
      let idx = 1;
      const candidates = root.querySelectorAll(allSelector);
      for (const el of candidates) {
        if (nodes.length >= limit) break;
        if (seen.has(el)) continue;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
        if (rect.width < 2 || rect.height < 2) continue;

        const ref = `@e${idx}`;
        idx += 1;
        el.setAttribute("data-wide-ref", ref.slice(1));

        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || tag;
        const type = el.getAttribute("type") || "";
        const nameAttr = el.getAttribute("name") || "";
        const idAttr = el.id || "";
        const placeholder = el.getAttribute("placeholder") || "";
        const ariaLabel = el.getAttribute("aria-label") || "";
        const href = tag === "a" ? el.getAttribute("href") || "" : "";
        let value = "";
        if (tag === "input" || tag === "textarea" || tag === "select") {
          value = type === "password" ? "***" : String(el.value || "").slice(0, 60);
        }
        const labelText = (
          ariaLabel ||
          el.innerText ||
          el.textContent ||
          el.getAttribute("title") ||
          el.getAttribute("alt") ||
          placeholder ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 90);

        nodes.push({
          ref,
          tag,
          role: type ? `${role}:${type}` : role,
          name: labelText,
          id: idAttr,
          nameAttr,
          placeholder,
          href: href.slice(0, 120),
          value,
          disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true"),
          box: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
        });
      }

      const rawText = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 3000);
      return {
        url: location.href,
        title: document.title || "",
        nodes,
        text: rawText,
      };
    },
    { interactiveOnly, rootSel: selector || "", limit: capped }
  );

  aiBrowserSession.domSummary = (data.nodes || []).map((n) => ({
    id: Number(String(n.ref || "").replace("@e", "")) || 0,
    ref: n.ref,
    tag: n.tag,
    type: n.role,
    text: n.name || n.placeholder || n.href,
  }));

  return data;
}

function aiFormatSnapshotText(data) {
  const lines = [`URL: ${data.url}`, `Title: ${data.title}`, `Interactive Elements (${data.nodes.length}):`];
  for (const n of data.nodes) {
    const bits = [`${n.ref} [${n.role}]`];
    if (n.name) bits.push(`"${n.name}"`);
    if (n.placeholder && n.placeholder !== n.name) bits.push(`placeholder="${n.placeholder}"`);
    if (n.value) bits.push(`value="${n.value}"`);
    if (n.href) bits.push(`href="${n.href}"`);
    if (n.disabled) bits.push(`(disabled)`);
    lines.push(bits.join(" "));
  }
  return lines.join("\n");
}

function aiNormalizeBrowserUrl(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[a-z]+:\/\//i.test(input)) return "";
  return `https://${input}`;
}

function aiResolveLocator(page, { ref, element_id, selector, text }) {
  const cleanRef =
    typeof ref === "string" && ref.trim()
      ? ref.trim().replace(/^@/, "")
      : Number.isFinite(Number(element_id)) && Number(element_id) > 0
        ? `e${Number(element_id)}`
        : "";
  if (cleanRef) {
    return { locator: page.locator(`[data-wide-ref="${cleanRef}"]`).first(), label: `@${cleanRef}` };
  }
  if (typeof selector === "string" && selector.trim()) {
    return { locator: page.locator(selector.trim()).first(), label: selector.trim() };
  }
  if (typeof text === "string" && text.trim()) {
    return { locator: page.getByText(text.trim(), { exact: false }).first(), label: text.trim() };
  }
  return null;
}

async function aiCaptureLiveScreenshot(page, fullPage = false) {
  if (!page || page.isClosed()) return aiBrowserSession.screenshot;
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 78, fullPage: Boolean(fullPage) });
    const uri = `data:image/jpeg;base64,${buf.toString("base64")}`;
    aiBrowserSession.screenshot = uri;
    return uri;
  } catch {
    return aiBrowserSession.screenshot;
  }
}

async function aiExecuteBrowserOpen(input = {}, emit) {
  if (emit) aiBrowserRuntime.emitFn = emit;
  const targetUrl = aiNormalizeBrowserUrl(input.url);
  aiBrowserSession.open = true;
  aiBrowserSession.active = true;
  if (targetUrl) {
    aiBrowserSession.url = targetUrl;
    aiBrowserSession.title = "Loading...";
    aiBrowserSession.loading = true;
  }
  aiBrowserEmitAction("open", targetUrl || "browser", { openPanel: true });

  const page = await aiBrowserEnsureReady({
    clearSession: Boolean(input.clearSession),
    bypassProxy: Boolean(input.bypassProxy),
    emit,
  });

  if (targetUrl) {
    await page.goto(targetUrl, {
      waitUntil: input.waitUntil || "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(250);
  }
  aiBrowserSession.loading = false;
  await aiBrowserSyncNavState();
  await aiCaptureLiveScreenshot(page);
  const snap = await aiBrowserSnapRefs(page);
  aiBrowserEmitAction("open", aiBrowserSession.url);
  return aiFormatSnapshotText(snap);
}

async function aiExecuteBrowserNavigate(url, emit, opts = {}) {
  const target = aiNormalizeBrowserUrl(url);
  if (!target) {
    return "Invalid URL. Please provide an http:// or https:// URL.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;

  aiBrowserSession.open = true;
  aiBrowserSession.active = true;
  aiBrowserSession.url = target;
  aiBrowserSession.title = "Loading...";
  aiBrowserSession.loading = true;
  aiBrowserEmitAction("navigate", target, { openPanel: true });

  try {
    const page = await aiBrowserEnsureReady({ emit });
    const waitUntil = opts.waitUntil === "networkidle" || opts.waitUntil === "load" ? opts.waitUntil : "domcontentloaded";
    const resp = await page.goto(target, { waitUntil, timeout: 30000 });
    await page.waitForTimeout(300);
    aiBrowserSession.loading = false;
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(page);
    const snap = await aiBrowserSnapRefs(page);
    aiBrowserEmitAction("navigate", aiBrowserSession.url);
    const statusLine = resp ? `HTTP ${resp.status()}` : "OK";
    return `Navigated (${statusLine}) via ${aiBrowserSession.browserLabel}${aiBrowserSession.proxyPort ? ` [Catcher Proxy :${aiBrowserSession.proxyPort}]` : ""}.\n${aiFormatSnapshotText(snap)}`;
  } catch (error) {
    aiBrowserSession.loading = false;
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
    aiBrowserEmitAction("navigate_error", target, { error: String(error?.message || error) });
    return `Navigation failed for ${target}: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserSnapshot(input = {}, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open. Call browser_open or browser_navigate first.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  await aiBrowserSyncNavState();
  await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
  const snap = await aiBrowserSnapRefs(aiBrowserRuntime.page, {
    interactiveOnly: input.interactiveOnly !== false,
    selector: input.selector || "",
    maxNodes: input.maxNodes || 120,
  });
  aiBrowserEmitAction("snapshot", aiBrowserSession.url);
  return aiFormatSnapshotText(snap);
}

async function aiExecuteBrowserClick(selector, elementId, text, emit, extra = {}) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open. Call browser_open or browser_navigate first.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const page = aiBrowserRuntime.page;
  try {
    let targetLabel = "";
    if (Number.isFinite(Number(extra.x)) && Number.isFinite(Number(extra.y))) {
      const x = Number(extra.x);
      const y = Number(extra.y);
      targetLabel = `(${x},${y})`;
      await page.mouse.click(x, y, {
        button: extra.button || "left",
        clickCount: Number(extra.clickCount) || 1,
      });
    } else {
      const target = aiResolveLocator(page, {
        ref: extra.ref,
        element_id: elementId,
        selector,
        text,
      });
      if (!target) {
        return "Provide ref (e.g. '@e1'), element_id, selector, text, or x/y coordinates to click.";
      }
      targetLabel = target.label;
      await target.locator.click({
        timeout: 8000,
        button: extra.button || "left",
        clickCount: Number(extra.clickCount) || 1,
      });
    }
    await page.waitForTimeout(350);
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(page);
    const snap = await aiBrowserSnapRefs(page);
    aiBrowserEmitAction("click", targetLabel);
    return `Clicked ${targetLabel}.\n${aiFormatSnapshotText(snap)}`;
  } catch (error) {
    return `Click failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserType(selector, elementId, text, clear = true, submit = false, emit, extra = {}) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open. Call browser_open or browser_navigate first.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const page = aiBrowserRuntime.page;
  const value = String(text ?? "");
  try {
    const target = aiResolveLocator(page, {
      ref: extra.ref,
      element_id: elementId,
      selector,
    });
    let label = "active element";
    if (target) {
      label = target.label;
      if (clear) {
        await target.locator.fill(value, { timeout: 8000 });
      } else {
        await target.locator.click({ timeout: 8000 });
        await page.keyboard.type(value);
      }
    } else {
      await page.keyboard.type(value);
    }
    if (submit) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(450);
    } else {
      await page.waitForTimeout(200);
    }
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(page);
    const snap = await aiBrowserSnapRefs(page);
    aiBrowserEmitAction("type", label);
    return `Typed into ${label}${submit ? " and pressed Enter" : ""}.\n${aiFormatSnapshotText(snap)}`;
  } catch (error) {
    return `Type failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserPress(key, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open. Call browser_open or browser_navigate first.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const k = String(key || "").trim();
  if (!k) return "Provide a key name such as 'Enter', 'Tab', or 'Escape'.";
  try {
    await aiBrowserRuntime.page.keyboard.press(k);
    await aiBrowserRuntime.page.waitForTimeout(250);
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
    aiBrowserEmitAction("press", k);
    return `Pressed key ${k}. Current URL: ${aiBrowserSession.url}`;
  } catch (error) {
    return `Key press failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserHover(input = {}, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const target = aiResolveLocator(aiBrowserRuntime.page, input);
  if (!target) return "Provide ref, selector, or text to hover.";
  try {
    await target.locator.hover({ timeout: 8000 });
    await aiBrowserRuntime.page.waitForTimeout(200);
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
    aiBrowserEmitAction("hover", target.label);
    return `Hovered over ${target.label}.`;
  } catch (error) {
    return `Hover failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserSelect(input = {}, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const target = aiResolveLocator(aiBrowserRuntime.page, input);
  if (!target) return "Provide ref or selector of the <select> element.";
  try {
    const opt = input.label ? { label: String(input.label) } : String(input.value ?? "");
    const selected = await target.locator.selectOption(opt, { timeout: 8000 });
    await aiBrowserRuntime.page.waitForTimeout(200);
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
    aiBrowserEmitAction("select", target.label);
    return `Selected [${selected.join(", ")}] on ${target.label}.`;
  } catch (error) {
    return `Select failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserScroll(input = {}, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const page = aiBrowserRuntime.page;
  try {
    const target = aiResolveLocator(page, input);
    if (target) {
      await target.locator.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(200);
      await aiCaptureLiveScreenshot(page);
      aiBrowserEmitAction("scroll", target.label);
      return `Scrolled ${target.label} into view.`;
    }
    const dir = String(input.direction || "down").toLowerCase();
    const amount = Number(input.amount) || 600;
    const dx = dir === "left" ? -amount : dir === "right" ? amount : 0;
    const dy = dir === "up" ? -amount : dir === "down" ? amount : 0;
    await page.evaluate(([x, y]) => window.scrollBy(x, y), [dx, dy]);
    await page.waitForTimeout(200);
    await aiCaptureLiveScreenshot(page);
    aiBrowserEmitAction("scroll", `${dir} ${amount}px`);
    return `Scrolled ${dir} by ${amount}px.`;
  } catch (error) {
    return `Scroll failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserWait(input = {}, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const page = aiBrowserRuntime.page;
  const timeout = Math.max(500, Math.min(30000, Number(input.timeoutMs) || 10000));
  try {
    if (input.selector) {
      await page.locator(String(input.selector)).first().waitFor({ state: "visible", timeout });
    } else if (input.text) {
      await page.getByText(String(input.text), { exact: false }).first().waitFor({ state: "visible", timeout });
    } else if (input.url) {
      const sub = String(input.url);
      await page.waitForURL((u) => u.href.includes(sub), { timeout });
    } else {
      await page.waitForLoadState(input.loadState || "domcontentloaded", { timeout });
    }
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(page);
    aiBrowserEmitAction("wait", input.selector || input.text || input.url || input.loadState || "ready");
    return `Wait satisfied. URL: ${aiBrowserSession.url} | Title: ${aiBrowserSession.title}`;
  } catch (error) {
    return `Wait timed out: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserExtract(selector, mode = "snapshot", emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    if (mode === "text" && !aiBrowserSession.open) {
      return `URL: ${aiBrowserSession.url}\nTitle: ${aiBrowserSession.title}\n(No page loaded yet)`;
    }
    return "No browser page is open. Call browser_open or browser_navigate first.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const page = aiBrowserRuntime.page;
  const m = String(mode || "snapshot").toLowerCase();

  try {
    if (m === "snapshot" || m === "dom_tree" || m === "inputs") {
      const snap = await aiBrowserSnapRefs(page, { interactiveOnly: m !== "dom_tree", selector: selector || "" });
      aiBrowserEmitAction("extract", m);
      return aiFormatSnapshotText(snap);
    }
    if (m === "cookies") {
      const cookies = await aiBrowserRuntime.context.cookies();
      aiBrowserEmitAction("extract", "cookies");
      return JSON.stringify(cookies.slice(0, 60), null, 2);
    }
    if (m === "storage") {
      const storage = await page.evaluate(() => ({
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage },
      }));
      aiBrowserEmitAction("extract", "storage");
      return JSON.stringify(storage, null, 2).slice(0, 12000);
    }
    if (m === "links") {
      const links = await page.evaluate((sel) => {
        const root = sel ? document.querySelector(sel) : document.body;
        if (!root) return [];
        return Array.from(root.querySelectorAll("a[href]"))
          .slice(0, 100)
          .map((a) => ({ text: (a.innerText || "").trim().slice(0, 80), href: a.href }));
      }, selector || "");
      aiBrowserEmitAction("extract", "links");
      return JSON.stringify(links, null, 2);
    }
    if (m === "html") {
      const html = selector
        ? await page.locator(selector).first().innerHTML({ timeout: 5000 })
        : await page.content();
      aiBrowserEmitAction("extract", "html");
      return String(html).slice(0, 20000);
    }
    const text = await page.evaluate((sel) => {
      const root = sel ? document.querySelector(sel) : document.body;
      return root ? (root.innerText || "").replace(/\n{3,}/g, "\n\n").trim() : "";
    }, selector || "");
    aiBrowserEmitAction("extract", "text");
    return `URL: ${aiBrowserSession.url}\nTitle: ${aiBrowserSession.title}\n\n${text.slice(0, 16000)}`;
  } catch (error) {
    return `Extract failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserConsole(input = {}, emit) {
  if (emit) aiBrowserRuntime.emitFn = emit;
  const filter = String(input.filter || "all").toLowerCase();
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 40));
  const filtered = aiBrowserRuntime.consoleLogs.filter((entry) => {
    if (filter === "errors") return entry.level === "error";
    if (filter === "warnings") return entry.level === "warning" || entry.level === "error";
    if (filter === "network") return entry.kind === "network";
    return true;
  });
  return JSON.stringify({ total: aiBrowserRuntime.consoleLogs.length, logs: filtered.slice(-limit) }, null, 2);
}

async function aiExecuteBrowserCookies(input = {}, emit) {
  if (!aiBrowserRuntime.context) return "No browser session is active.";
  if (emit) aiBrowserRuntime.emitFn = emit;
  const action = String(input.action || "get").toLowerCase();
  try {
    if (action === "clear") {
      await aiBrowserRuntime.context.clearCookies();
      await aiBrowserSaveStorageState();
      aiBrowserEmitAction("cookies", "cleared");
      return "Cleared all browser cookies in the active context.";
    }
    if (action === "set" && Array.isArray(input.cookies)) {
      await aiBrowserRuntime.context.addCookies(input.cookies);
      await aiBrowserSaveStorageState();
      aiBrowserEmitAction("cookies", `set ${input.cookies.length}`);
      return `Set ${input.cookies.length} cookie(s).`;
    }
    const cookies = input.url
      ? await aiBrowserRuntime.context.cookies([String(input.url)])
      : await aiBrowserRuntime.context.cookies();
    return JSON.stringify(cookies, null, 2).slice(0, 16000);
  } catch (error) {
    return `Cookie operation failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserEval(expression, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const code = String(expression || "").trim();
  if (!code) return "Provide a JavaScript expression to evaluate.";
  try {
    const result = await aiBrowserRuntime.page.evaluate((expr) => {
      return (0, eval)(expr);
    }, code);
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
    aiBrowserEmitAction("eval", code.slice(0, 60));
    return typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? "undefined";
  } catch (error) {
    return `Evaluation error: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserScreenshot(emit, opts = {}) {
  if (emit) aiBrowserRuntime.emitFn = emit;
  if (aiBrowserRuntime.page && !aiBrowserRuntime.page.isClosed()) {
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page, Boolean(opts.fullPage));
    aiBrowserEmitAction("screenshot", aiBrowserSession.url);
    return `Captured live screenshot (${aiBrowserSession.url}).`;
  }
  return `No active Chromium page open yet (current URL: ${aiBrowserSession.url}).`;
}

async function aiExecuteBrowserClose(emit) {
  if (emit) aiBrowserRuntime.emitFn = emit;
  await aiBrowserSaveStorageState();
  aiBrowserSession.open = false;
  aiBrowserSession.active = false;
  aiBrowserSession.loading = false;
  aiBrowserSession.domSummary = [];
  try {
    await aiBrowserRuntime.cdp?.detach().catch(() => {});
    await aiBrowserRuntime.context?.close().catch(() => {});
    await aiBrowserRuntime.browser?.close().catch(() => {});
  } catch {
    void 0;
  }
  aiBrowserRuntime.cdp = null;
  aiBrowserRuntime.context = null;
  aiBrowserRuntime.page = null;
  aiBrowserRuntime.browser = null;
  aiBrowserRuntime.consoleLogs = [];
  aiBrowserEmitAction("close", "browser");
  return "Browser session closed.";
}

function disposeAiBrowser() {
  if (aiBrowserRuntime.closing) return;
  aiBrowserRuntime.closing = true;
  try {
    void aiBrowserRuntime.browser?.close().catch(() => {});
  } catch {
    void 0;
  }
  aiBrowserRuntime.browser = null;
  aiBrowserRuntime.context = null;
  aiBrowserRuntime.page = null;
  aiBrowserRuntime.cdp = null;
}

function registerAiBrowserHandlers() {
  electron.ipcMain.handle("ai:browserStatus", async () => {
    const detected = aiBrowserDetectInstalled();
    return {
      ok: true,
      detected,
      session: {
        ...aiBrowserSession,
        proxyPort: aiBrowserActiveProxyPort(),
      },
    };
  });

  electron.ipcMain.handle("ai:browserInstall", async (event) => {
    const emit = (ev) => {
      if (event?.sender && !event.sender.isDestroyed()) event.sender.send("ai:event", ev);
    };
    return aiBrowserInstallChromium(emit);
  });

  electron.ipcMain.handle("ai:browserInput", async (_event, payload = {}) => {
    const page = aiBrowserRuntime.page;
    if (!page || page.isClosed()) return { ok: false, error: "Browser page is not active." };
    const type = String(payload.type || "");
    try {
      if (type === "mousemove") {
        await page.mouse.move(Number(payload.x) || 0, Number(payload.y) || 0);
      } else if (type === "mousedown") {
        await page.mouse.move(Number(payload.x) || 0, Number(payload.y) || 0);
        await page.mouse.down({ button: payload.button || "left", clickCount: Number(payload.clickCount) || 1 });
      } else if (type === "mouseup") {
        await page.mouse.up({ button: payload.button || "left", clickCount: Number(payload.clickCount) || 1 });
      } else if (type === "click") {
        await page.mouse.click(Number(payload.x) || 0, Number(payload.y) || 0, {
          button: payload.button || "left",
          clickCount: Number(payload.clickCount) || 1,
        });
      } else if (type === "wheel") {
        await page.mouse.wheel(Number(payload.deltaX) || 0, Number(payload.deltaY) || 0);
      } else if (type === "keydown") {
        const key = String(payload.key || "");
        if (key) await page.keyboard.down(key);
      } else if (type === "keyup") {
        const key = String(payload.key || "");
        if (key) await page.keyboard.up(key);
      } else if (type === "press") {
        const key = String(payload.key || "");
        if (key) await page.keyboard.press(key);
      } else if (type === "text") {
        const text = String(payload.text || "");
        if (text) await page.keyboard.insertText(text);
      }
      setTimeout(() => {
        void aiCaptureLiveScreenshot(page).then(() => aiBrowserEmitFrame(true));
      }, 60);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  electron.ipcMain.handle("ai:browserNav", async (event, payload = {}) => {
    const emit = (ev) => {
      if (event?.sender && !event.sender.isDestroyed()) event.sender.send("ai:event", ev);
    };
    const action = String(payload.action || "").toLowerCase();
    try {
      if (action === "goto") {
        const res = await aiExecuteBrowserNavigate(payload.url, emit);
        return { ok: true, result: res, session: aiBrowserSession };
      }
      if (action === "open") {
        const res = await aiExecuteBrowserOpen({ url: payload.url }, emit);
        return { ok: true, result: res, session: aiBrowserSession };
      }
      const page = aiBrowserRuntime.page;
      if (!page || page.isClosed()) return { ok: false, error: "No browser page open." };
      if (action === "back") await page.goBack({ timeout: 10000 }).catch(() => {});
      else if (action === "forward") await page.goForward({ timeout: 10000 }).catch(() => {});
      else if (action === "reload") await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      else if (action === "toggle_proxy") {
        aiBrowserRuntime.bypassProxy = !aiBrowserRuntime.bypassProxy;
        await aiBrowserEnsureReady({ bypassProxy: aiBrowserRuntime.bypassProxy, emit });
      }
      await aiBrowserSyncNavState();
      await aiCaptureLiveScreenshot(aiBrowserRuntime.page || page);
      aiBrowserEmitFrame(true);
      return { ok: true, session: aiBrowserSession };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
}
