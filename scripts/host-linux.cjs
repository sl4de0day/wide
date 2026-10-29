'use strict';

const { app, BrowserWindow, BrowserView, dialog, shell, ipcMain, safeStorage, session } = require('electron');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const IS_DEV = process.argv.includes('--dev');

app.name = 'Wide';
if (typeof app.setAppUserModelId === 'function') {
  app.setAppUserModelId('wide');
}

let mainWindow = null;
let sidecar = null;
let sidecarBuf = '';
const tabs = new Map();
let activeTabId = null;
let pendingOpenPath = null;

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (args.length > 0 && fs.existsSync(args[0])) {
  pendingOpenPath = path.resolve(args[0]);
}

function sendToSidecar(obj) {
  if (sidecar && sidecar.stdin && !sidecar.stdin.destroyed) {
    try {
      sidecar.stdin.write(JSON.stringify(obj) + '\n');
    } catch (err) {
      console.error('[host] Failed to write to sidecar:', err);
    }
  }
}

function emitToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('host-message', {
      type: 'event',
      channel,
      payload: payload === undefined ? null : payload,
    });
  }
}

function replyToRenderer(replyId, result, error) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('host-message', {
      type: 'reply',
      replyId,
      result: result === undefined ? null : result,
      error: error ? String((error && error.message) || error) : undefined,
    });
  }
}

let browserSession = null;
function getBrowserSession() {
  if (browserSession) return browserSession;
  browserSession = session.fromPartition('persist:wide-browser');

  browserSession.setCertificateVerifyProc((_request, callback) => {
    callback(0); // 0 = SSL sertifikasını kabul et / güven
  });

  return browserSession;
}

function getOrCreateTab(tabId) {
  if (!tabId) return null;
  let tab = tabs.get(tabId);
  if (tab) return tab;

  const view = new BrowserView({
    webPreferences: {
      session: getBrowserSession(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: false,
    },
  });

  tab = {
    id: tabId,
    view,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    visible: false,
    loading: false,
  };

  const wc = view.webContents;
  wc.on('did-start-loading', () => {
    tab.loading = true;
    emitBrowserEvent({ tabId, loading: true });
  });

  wc.on('did-stop-loading', () => {
    tab.loading = false;
    emitBrowserEvent({ tabId, loading: false });
    emitBrowserState(tabId);
  });

  wc.on('page-title-updated', (_e, title) => {
    emitBrowserEvent({ tabId, title });
  });

  wc.on('page-favicon-updated', (_e, favicons) => {
    if (favicons && favicons.length > 0) {
      emitBrowserEvent({ tabId, favicon: favicons[0] });
    }
  });

  tabs.set(tabId, tab);
  return tab;
}

function emitBrowserEvent(payload) {
  emitToRenderer('browser:event', payload);
}

function emitBrowserState(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || !tab.view) return;
  const wc = tab.view.webContents;
  emitBrowserEvent({
    tabId,
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
  });
}

function placeBrowserTab(tabId, x, y, w, h, visible) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (tabId) activeTabId = tabId;

  const tab = getOrCreateTab(tabId);
  if (!tab) return;

  tab.bounds = {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(0, Math.round(w)),
    height: Math.max(0, Math.round(h)),
  };
  tab.visible = Boolean(visible);

  applyBrowserPlacement();
}

function applyBrowserPlacement() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  for (const [id, tab] of tabs.entries()) {
    const isCurrentActive = id === activeTabId && tab.visible;
    const views = mainWindow.getBrowserViews();
    const isAttached = views.includes(tab.view);

    if (isCurrentActive) {
      if (!isAttached) mainWindow.addBrowserView(tab.view);
      tab.view.setBounds(tab.bounds);
    } else {
      if (isAttached) mainWindow.removeBrowserView(tab.view);
    }
  }
}

function closeBrowserTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.removeBrowserView(tab.view);
    } catch {}
  }
  try {
    tab.view.webContents.close();
  } catch {}
  tabs.delete(tabId);
  if (activeTabId === tabId) {
    activeTabId = tabs.size > 0 ? tabs.keys().next().value : null;
    applyBrowserPlacement();
  }
}

