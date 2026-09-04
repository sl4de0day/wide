'use strict';

const path = require('node:path');

const listeners = new Set();
process.parentPort = {
  postMessage(message) { try { process.send(message); } catch {} },
  on(ev, fn) { if (ev === 'message') listeners.add(fn); },
  once(ev, fn) { if (ev === 'message') listeners.add(fn); },
  removeListener(ev, fn) { listeners.delete(fn); },
  start() {},
};

process.on('message', (m) => { for (const fn of listeners) fn({ data: m }); });

require(path.resolve(__dirname, '..', 'out', 'main', 'toolHost.js'));
