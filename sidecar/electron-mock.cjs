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

const ENC_MAGIC = Buffer.from('WSS1');
const ENC_CONTEXT = 'wide.safeStorage.v1';
const ENC_OPAQUE = 'The encrypted data could not be read.';

function saltFile() { return path.join(userDataDir(), '.enc-salt'); }
function masterFile() { return path.join(userDataDir(), '.enc-master'); }
function legacyKeyFile() { return path.join(userDataDir(), '.enc-key'); }
function legacyWrapFile() { return path.join(userDataDir(), '.enc-legacy'); }

function machineGuid() {
  if (process.platform !== 'win32') {
    for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try { return fs.readFileSync(file, 'utf8').trim(); } catch {}
    }
    return '';
  }
  try {
    const out = cp.execFileSync(
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'),
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const found = /MachineGuid\s+REG_\w+\s+(\S+)/i.exec(out);
    return found ? found[1] : '';
  } catch { return ''; }
}

let encSecretCache = null;
function encSecrets() {
  if (encSecretCache) return encSecretCache;
  let host = '', user = '', home = '';
  try { host = os.hostname(); } catch {}
  try { user = os.userInfo().username; } catch {}
  try { home = os.homedir(); } catch {}
  const guid = machineGuid();
  encSecretCache = guid
    ? [
        [ENC_CONTEXT, guid, '', user, home].join('\u0000'),
        [ENC_CONTEXT, guid, host, user, home].join('\u0000'),
        [ENC_CONTEXT, '', host, user, home].join('\u0000'),
      ]
    : [[ENC_CONTEXT, '', host, user, home].join('\u0000')];
  return encSecretCache;
}

function encSalt() {
  try {
    const stored = fs.readFileSync(saltFile());
    if (stored.length >= 16) return stored;
  } catch {}
  const salt = crypto.randomBytes(32);
  try {
    fs.writeFileSync(saltFile(), salt, { flag: 'wx' });
  } catch {
    try {
      const raced = fs.readFileSync(saltFile());
      if (raced.length >= 16) return raced;
    } catch {}
    throw new Error(ENC_OPAQUE);
  }
  const written = fs.readFileSync(saltFile());
  if (!written.equals(salt)) throw new Error(ENC_OPAQUE);
  return salt;
}

let masterKey = null;

async function initMasterKey() {
  if (masterKey) return masterKey;
  try {
    const stored = fs.readFileSync(masterFile(), 'utf8').trim();
    if (stored) {
      const opened = await bridge.hostRequest('crypto:unprotect', { data: stored });
      if (opened && opened.ok && typeof opened.data === 'string') {
        const key = Buffer.from(opened.data, 'base64');
        if (key.length === 32) {
          masterKey = key;
          return masterKey;
        }
      }
      return null;
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') return null;
  }

  try {
    const key = crypto.randomBytes(32);
    const sealed = await bridge.hostRequest('crypto:protect', { data: key.toString('base64') });
    if (!sealed || !sealed.ok || typeof sealed.data !== 'string') return null;
    fs.writeFileSync(masterFile(), sealed.data, 'utf8');
    masterKey = key;
    return masterKey;
  } catch {
    return null;
  }
}

const encKeyCache = [];
function encKeyAt(index) {
  let at = index;
  if (masterKey) {
    if (at === 0) return masterKey;
    at -= 1;
  }
  const secrets = encSecrets();
  if (at >= secrets.length) return null;
  if (!encKeyCache[at]) encKeyCache[at] = crypto.scryptSync(secrets[at], encSalt(), 32);
  return encKeyCache[at];
}

function sealBuffer(key, data) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([ENC_MAGIC, iv, c.getAuthTag(), enc]);
}

function openBuffer(key, iv, tag, enc) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}

function isSealed(buf) {
  return buf.length >= ENC_MAGIC.length + 28 && buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC);
}

let encStale = false;
function unsealBuffer(buf) {
  const body = buf.subarray(ENC_MAGIC.length);
  const iv = body.subarray(0, 12), tag = body.subarray(12, 28), enc = body.subarray(28);
  for (let index = 0; ; index += 1) {
    const key = encKeyAt(index);
    if (!key) break;
    try {
      const opened = openBuffer(key, iv, tag, enc);
      encStale = index > 0;
      return opened;
    } catch {}
  }
  throw new Error(ENC_OPAQUE);
}

let legacyKeyCache;
function legacyKey() {
  if (legacyKeyCache !== undefined) return legacyKeyCache;
  legacyKeyCache = null;
  try {
    const raw = fs.readFileSync(legacyKeyFile());
    if (raw.length === 32) {
      legacyKeyCache = raw;
      try {
        fs.writeFileSync(legacyWrapFile(), sealBuffer(encKeyAt(0), raw));
        fs.unlinkSync(legacyKeyFile());
      } catch {}
      return legacyKeyCache;
    }
  } catch {}
  try { legacyKeyCache = unsealBuffer(fs.readFileSync(legacyWrapFile())); } catch {}
  return legacyKeyCache;
}

function migrateLegacyKey() {
  let raw;
  try {
    raw = fs.readFileSync(legacyKeyFile());
  } catch { return; }
  if (raw.length !== 32) return;
  try {
    fs.writeFileSync(legacyWrapFile(), sealBuffer(encKeyAt(0), raw));
    fs.unlinkSync(legacyKeyFile());
    legacyKeyCache = raw;
  } catch {}
}

async function initSecrets() {
  await initMasterKey();
  try {
    migrateLegacyKey();
  } catch {}
}

const safeStorage = {
  isEncryptionAvailable() { return true; },
  encryptString(plain) {
    return sealBuffer(encKeyAt(0), Buffer.from(String(plain), 'utf8'));
  },
  decryptString(buf) {
    encStale = false;
    const b = Buffer.from(buf);
    if (isSealed(b)) return unsealBuffer(b).toString('utf8');
    const key = legacyKey();
    if (!key) throw new Error(ENC_OPAQUE);
    return openBuffer(key, b.subarray(0, 12), b.subarray(12, 28), b.subarray(28)).toString('utf8');
  },
  isLegacyEncrypted(buf) { return !isSealed(Buffer.from(buf)); },
  isStaleSeal() { return encStale; },
};

function userDataDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const dir = path.join(base, 'wide');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}
const appListeners = new Map();
let quitting = false;
const app = {
  whenReady() { return Promise.resolve(); },
  on(event, fn) {
    if (typeof fn !== 'function') return app;
    if (!appListeners.has(event)) appListeners.set(event, []);
    appListeners.get(event).push(fn);
    return app;
  },
  emit(event, ...args) {
    for (const fn of appListeners.get(event) || []) {
      try { fn(...args); } catch {}
    }
    return app;
  },
  quit() {
    if (quitting) return;
    quitting = true;
    app.emit('before-quit');
    process.exit(0);
  },
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
  __initSecrets: initSecrets,
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
