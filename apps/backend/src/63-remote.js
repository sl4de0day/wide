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
  if (!host) return null;
  return {
    id: typeof src.id === "string" && src.id ? src.id : `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: typeof src.name === "string" && src.name.trim() ? src.name.trim() : host,
    host,
    port: Number.isFinite(src.port) && src.port > 0 ? Math.floor(src.port) : 22,
    user: typeof src.user === "string" ? src.user.trim() : "",
    keyPath: typeof src.keyPath === "string" ? src.keyPath.trim() : "",
    cwd: typeof src.cwd === "string" ? src.cwd.trim() : "",
  };
}

function remoteSshArgs(profile, extra, batch) {
  const args = [];
  if (profile.port && profile.port !== 22) args.push("-p", String(profile.port));
  if (profile.keyPath) args.push("-i", profile.keyPath);
  args.push("-o", "StrictHostKeyChecking=accept-new");
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
      try { child.kill(); } catch {}
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
    await writeRemoteProfiles(profiles);
    return { ok: true, profile };
  });

  electron.ipcMain.handle("remote:remove", async (_event, id) => {
    const profiles = (await readRemoteProfiles()).map(normalizeRemoteProfile).filter(Boolean);
    await writeRemoteProfiles(profiles.filter((p) => p.id !== id));
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
    const result = await runSsh(profile, `ls -1Ap -- ${remoteShellQuote(target)}`, { timeout: 20000, batch: true });
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
    const result = await runSsh(profile, `cat -- ${remoteShellQuote(filePath)}`, { timeout: 30000, batch: true });
    if (result.code !== 0) return { ok: false, error: (result.stderr || "Could not read that file.").trim() };
    return { ok: true, content: result.stdout };
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
    const cmd = `grep -rIni --binary-files=without-match -e ${remoteShellQuote(query)} -- ${remoteShellQuote(where)} 2>/dev/null | head -n 500`;
    const result = await runSsh(profile, cmd, { timeout: 30000, batch: true });
    const matches = [];
    for (const line of result.stdout.split("\n")) {
      const m = /^(.+?):(\d+):(.*)$/.exec(line.replace(/\r$/, ""));
      if (m) matches.push({ file: m[1], line: Number(m[2]), text: m[3].slice(0, 400) });
    }
    return { ok: true, matches };
  });

  electron.ipcMain.handle("remote:writeFile", async (_event, input, filePath, content) => {
    const profile = normalizeRemoteProfile(input);
    if (!profile) return { ok: false, error: "A remote profile needs a host." };
    if (typeof filePath !== "string" || !filePath) return { ok: false, error: "No file path." };
    const result = await runSsh(profile, `cat > ${remoteShellQuote(filePath)}`, {
      timeout: 30000,
      batch: true,
      input: typeof content === "string" ? content : "",
    });
    if (result.code !== 0) return { ok: false, error: (result.stderr || "Could not write that file.").trim() };
    return { ok: true };
  });
}
