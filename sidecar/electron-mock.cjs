'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');

let bridge = {
  sendEvent() {},
  hostRequest() { return Promise.resolve(null); },
};
function setBridge(b) { bridge = b; }

const projectRoot = path.resolve(__dirname, '..');

const handlers = new Map();
const ipcMain = {
  handle(channel, listener) { handlers.set(channel, listener); },
  removeHandler(channel) { handlers.delete(channel); },
  on() {},
};

function makeDebugger(targetId) {
  let attached = false;
  const listeners = new Set();
  const dbg = {
    attach() { attached = true; bridge.hostRequest('cdp:attach', { targetId }); },
    detach() { attached = false; bridge.hostRequest('cdp:detach', { targetId }); },
    isAttached() { return attached; },
    on(ev, fn) { if (ev === 'message') listeners.add(fn); },
    async sendCommand(method, params) {
      return bridge.hostRequest('cdp:send', { targetId, method, params: params || {} });
    },
    __emit(method, params) { for (const fn of listeners) fn({}, method, params); },
  };
  return dbg;
}

const webContentsById = new Map();
function makeWebContents(id) {
  const wc = {
    id,
    send(channel, payload) { bridge.sendEvent(channel, payload); },
    executeJavaScript(code) { return bridge.hostRequest('webview:eval', { code }); },
    on() {}, once() {},
    setWindowOpenHandler() {},
    isDestroyed() { return false; },
    debugger: makeDebugger(id),
  };
  webContentsById.set(id, wc);
  return wc;
}

const mainWebContents = makeWebContents(1);

const webContents = {
  fromId(id) { return webContentsById.get(id) || makeWebContents(id); },
  from(id) { return this.fromId(id); },
};

const allWindows = [];
class BrowserWindow {
  constructor(opts = {}) {
    this._opts = opts;
    this.webContents = mainWebContents;
    this._destroyed = false;
    allWindows.push(this);
  }
  static getAllWindows() { return allWindows.filter((w) => !w._destroyed); }
  static fromWebContents() { return allWindows[0] || mainBrowserWindow; }
  loadFile() { return Promise.resolve(); }
  loadURL() { return Promise.resolve(); }
  on() { return this; }
  once() { return this; }
  show() {}
  focus() {}
  setTitle(title) { bridge.hostRequest('window:setTitle', { title }); }
  isDestroyed() { return this._destroyed; }
  destroy() { this._destroyed = true; }
  webContentsId() { return this.webContents.id; }
}
const mainBrowserWindow = new BrowserWindow();

const dialog = {
  async showOpenDialog(_window, options) {
    return bridge.hostRequest('dialog:showOpenDialog', options || {});
  },
};

const shell = {
  openExternal(url) { bridge.hostRequest('shell:openExternal', { url }); return Promise.resolve(); },
  showItemInFolder(p) { bridge.hostRequest('shell:showItemInFolder', { path: p }); },
  async trashItem(p) { return bridge.hostRequest('shell:trashItem', { path: p }); },
};

function keyFile() { return path.join(userDataDir(), '.enc-key'); }
function encKey() {
  const kf = keyFile();
  try { return fs.readFileSync(kf); } catch {}
  const k = crypto.randomBytes(32);
  try { fs.mkdirSync(path.dirname(kf), { recursive: true }); fs.writeFileSync(kf, k); } catch {}
  return k;
}
const safeStorage = {
  isEncryptionAvailable() { return true; },
  encryptString(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
    const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]);
  },
  decryptString(buf) {
    const b = Buffer.from(buf);
    const iv = b.subarray(0, 12), tag = b.subarray(12, 28), enc = b.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  },
};

function userDataDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const dir = path.join(base, 'wide');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}
const app = {
  whenReady() { return Promise.resolve(); },
  on() { return app; },
  quit() {},
  getAppPath() { return projectRoot; },
  getPath(name) {
    switch (name) {
      case 'userData': return userDataDir();
      case 'appData': return process.env.APPDATA || userDataDir();
      case 'temp': return os.tmpdir();
      case 'home': return os.homedir();
      case 'exe': return process.execPath;
      default: return userDataDir();
    }
  },
};

const utilityProcess = {
  fork(entry, args = [], options = {}) {
    const wrapper = path.join(__dirname, 'toolhost-wrapper.cjs');
    const child = cp.fork(wrapper, [entry, ...args], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: process.env,
    });

    return {
      pid: child.pid,
      stdout: child.stdout,
      stderr: child.stderr,
      postMessage(message) { try { child.send(message); } catch {} },
      on(ev, fn) {
        if (ev === 'message') child.on('message', (m) => fn(m));
        else if (ev === 'exit') child.on('exit', (code) => fn(code));
        else if (ev === 'spawn') child.on('spawn', fn);
        else child.on(ev, fn);
        return this;
      },
      once(ev, fn) { child.once(ev, fn); return this; },
      kill() { try { child.kill(); } catch {} },
    };
  },
};

module.exports = {
  app, BrowserWindow, dialog, ipcMain, safeStorage, shell, utilityProcess,
  webContents,

  hostRequest(method, params) { return bridge.hostRequest(method, params || {}); },

  __setBridge: setBridge,
  __invoke(channel, args) {
    const listener = handlers.get(channel);
    if (!listener) return Promise.reject(new Error('No handler for ' + channel));
    return Promise.resolve(listener({ sender: mainWebContents }, ...(args || [])));
  },
  __hasHandler(channel) { return handlers.has(channel); },
  __channels() { return [...handlers.keys()]; },
  __debuggerEmit(targetId, method, params) {
    const wc = webContentsById.get(targetId);
    if (wc && wc.debugger && wc.debugger.__emit) wc.debugger.__emit(method, params);
  },
  __mainWebContents: mainWebContents,
};
