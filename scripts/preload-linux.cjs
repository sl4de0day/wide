'use strict';

const { ipcRenderer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 1. window.chrome.webview köprüsünü oluştur
const listeners = new Set();
ipcRenderer.on('host-message', (_event, msg) => {
  for (const fn of listeners) {
    try {
      fn({ data: msg });
    } catch (err) {
      console.error('[preload] error in message listener:', err);
    }
  }
});

window.chrome = window.chrome || {};
window.chrome.webview = {
  postMessage(data) {
    ipcRenderer.send('webview-message', data);
  },
  addEventListener(event, fn) {
    if (event === 'message') listeners.add(fn);
  },
  removeEventListener(event, fn) {
    if (event === 'message') listeners.delete(fn);
  }
};

// 2. native-host/assets içindeki shim ve scriptleri yükle
const assetsDir = path.resolve(__dirname, '..', 'native-host', 'assets');
function runAsset(filename) {
  try {
    const filePath = path.join(assetsDir, filename);
    if (fs.existsSync(filePath)) {
      const code = fs.readFileSync(filePath, 'utf8');
      const fn = new Function(code);
      fn();
    }
  } catch (err) {
    console.error(`[preload] Failed to inject ${filename}:`, err);
  }
}

runAsset('engine-preview.js');
runAsset('preload-shim.js');
runAsset('titlebar.js');
