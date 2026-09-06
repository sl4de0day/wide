'use strict';

const path = require('node:path');
const readline = require('node:readline');

const realStdout = process.stdout;
for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  console[k] = (...a) => {
    try { process.stderr.write('[backend] ' + a.map(String).join(' ') + '\n'); } catch {}
  };
}

process.resourcesPath = path.resolve(__dirname, '..', 'resources');

const Module = require('node:module');
const mock = require('./electron-mock.cjs');
const nativeJs = require('./native/index.cjs');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return mock;
  if (typeof request === 'string' && request.endsWith('wide_native.node')) return nativeJs;
  return origLoad.call(this, request, ...rest);
};

function send(obj) {
  let line;
  try {

    line = JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
  } catch (e) {

    if (obj && obj.t === 'reply' && obj.id != null) {
      try { realStdout.write(JSON.stringify({ t: 'reply', id: obj.id, error: 'Result could not be serialized: ' + String(e && e.message ? e.message : e) }) + '\n'); } catch {}
    }
    return;
  }
  try { realStdout.write(line + '\n'); } catch {}
}

const fs = require('node:fs');
const os = require('node:os');
const IPC_LOG = process.env.GRIDE_LOG_IPC
  ? path.join(os.tmpdir(), 'hc_sidecar_ipc.log') : null;
const IPC_T0 = Date.now();
function logIpc(channel, args, result, err) {
  if (!IPC_LOG) return;
  let out;
  if (err) out = 'ERR ' + String((err && err.message) || err);
  else if (Array.isArray(result)) out = 'len=' + result.length;
  else out = 'obj ' + JSON.stringify(result).slice(0, 80);
  const a0 = args && args.length ? JSON.stringify(args[0]).slice(0, 90) : '';
  const t = ('     ' + (Date.now() - IPC_T0)).slice(-6);
  try { fs.appendFileSync(IPC_LOG, t + 'ms ' + channel + ' | ' + a0 + ' -> ' + out + '\n'); } catch {}
}

const hostPending = new Map();
const HOST_REQUEST_TIMEOUT_MS = 30000;
let hostSeq = 1;
function hostRequest(method, params) {
  const id = hostSeq++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (hostPending.delete(id)) reject(new Error('The host did not answer ' + method + ' in time.'));
    }, HOST_REQUEST_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    hostPending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    send({ t: 'host', id, method, params: params || {} });
  });
}

mock.__setBridge({

  sendEvent(channel, payload) { send({ type: 'event', channel, payload: payload === undefined ? null : payload }); },
  hostRequest,
});

require(path.resolve(__dirname, '..', 'out', 'main', 'index.js'));

const ROOT_SOURCES = new Set(['dialog:openFolder', 'workspace:openRecent']);
const NEEDS_ROOT = /^(fs:|project:|search:|ts:|engine:|codeberg:)/;
let rootGate = null;

async function runInvoke(msg) {
  try {
    const result = await mock.__invoke(msg.channel, msg.args || []);
    logIpc(msg.channel, msg.args, result, null);
    send({ type: 'reply', replyId: msg.id, result: result === undefined ? null : result });
    return result;
  } catch (e) {
    logIpc(msg.channel, msg.args, null, e);
    send({ type: 'reply', replyId: msg.id, error: String((e && e.message) || e) });
    throw e;
  }
}

function dispatchInvoke(msg) {
  const ch = msg.channel;
  if (ROOT_SOURCES.has(ch)) {

    const pending = runInvoke(msg);
    rootGate = pending.then(
      function () { rootGate = null; },
      function () { rootGate = null; },
    );
    return;
  }

  if (rootGate && NEEDS_ROOT.test(ch)) {
    rootGate.then(function () { runInvoke(msg).catch(function () {}); });
    return;
  }
  runInvoke(msg).catch(function () {});
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('close', () => {
  try { mock.app.quit(); } catch {}
  process.exit(0);
});

rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.t === 'invoke') {
    dispatchInvoke(msg);
  } else if (msg.t === 'hostReply') {
    const p = hostPending.get(msg.id);
    if (p) {
      hostPending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    }
  } else if (msg.t === 'cdpEvent') {
    mock.__debuggerEmit(msg.targetId, msg.method, msg.params);
  }
});

process.stderr.write('[sidecar] ready, channels=' + mock.__channels().length + '\n');
