"use strict";
const TO_TOOL = {
  /** Run one command. `{ t, runId, command, context }` */
  RUN: "run",
  /** The answer to a `CALL`. `{ t, callId, ok, value, error }` */
  REPLY: "reply",
  /** Trips the run's AbortSignal. The process is killed if it ignores it. */
  CANCEL: "cancel"
};
const TO_HOST = {
  /** The tool asks the editor to do something. `{ t, callId, method, params }` */
  CALL: "call",
  /** A line for the tool's output. `{ t, runId, level, text }` */
  LOG: "log",
  /** The command finished. `{ t, runId, result }` */
  DONE: "done",
  /** The command threw. `{ t, runId, message, stack }` */
  FAILED: "failed",
  /** The module loaded and its commands are known. `{ t, commands }` */
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
