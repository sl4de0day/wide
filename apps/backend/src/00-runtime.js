

"use strict";
const electron = require("electron");
const node_path = require("node:path");
const promises = require("node:fs/promises");
const node_fs = require("node:fs");
const node_child_process = require("node:child_process");
const node_util = require("node:util");
const ts = require("typescript");
const node_crypto = require("node:crypto");
const node_os = require("node:os");

let nodePty = null;
try {
  nodePty = require("@lydell/node-pty");
} catch {

}
const node_http = require("node:http");
const node_https = require("node:https");
const node_net = require("node:net");
const node_tls = require("node:tls");
const node_zlib = require("node:zlib");
const { StringDecoder } = require("node:string_decoder");

function killProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform !== "win32" || !child.pid) {
    try {
      child.kill();
    } catch {
    }
    return;
  }
  try {
    node_child_process.execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
  } catch {
    try {
      child.kill();
    } catch {
    }
  }
}

const prettier = require("prettier");
const protocol = require("./chunks/protocol--BCXEARA.js");
const IGNORED$3 =  new Set(["node_modules", ".git", "dist", "out", ".DS_Store"]);
const MAX_FILE_BYTES$1 = 4 * 1024 * 1024;
function isInside(candidate, parent) {
  const rel = node_path.relative(parent, candidate);
  return rel === "" || !rel.startsWith("..") && !node_path.isAbsolute(rel);
}
async function exists(path) {
  try {
    await promises.access(path, node_fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortEntries(entries) {
  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return nameCollator.compare(a.name, b.name);
  });
}