function startSidecar() {
  const sidecarScript = path.join(ROOT, 'sidecar', 'sidecar.cjs');
  const env = { ...process.env };
  if (!env.XDG_CONFIG_HOME) {
    env.XDG_CONFIG_HOME = path.join(os.homedir(), '.config');
  }

  const nodeBin = path.join(os.homedir(), '.cargo', 'bin', 'node');
  const nodeExec = fs.existsSync(nodeBin) ? nodeBin : process.execPath;

  sidecar = cp.spawn(nodeExec, [sidecarScript], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'inherit'],
    env,
  });

  sidecar.stdout.on('data', (chunk) => {
    sidecarBuf += chunk.toString();
    let idx;
    while ((idx = sidecarBuf.indexOf('\n')) >= 0) {
      const line = sidecarBuf.slice(0, idx).trim();
      sidecarBuf = sidecarBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        handleSidecarMessage(msg);
      } catch (err) {
        console.error('[host] Malformed sidecar JSON:', line, err);
      }
    }
  });

  sidecar.on('exit', (code, signal) => {
    console.log(`[host] sidecar exited with code=${code} signal=${signal}`);
    emitToRenderer('host:backend', { running: false, code, signal });
  });
}

async function handleSidecarMessage(msg) {
  if (msg.t === 'host') {
    const id = msg.id;
    const method = msg.method;
    const params = msg.params || {};

    try {
      let result = null;

      if (method === 'dialog:showOpenDialog') {
        result = await dialog.showOpenDialog(mainWindow, {
          title: params.title,
          defaultPath: params.defaultPath,
          properties: params.properties || ['openFile'],
          filters: params.filters,
        });
      } else if (method === 'shell:showItemInFolder') {
        shell.showItemInFolder(params.path);
      } else if (method === 'shell:openExternal') {
        if (params.url) shell.openExternal(params.url);
      } else if (method === 'shell:trashItem') {
        if (params.path) await shell.trashItem(params.path);
      } else if (method === 'browser:proxy') {
        const port = params.port || 0;
        const bs = getBrowserSession();
        if (port > 0) {
          await bs.setProxy({ proxyRules: `http://127.0.0.1:${port}` });
        } else {
          await bs.setProxy({ proxyRules: '' });
        }
        sendToSidecar({ t: 'hostReply', id, result: null });
        return;
      } else if (method === 'window:setTitle') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setTitle(params.title || 'Wide');
        }
      } else if (method === 'crypto:protect') {
        try {
          const buf = Buffer.from(params.data || '', 'base64');
          const enc = safeStorage.isEncryptionAvailable()
            ? safeStorage.encryptString(buf.toString('utf8')).toString('base64')
            : buf.toString('base64');
          result = { ok: true, data: enc };
        } catch {
          result = { ok: false };
        }
      } else if (method === 'crypto:unprotect') {
        try {
          const enc = Buffer.from(params.data || '', 'base64');
          const dec = safeStorage.isEncryptionAvailable()
            ? safeStorage.decryptString(enc)
            : enc.toString('utf8');
          result = { ok: true, data: Buffer.from(dec).toString('base64') };
        } catch {
          result = { ok: false };
        }
      } else if (method === 'app:installUpdate') {
        const updatePath = params.path;
        if (!updatePath || !fs.existsSync(updatePath)) {
          sendToSidecar({ t: 'hostReply', id, error: 'Update file not found.' });
          return;
        }

        try {
          if (updatePath.endsWith('.AppImage')) {
            fs.chmodSync(updatePath, 0o755);
            if (process.env.APPIMAGE) {
              fs.copyFileSync(updatePath, process.env.APPIMAGE);
              fs.chmodSync(process.env.APPIMAGE, 0o755);
              app.relaunch({ execPath: process.env.APPIMAGE });
              setTimeout(() => app.exit(0), 1000);
              result = { ok: true };
            } else {
              cp.spawn(updatePath, [], { detached: true, stdio: 'ignore' }).unref();
              setTimeout(() => app.exit(0), 1000);
              result = { ok: true };
            }
          } else if (updatePath.endsWith('.pkg.tar.zst')) {
            const hasPkexec = fs.existsSync('/usr/bin/pkexec');
            if (hasPkexec) {
              cp.spawn('pkexec', ['pacman', '-U', '--noconfirm', updatePath], {
                detached: true,
                stdio: 'ignore',
              }).unref();
              result = { ok: true, background: true };
            } else {
              cp.spawn('sh', ['-c', `$TERMINAL -e sudo pacman -U "${updatePath}" || xdg-open "${path.dirname(updatePath)}"`], {
                detached: true,
                stdio: 'ignore',
              }).unref();
              result = { ok: true };
            }
          } else if (updatePath.endsWith('.tar.gz') || updatePath.endsWith('.tar.zst')) {
            const isOpt = ROOT.startsWith('/opt');
            const flag = updatePath.endsWith('.zst') ? '--zstd' : '-z';
            if (isOpt && fs.existsSync('/usr/bin/pkexec')) {
              cp.spawn('pkexec', ['tar', flag, '-xf', updatePath, '-C', '/opt/wide'], {
                detached: true,
                stdio: 'ignore',
              }).unref();
              result = { ok: true, background: true };
            } else {
              const extract = cp.spawnSync('tar', [flag, '-xf', updatePath, '-C', ROOT]);
              if (extract.status === 0) {
                app.relaunch();
                setTimeout(() => app.exit(0), 1000);
                result = { ok: true };
              } else {
                result = { ok: false, error: extract.stderr?.toString() || 'Archive extraction failed' };
              }
            }
          } else {
            result = { ok: false, error: 'Unsupported update format for Linux.' };
          }
        } catch (err) {
          result = { ok: false, error: String((err && err.message) || err) };
        }
      }

      sendToSidecar({ t: 'hostReply', id, result });
    } catch (err) {
      sendToSidecar({ t: 'hostReply', id, error: String((err && err.message) || err) });
    }
    return;
  }

  if (msg.type === 'reply' || msg.type === 'event') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('host-message', msg);
    }
  }
}

