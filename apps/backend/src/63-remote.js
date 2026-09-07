function remoteStoreFile() {
  return node_path.join(electron.app.getPath("userData"), "remote-profiles.json");
}

async function readRemoteProfiles() {
  try {
    const raw = await promises.readFile(remoteStoreFile(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRemoteProfiles(profiles) {
  try {
    await promises.writeFile(remoteStoreFile(), JSON.stringify(profiles, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

function normalizeRemoteProfile(input) {
  const src = input && typeof input === "object" ? input : {};
  const host = typeof src.host === "string" ? src.host.trim() : "";
  if (!host || host.startsWith("-") || /[\s]/.test(host)) return null;
  const portNum = typeof src.port === "number" ? src.port : parseInt(String(src.port ?? ""), 10);
  const user = typeof src.user === "string" ? src.user.trim() : "";
  return {
    id: typeof src.id === "string" && src.id ? src.id : `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: typeof src.name === "string" && src.name.trim() ? src.name.trim() : host,
    host,
    port: Number.isFinite(portNum) && portNum > 0 && portNum <= 65535 ? Math.floor(portNum) : 22,
    user: user.startsWith("-") ? "" : user,
    keyPath: typeof src.keyPath === "string" ? src.keyPath.trim() : "",
    cwd: typeof src.cwd === "string" ? src.cwd.trim() : "",
  };
}

function remoteSshArgs(profile, extra, batch) {
  const args = [];
  if (profile.port && profile.port !== 22) args.push("-p", String(profile.port));
  if (profile.keyPath) args.push("-i", profile.keyPath, "-o", "IdentitiesOnly=yes");
  args.push("-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3");
  if (batch) args.push("-o", "BatchMode=yes", "-o", "ConnectTimeout=12");
  args.push(profile.user ? `${profile.user}@${profile.host}` : profile.host);
  if (Array.isArray(extra)) for (const part of extra) args.push(part);
  return args;
}

function remoteShellQuote(value) {
  return `'${String(value).split("'").join("'\\''")}'`;
}

function runSsh(profile, remoteCommand, options) {
  const opts = options || {};
  return new Promise((resolve) => {
    const extra = remoteCommand ? [remoteCommand] : [];
    let child;
    try {
      child = node_child_process.spawn("ssh", remoteSshArgs(profile, extra, opts.batch !== false), {
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String((error && error.message) || error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const cap = opts.maxBytes || 8 * 1024 * 1024;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { killProcessTree(child); } catch { try { child.kill(); } catch {} }
      resolve({ code: -1, stdout, stderr: stderr || "The remote command timed out." });
    }, opts.timeout || 20000);
    child.stdout.on("data", (chunk) => { if (stdout.length < cap) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < cap) stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String((error && error.message) || error) });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code == null ? -1 : code, stdout, stderr });
    });
    if (typeof opts.input === "string") {
      try { child.stdin.end(opts.input); } catch {}
    } else {
      try { child.stdin.end(); } catch {}
    }
  });
}

function runDocker(args, options) {
  const opts = options || {};
  return new Promise((resolve) => {
    let child;
    try {
      child = node_child_process.spawn("docker", args, { windowsHide: true });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String((error && error.message) || error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      resolve({ code: -1, stdout, stderr: stderr || "The docker command timed out." });
    }, opts.timeout || 20000);
    child.stdout.on("data", (c) => { if (stdout.length < 4 * 1024 * 1024) stdout += c.toString("utf8"); });
    child.stderr.on("data", (c) => { if (stderr.length < 65536) stderr += c.toString("utf8"); });
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code: -1, stdout, stderr: String((error && error.message) || error) }); } });
    child.on("close", (code) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code: code == null ? -1 : code, stdout, stderr }); } });
    if (typeof opts.input === "string") { try { child.stdin.end(opts.input); } catch {} } else { try { child.stdin.end(); } catch {} }
  });
}

function registerRemoteHandlers() {
  electron.ipcMain.handle("docker:list", async () => {
    const result = await runDocker(["ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}"], { timeout: 15000 });
    if (result.code !== 0) {
      return { ok: false, error: /ENOENT|not recognized|not found/i.test(result.stderr) ? "Docker is not installed or not on PATH." : (result.stderr || "docker ps failed.").trim() };
    }
    const containers = [];
    for (const line of result.stdout.split("\n")) {
      const parts = line.replace(/\r$/, "").split("\t");
      if (parts.length >= 3 && parts[0]) containers.push({ id: parts[0], name: parts[1] || parts[0], image: parts[2] || "", status: parts[3] || "" });
    }
    return { ok: true, containers };
  });

  electron.ipcMain.handle("docker:exec", async (_event, id, command) => {
    if (typeof id !== "string" || !id || typeof command !== "string" || !command) return { ok: false, error: "No container command." };
    const result = await runDocker(["exec", id, "sh", "-c", command], { timeout: 60000 });
    return { ok: result.code === 0, code: result.code, stdout: result.stdout, stderr: result.stderr };
  });

  electron.ipcMain.handle("remote:list", async () => {
    return { ok: true, profiles: (await readRemoteProfiles()).map(normalizeRemoteProfile).filter(Boolean) };
  });

  electron.ipcMain.handle("remote:save", async (_event, input) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile) return { ok: false, error: "A remote profile needs a host." };
    const profiles = (await readRemoteProfiles()).map(normalizeRemoteProfile).filter(Boolean);
    const at = profiles.findIndex((p) => p.id === profile.id);
    if (at === -1) profiles.push(profile);
    else profiles[at] = profile;
    if (!(await writeRemoteProfiles(profiles))) return { ok: false, error: "The remote profile could not be saved." };
    return { ok: true, profile };
  });

  electron.ipcMain.handle("remote:remove", async (_event, id) => {
    const profiles = (await readRemoteProfiles()).map(normalizeRemoteProfile).filter(Boolean);
    if (!(await writeRemoteProfiles(profiles.filter((p) => p.id !== id)))) return { ok: false, error: "The change could not be saved." };
    return { ok: true };
  });

  electron.ipcMain.handle("remote:test", async (_event, input) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile) return { ok: false, error: "A remote profile needs a host." };
    const result = await runSsh(profile, "echo wide-remote-ok", { timeout: 15000, batch: true });
    if (result.code === 0 && result.stdout.includes("wide-remote-ok")) {
      return { ok: true, output: result.stdout.trim() };
    }
    return { ok: false, error: (result.stderr || result.stdout || "The connection failed.").trim() };
  });

  electron.ipcMain.handle("remote:exec", async (_event, input, command) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile) return { ok: false, error: "A remote profile needs a host." };
    if (typeof command !== "string" || !command.trim()) return { ok: false, error: "No command to run." };
    const result = await runSsh(profile, command, { timeout: 60000, batch: true });
    return { ok: result.code === 0, code: result.code, stdout: result.stdout, stderr: result.stderr };
  });

  electron.ipcMain.handle("remote:listDir", async (_event, input, dir) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile) return { ok: false, error: "A remote profile needs a host." };
    const target = typeof dir === "string" && dir ? dir : profile.cwd || ".";
    const result = await runSsh(profile, `ls -1ApL -- ${remoteShellQuote(target)}`, { timeout: 20000, batch: true });
    if (result.code !== 0) return { ok: false, error: (result.stderr || "Could not list that directory.").trim() };
    const entries = result.stdout
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter(Boolean)
      .map((name) => (name.endsWith("/") ? { name: name.slice(0, -1), dir: true } : { name, dir: false }));
    return { ok: true, path: target, entries };
  });

  electron.ipcMain.handle("remote:readFile", async (_event, input, filePath) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile) return { ok: false, error: "A remote profile needs a host." };
    if (typeof filePath !== "string" || !filePath) return { ok: false, error: "No file path." };
    const q = remoteShellQuote(filePath);
    const MAX = 3 * 1024 * 1024;
    const script = `f=${q}; if [ ! -f "$f" ]; then echo __WIDE_NOFILE__ 1>&2; exit 1; fi; s=$(wc -c < "$f" | tr -d ' '); echo "__WIDE_SIZE__$s"; if [ "$s" -le ${MAX} ]; then base64 < "$f"; fi`;
    const result = await runSsh(profile, script, { timeout: 40000, batch: true, maxBytes: MAX * 2 + 8192 });
    if (result.code !== 0) return { ok: false, error: (/__WIDE_NOFILE__/.test(result.stderr) ? "That file does not exist." : (result.stderr || "Could not read that file.")).trim() };
    const nl = result.stdout.indexOf("\n");
    const head = nl === -1 ? result.stdout : result.stdout.slice(0, nl);
    const sizeMatch = /__WIDE_SIZE__(\d+)/.exec(head);
    const size = sizeMatch ? Number(sizeMatch[1]) : 0;
    if (size > MAX) return { ok: true, tooLarge: true, size, content: "" };
    let buf;
    try { buf = Buffer.from((nl === -1 ? "" : result.stdout.slice(nl + 1)).replace(/\s+/g, ""), "base64"); } catch { buf = Buffer.alloc(0); }
    if (buf.includes(0)) return { ok: true, binary: true, size, content: "" };
    return { ok: true, content: buf.toString("utf8"), size };
  });

  electron.ipcMain.handle("remote:mkdir", async (_event, input, dir) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile || typeof dir !== "string" || !dir) return { ok: false, error: "No directory path." };
    const result = await runSsh(profile, `mkdir -p -- ${remoteShellQuote(dir)}`, { timeout: 20000, batch: true });
    return result.code === 0 ? { ok: true } : { ok: false, error: (result.stderr || "Could not create the directory.").trim() };
  });

  electron.ipcMain.handle("remote:newFile", async (_event, input, filePath) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile || typeof filePath !== "string" || !filePath) return { ok: false, error: "No file path." };
    const q = remoteShellQuote(filePath);
    const result = await runSsh(profile, `if [ -e ${q} ]; then echo exists 1>&2; exit 1; else : > ${q}; fi`, { timeout: 20000, batch: true });
    return result.code === 0 ? { ok: true } : { ok: false, error: (result.stderr || "Could not create the file.").trim() };
  });

  electron.ipcMain.handle("remote:delete", async (_event, input, target) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile || typeof target !== "string" || !target) return { ok: false, error: "No path." };
    const result = await runSsh(profile, `rm -rf -- ${remoteShellQuote(target)}`, { timeout: 20000, batch: true });
    return result.code === 0 ? { ok: true } : { ok: false, error: (result.stderr || "Could not delete that path.").trim() };
  });

  electron.ipcMain.handle("remote:rename", async (_event, input, from, to) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile || typeof from !== "string" || typeof to !== "string" || !from || !to) return { ok: false, error: "No paths." };
    const result = await runSsh(profile, `mv -- ${remoteShellQuote(from)} ${remoteShellQuote(to)}`, { timeout: 20000, batch: true });
    return result.code === 0 ? { ok: true } : { ok: false, error: (result.stderr || "Could not rename that path.").trim() };
  });

  electron.ipcMain.handle("remote:grep", async (_event, input, dir, query) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile || typeof query !== "string" || !query.trim()) return { ok: false, error: "No search text." };
    const where = typeof dir === "string" && dir ? dir : profile.cwd || ".";
    const cmd = `grep -rInFi --binary-files=without-match --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=venv --exclude-dir=dist --exclude-dir=build --exclude-dir=target -e ${remoteShellQuote(query)} -- ${remoteShellQuote(where)} 2>/dev/null | head -n 500`;
    const result = await runSsh(profile, cmd, { timeout: 30000, batch: true });
    const matches = [];
    for (const line of result.stdout.split("\n")) {
      const m = /^(.+?):(\d+):(.*)$/.exec(line.replace(/\r$/, ""));
      if (m) matches.push({ file: m[1], line: Number(m[2]), text: m[3].slice(0, 400) });
    }
    return { ok: true, matches };
  });

  electron.ipcMain.handle("remote:writeFile", async (_event, input, filePath, content, expectedSize) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile) return { ok: false, error: "A remote profile needs a host." };
    if (typeof filePath !== "string" || !filePath) return { ok: false, error: "No file path." };
    const q = remoteShellQuote(filePath);
    const b64 = Buffer.from(typeof content === "string" ? content : "", "utf8").toString("base64");
    const guard =
      Number.isFinite(expectedSize) && expectedSize >= 0
        ? `cur=$(wc -c < "$f" 2>/dev/null | tr -d ' '); if [ -n "$cur" ] && [ "$cur" != "${Math.floor(expectedSize)}" ]; then echo __WIDE_CONFLICT__ 1>&2; exit 3; fi; `
        : "";
    const script = `f=${q}; ${guard}t="$f.wide-tmp-$$"; base64 -d > "$t" && mv -- "$t" "$f"`;
    const result = await runSsh(profile, script, { timeout: 40000, batch: true, input: b64 });
    if (result.code === 3 || /__WIDE_CONFLICT__/.test(result.stderr)) return { ok: false, conflict: true, error: "The remote file changed since you opened it." };
    if (result.code !== 0) return { ok: false, error: (result.stderr || "Could not write that file.").trim() };
    return { ok: true };
  });
}
