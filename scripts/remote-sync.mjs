

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const noInstall = args.includes("--no-install");

let distArg = "";
const di = args.findIndex((a) => a === "--dist" || a.startsWith("--dist="));
if (di >= 0) distArg = args[di].includes("=") ? args[di].split("=")[1] : args[di + 1] || "";

const positional = args.filter((a, i) => !a.startsWith("--") && !(di >= 0 && !args[di].includes("=") && i === di + 1));
const host = positional[0];
const remotePath = positional[1];

if (!host || !remotePath) {
  fail("usage: node scripts/remote-sync.mjs <user@host> <remotePath> [--dist <dir>] [--no-install]");
}

const remote = remotePath.replace(/[/\\]+$/, "");

const dist = resolve(distArg || join(root, "dist", "wide"));

const need = [
  ["out/main/index.js", "the compiled backend"],
  ["resources", "the policy and resources"],
  ["sidecar/sidecar.cjs", "the sidecar entry"],
  ["sidecar/electron-mock.cjs", "the electron mock"],
  ["sidecar/native/index.cjs", "the native shim"],
];
for (const [rel, what] of need) {
  if (!existsSync(join(dist, rel))) {
    fail(`${what} is missing at ${join(dist, rel)}.\n    Build first: npm run package  (or pass --dist <dir>).`);
  }
}

const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const wanted = ["typescript", "@lydell/node-pty", "node-forge", "prettier"];
const deps = {};
for (const name of wanted) {
  if (rootPkg.dependencies && rootPkg.dependencies[name]) deps[name] = rootPkg.dependencies[name];
}
const remotePkg = {
  name: "wide-backend-remote",
  private: true,
  version: rootPkg.version || "0.0.0",
  description: "Wide's backend, synced to run over SSH.",
  dependencies: deps,
};
const stage = mkdtempSync(join(tmpdir(), "wide-remote-"));
writeFileSync(join(stage, "package.json"), JSON.stringify(remotePkg, null, 2));

function run(cmd, cmdArgs, label) {
  console.log(`\n  → ${label}`);
  console.log(`    ${cmd} ${cmdArgs.join(" ")}`);
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  if (result.error) fail(`${cmd} could not run: ${result.error.message}. Is OpenSSH installed and on PATH?`);
  if (result.status !== 0) fail(`${label} failed (exit ${result.status}).`);
}

console.log(`\n  Wide remote sync`);
console.log(`  host:        ${host}`);
console.log(`  remote path: ${remote}`);
console.log(`  from:        ${dist}`);

run("ssh", ["-o", "BatchMode=no", host, `mkdir -p '${remote}'`], "create the remote directory");

run(
  "scp",
  ["-r", join(dist, "out"), join(dist, "resources"), join(dist, "sidecar"), join(stage, "package.json"), `${host}:'${remote}/'`],
  "copy the backend (out, resources, sidecar, package.json)",
);

if (noInstall) {
  console.log(`\n  ⚠ --no-install: skipping npm install. Run it yourself on the remote:`);
  console.log(`    ssh ${host} "cd '${remote}' && npm install --omit=dev"`);
} else {
  run(
    "ssh",
    [host, `cd '${remote}' && npm install --omit=dev`],
    "install dependencies on the remote (typescript, node-pty, node-forge, prettier)",
  );
}

console.log(`\n  ✓ Done.\n`);
console.log(`  In Wide: Settings → Remote`);
console.log(`    · Run the backend over SSH:  on`);
console.log(`    · SSH host:    ${host}`);
console.log(`    · Remote path: ${remote}`);
console.log(`  Then relaunch Wide. The backend now runs on the remote, over SSH.`);
console.log(`\n  Notes`);
console.log(`    · Key or agent auth only — a password host cannot be used (the`);
console.log(`      connection's stdin carries the protocol, so ssh must not prompt).`);
console.log(`    · If node-pty fails to build on the remote, everything else still`);
console.log(`      works; only the terminal is unavailable there.`);
console.log(`    · Re-run this after a new build to update the remote backend.\n`);