ipcMain.on('webview-message', async (_event, msg) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'invoke') {
    const channel = msg.channel;
    const replyId = msg.replyId;
    const args = msg.args || [];

    if (channel === 'browser:navigate') {
      const [url, tabId] = args;
      const tab = getOrCreateTab(tabId);
      if (tab && url) {
        tab.view.webContents.loadURL(url).catch(() => {});
        replyToRenderer(replyId, { ok: true });
      } else {
        replyToRenderer(replyId, { ok: false, error: 'Tab or url missing' });
      }
      return;
    }

    if (channel === 'browser:devtools') {
      const [open, _url, tabId] = args;
      const tab = tabs.get(tabId);
      if (tab) {
        if (open) {
          tab.view.webContents.openDevTools({ mode: 'detach' });
        } else {
          tab.view.webContents.closeDevTools();
        }
        replyToRenderer(replyId, { ok: true });
      } else {
        replyToRenderer(replyId, { ok: false, error: 'Tab not found' });
      }
      return;
    }

    if (channel === 'browser:cdp') {
      const [tabId, cdpMethod, cdpParams] = args;
      const tab = tabs.get(tabId);
      if (tab) {
        const dbg = tab.view.webContents.debugger;
        try {
          if (!dbg.isAttached()) dbg.attach('1.3');
          const res = await dbg.sendCommand(cdpMethod, cdpParams || {});
          replyToRenderer(replyId, res);
        } catch (err) {
          replyToRenderer(replyId, null, err);
        }
      } else {
        replyToRenderer(replyId, null, new Error('Tab not found'));
      }
      return;
    }

    sendToSidecar({
      t: 'invoke',
      id: replyId,
      channel,
      args,
    });
    return;
  }

  if (msg.type === 'host-cmd') {
    const cmd = msg.cmd;
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (cmd === 'minimize') {
      mainWindow.minimize();
    } else if (cmd === 'maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (cmd === 'close') {
      mainWindow.close();
    } else if (cmd === 'browser-place') {
      placeBrowserTab(msg.tabId, msg.x, msg.y, msg.w, msg.h, msg.visible);
    } else if (cmd === 'browser-activate') {
      if (msg.tabId) {
        activeTabId = msg.tabId;
        applyBrowserPlacement();
      }
    } else if (cmd === 'browser-back') {
      const tab = tabs.get(msg.tabId);
      if (tab && tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
    } else if (cmd === 'browser-forward') {
      const tab = tabs.get(msg.tabId);
      if (tab && tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
    } else if (cmd === 'browser-reload') {
      const tab = tabs.get(msg.tabId);
      if (tab) tab.view.webContents.reload();
    } else if (cmd === 'browser-stop') {
      const tab = tabs.get(msg.tabId);
      if (tab) tab.view.webContents.stop();
    } else if (cmd === 'browser-close') {
      closeBrowserTab(msg.tabId);
    } else if (cmd === 'consume-open-path') {
      if (pendingOpenPath) {
        emitToRenderer('host:openPath', pendingOpenPath);
        pendingOpenPath = null;
      }
    }
  }
});

app.whenReady().then(() => {
  startSidecar();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#3b4252',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload-linux.cjs'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
    icon: path.join(ROOT, 'assets', 'logo.png'),
  });

  const rendererOut = path.join(ROOT, 'out', 'renderer', 'index.html');
  if (IS_DEV) {
    mainWindow.loadURL('http://127.0.0.1:5199');
  } else if (fs.existsSync(rendererOut)) {
    mainWindow.loadFile(rendererOut);
  } else {
    mainWindow.loadURL('http://127.0.0.1:5199');
  }

  mainWindow.on('resize', () => {
    applyBrowserPlacement();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (sidecar) {
      try {
        sidecar.kill();
      } catch {}
    }
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (sidecar) {
    try {
      sidecar.kill();
    } catch {}
  }
  app.quit();
});
