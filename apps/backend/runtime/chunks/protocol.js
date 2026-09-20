"use strict";
const TO_TOOL = {
  RUN: "run",
  REPLY: "reply",
  CANCEL: "cancel"
};
const TO_HOST = {
  CALL: "call",
  LOG: "log",
  DONE: "done",
  FAILED: "failed",
  READY: "ready"
};
const METHODS = {
  "fs.read": "fs.read",
  "fs.list": "fs.read",
  "fs.write": "fs.write",
  "project.files": "project",
  "project.search": "project",
  "editor.open": "editor",
  "editor.replace": "editor",
  "editor.insert": "editor",
  "ui.notify": "ui",
  "ui.output": "ui"
};
const CAPABILITIES = ["fs.read", "fs.write", "project", "editor", "ui"];
exports.CAPABILITIES = CAPABILITIES;
exports.METHODS = METHODS;
exports.TO_HOST = TO_HOST;
exports.TO_TOOL = TO_TOOL;
