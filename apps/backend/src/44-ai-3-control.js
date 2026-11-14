const aiPersistentTerminals = new Map();
let aiPersistentTermSeq = 1;
let aiOastPayloadSeq = 1;
const aiLastUiState = {
  activePanel: "",
  activeFile: "",
  language: "en",
};

async function aiControlInvoke(channel, ...args) {
  if (typeof electron.__invoke === "function") {
    try {
      return await electron.__invoke(channel, args);
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  }
  return { ok: false, error: `IPC channel ${channel} is unavailable in this runtime.` };
}

function aiEmitToolSync(send, target, detail = {}) {
  const payload = { type: "tool_sync", target, ...detail };
  if (typeof send === "function") {
    try { send(payload); } catch {}
  }
  try {
    if (typeof broadcast === "function") broadcast("ai:event", payload);
  } catch {}
}

function aiPitcherEnvFilePath(root) {
  if (root && typeof root === "string") {
    return node_path.join(root, ".wide", "pitcher-env.json");
  }
  return node_path.join(electron.app.getPath("userData"), "pitcher-env.json");
}

async function aiReadPitcherEnvStore(root) {
  const file = aiPitcherEnvFilePath(root);
  try {
    const raw = JSON.parse(await promises.readFile(file, "utf8"));
    return {
      environments: Array.isArray(raw?.environments) ? raw.environments : [],
      globals: Array.isArray(raw?.globals) ? raw.globals : [],
      activeId: typeof raw?.activeId === "string" ? raw.activeId : null,
    };
  } catch {
    return { environments: [], globals: [], activeId: null };
  }
}

async function aiWritePitcherEnvStore(root, state) {
  const file = aiPitcherEnvFilePath(root);
  await promises.mkdir(node_path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function aiBuildMergedPitcherVars(store, overrideEnv = null) {
  const vars = {};
  for (const v of store.globals || []) {
    if (v && v.enabled !== false && v.key) vars[String(v.key)] = String(v.value ?? "");
  }
  const active = (store.environments || []).find((e) => e && e.id === store.activeId);
  if (active && Array.isArray(active.vars)) {
    for (const v of active.vars) {
      if (v && v.enabled !== false && v.key) vars[String(v.key)] = String(v.value ?? "");
    }
  }
  if (overrideEnv && typeof overrideEnv === "object" && !Array.isArray(overrideEnv)) {
    for (const [k, v] of Object.entries(overrideEnv)) {
      if (k) vars[String(k)] = String(v ?? "");
    }
  }
  return vars;
}

function aiSubstituteEnvVars(text, vars) {
  if (typeof text !== "string" || !text.includes("{{")) return text;
  return text.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}

function aiMaskPitcherStoreForDisplay(store) {
  const maskVars = (list) =>
    (list || []).map((v) => ({
      key: String(v.key || ""),
      value: v.secret ? "[SECRET]" : String(v.value ?? ""),
      enabled: v.enabled !== false,
      secret: Boolean(v.secret),
    }));
  return {
    activeId: store.activeId,
    globals: maskVars(store.globals),
    environments: (store.environments || []).map((e) => ({
      id: e.id,
      name: e.name,
      vars: maskVars(e.vars),
    })),
  };
}

async function aiExecutePitcherEnv(root, input = {}, send) {
  const act = String(input.action || "list").toLowerCase();
  const store = await aiReadPitcherEnvStore(root);

  if (act === "list") {
    return JSON.stringify({ ok: true, ...aiMaskPitcherStoreForDisplay(store) }, null, 2);
  }

  if (act === "get") {
    const key = String(input.key || "").trim();
    if (!key) return "pitcher_env get requires `key`.";
    const merged = aiBuildMergedPitcherVars(store);
    const active = (store.environments || []).find((e) => e && e.id === store.activeId);
    const isSecret =
      (active?.vars || []).some((v) => v.key === key && v.secret) ||
      (store.globals || []).some((v) => v.key === key && v.secret);
    const exists = Object.prototype.hasOwnProperty.call(merged, key);
    return JSON.stringify(
      { ok: true, key, exists, value: exists ? (isSecret ? "[SECRET]" : merged[key]) : null },
      null,
      2
    );
  }

  if (act === "create_env") {
    const name = String(input.name || "").trim() || `Environment ${(store.environments?.length || 0) + 1}`;
    const id = `env-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    store.environments.push({ id, name, vars: [] });
    if (input.select !== false) store.activeId = id;
    await aiWritePitcherEnvStore(root, store);
    aiEmitToolSync(send, "pitcher_env", { state: store });
    return JSON.stringify({ ok: true, created: { id, name }, activeId: store.activeId }, null, 2);
  }

  if (act === "select_env") {
    const envId = String(input.envId || input.id || "").trim();
    const byName = String(input.name || "").trim().toLowerCase();
    const found = (store.environments || []).find(
      (e) => e && (e.id === envId || (byName && String(e.name || "").toLowerCase() === byName))
    );
    if (!found && envId !== "none") return "Matching environment not found.";
    store.activeId = envId === "none" ? null : found.id;
    await aiWritePitcherEnvStore(root, store);
    aiEmitToolSync(send, "pitcher_env", { state: store });
    return JSON.stringify({ ok: true, activeId: store.activeId }, null, 2);
  }

  if (act === "set") {
    const key = String(input.key || "").trim();
    if (!key) return "pitcher_env set requires `key`.";
    const value = String(input.value ?? "");
    const secret = Boolean(input.secret);
    const scope = String(input.scope || "environment").toLowerCase();
    if (scope === "globals" || scope === "global") {
      const idx = store.globals.findIndex((v) => v && v.key === key);
      const entry = { key, value, enabled: true, secret };
      if (idx >= 0) store.globals[idx] = entry;
      else store.globals.push(entry);
    } else {
      let targetEnv = (store.environments || []).find((e) => e && e.id === store.activeId);
      if (!targetEnv) {
        targetEnv = { id: `env-${Date.now().toString(36)}`, name: "Default", vars: [] };
        store.environments.push(targetEnv);
        store.activeId = targetEnv.id;
      }
      if (!Array.isArray(targetEnv.vars)) targetEnv.vars = [];
      const idx = targetEnv.vars.findIndex((v) => v && v.key === key);
      const entry = { key, value, enabled: true, secret };
      if (idx >= 0) targetEnv.vars[idx] = entry;
      else targetEnv.vars.push(entry);
    }
    await aiWritePitcherEnvStore(root, store);
    aiEmitToolSync(send, "pitcher_env", { state: store });
    return JSON.stringify({ ok: true, scope, key, secret }, null, 2);
  }

  if (act === "unset") {
    const key = String(input.key || "").trim();
    if (!key) return "pitcher_env unset requires `key`.";
    const scope = String(input.scope || "environment").toLowerCase();
    if (scope === "globals" || scope === "global") {
      store.globals = store.globals.filter((v) => v && v.key !== key);
    } else {
      const active = (store.environments || []).find((e) => e && e.id === store.activeId);
      if (active && Array.isArray(active.vars)) {
        active.vars = active.vars.filter((v) => v && v.key !== key);
      }
    }
    await aiWritePitcherEnvStore(root, store);
    aiEmitToolSync(send, "pitcher_env", { state: store });
    return JSON.stringify({ ok: true, scope, removed: key }, null, 2);
  }

  return `Unknown pitcher_env action "${act}".`;
}

async function aiExecutePitcherSend(root, input = {}, send) {
  const store = await aiReadPitcherEnvStore(root);
  const vars = aiBuildMergedPitcherVars(store, input.env);
  const rawUrl = aiSubstituteEnvVars(String(input.url ?? "").trim(), vars);
  if (!rawUrl) return "pitcher_send needs a valid `url`.";
  const target = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
  const method = String(input.method || "GET").trim().toUpperCase();

  let headerPairs = [];
  if (Array.isArray(input.headers)) {
    headerPairs = input.headers
      .filter((pair) => Array.isArray(pair) && pair.length >= 2)
      .map(([k, v]) => [String(k).trim(), aiSubstituteEnvVars(String(v ?? ""), vars)]);
  } else if (input.headers && typeof input.headers === "object") {
    headerPairs = Object.entries(input.headers)
      .filter(([k]) => String(k || "").trim())
      .map(([k, v]) => [String(k).trim(), aiSubstituteEnvVars(String(v ?? ""), vars)]);
  }

  let bodyStr = null;
  if (input.body !== undefined && input.body !== null) {
    bodyStr = typeof input.body === "string" ? aiSubstituteEnvVars(input.body, vars) : JSON.stringify(input.body);
  }

  let vaultApplied = "";
  if (input.vaultId || input.vaultName) {
    const vault = await readVault();
    const idTarget = String(input.vaultId || "").trim();
    const nameTarget = String(input.vaultName || "").trim().toLowerCase();
    const entry = (vault.entries || []).find(
      (e) => e && (e.id === idTarget || (nameTarget && String(e.name || "").toLowerCase() === nameTarget))
    );
    if (!entry) return `Vault credential "${input.vaultId || input.vaultName}" not found.`;
    const extra = vaultHeaders(entry);
    for (const [hk, hv] of extra) {
      headerPairs = headerPairs.filter(([k]) => k.toLowerCase() !== hk.toLowerCase());
      headerPairs.push([hk, hv]);
    }
    vaultApplied = entry.name || entry.id;
  }

  let res;
  if (typeof sendOnce === "function") {
    res = await sendOnce(target, method, headerPairs, bodyStr, HTTP_MAX_REDIRECTS, {
      insecure: input.insecure !== false,
      bodyBase64: Boolean(input.bodyBase64),
    });
  } else {
    res = await aiControlInvoke("http:send", target, method, headerPairs, bodyStr, {
      insecure: input.insecure !== false,
      bodyBase64: Boolean(input.bodyBase64),
    });
  }

  if (!res?.ok) {
    return JSON.stringify({ ok: false, method, url: target, error: res?.error || "Request failed." }, null, 2);
  }

  aiEmitToolSync(send, "pitcher", {
    request: { method, url: res.url || target, status: res.status, ms: res.ms, bytes: res.bytes },
  });
  if (input.openUi) {
    if (typeof send === "function") send({ type: "open_tool", tool: "pitcher" });
  }

  const maxBody = 32 * 1024;
  const rawBody = String(res.body ?? "");
  return JSON.stringify(
    {
      ok: true,
      method,
      url: res.url || target,
      status: res.status,
      statusText: res.statusText || "",
      ms: res.ms,
      bytes: res.bytes,
      truncated: Boolean(res.truncated || rawBody.length > maxBody),
      vaultApplied: vaultApplied || undefined,
      headers: Object.fromEntries(res.headers || []),
      body: rawBody.length > maxBody ? `${rawBody.slice(0, maxBody)}\n... [truncated]` : rawBody,
    },
    null,
    2
  );
}

async function aiExecuteOastControl(input = {}, send) {
  const act = String(input.action || "status").toLowerCase();
  if (act === "status") {
    const res = await aiControlInvoke("oast:status");
    return JSON.stringify(res, null, 2);
  }
  if (act === "start_builtin") {
    const res = await aiControlInvoke("oast:startBuiltin");
    aiEmitToolSync(send, "oast", { status: res });
    return JSON.stringify(res, null, 2);
  }
  if (act === "start") {
    const res = await aiControlInvoke("oast:start", input.server || "", input.token || "");
    aiEmitToolSync(send, "oast", { status: res });
    return JSON.stringify(res, null, 2);
  }
  if (act === "stop") {
    const res = await aiControlInvoke("oast:stop");
    aiEmitToolSync(send, "oast", { status: { running: false, domain: "" } });
    return JSON.stringify(res, null, 2);
  }
  if (act === "new_payload") {
    let st = await aiControlInvoke("oast:status");
    if (!st?.running || !st?.domain) {
      st = await aiControlInvoke("oast:startBuiltin");
    }
    if (!st?.running || !st?.domain) return JSON.stringify({ ok: false, error: st?.error || "OAST server not running." }, null, 2);
    const id = `w${Date.now().toString(36)}${(aiOastPayloadSeq++).toString(36)}`;
    const isLocal = String(st.domain).startsWith("127.0.0.1") || String(st.domain).includes(":");
    const url = isLocal ? `http://${st.domain}/${id}` : `http://${id}.${st.domain}`;
    const host = isLocal ? st.domain : `${id}.${st.domain}`;
    return JSON.stringify({ ok: true, id, host, url, server: st.server || "built-in" }, null, 2);
  }
  return `Unknown oast_control action "${act}".`;
}

function aiExecuteOastPoll(input = {}) {
  const limit = Number(input.limit) || 50;
  const clear = Boolean(input.clear);
  const items = typeof oastPollInteractions === "function" ? oastPollInteractions(limit, clear) : [];
  return JSON.stringify({ ok: true, count: items.length, interactions: items }, null, 2);
}

async function aiExecuteVaultListRefs() {
  const vault = await readVault();
  const entries = (vault.entries || []).map((e) => vaultPublic(e));
  return JSON.stringify({ ok: true, count: entries.length, entries }, null, 2);
}

async function aiExecuteFindingsQuery(root, input = {}) {
  if (!root) return "findings_query requires an open project workspace.";
  let exported = await aiControlInvoke("security:export", root, "json");
  if (!exported?.ok && input.scan !== false) {
    await aiControlInvoke("security:scanProject", root);
    exported = await aiControlInvoke("security:export", root, "json");
  }
  let scanFindings = [];
  let suppressed = 0;
  let baselineSkipped = 0;
  if (exported?.ok && exported.text) {
    try {
      const parsed = JSON.parse(exported.text);
      scanFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
      suppressed = Number(parsed.suppressed || 0);
      baselineSkipped = Number(parsed.baselineSkipped || 0);
    } catch {}
  }

  let manualFindings = [];
  try {
    const manualRaw = JSON.parse(await promises.readFile(node_path.join(root, ".wide", "findings.json"), "utf8"));
    if (Array.isArray(manualRaw)) manualFindings = manualRaw;
  } catch {}

  const severityFilter = input.severity ? String(input.severity).toLowerCase() : "";
  const ruleFilter = input.ruleId ? String(input.ruleId).toLowerCase() : "";
  const fileFilter = input.file ? String(input.file).toLowerCase() : "";
  const queryFilter = input.query ? String(input.query).toLowerCase() : "";
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));

  const filterFn = (f) => {
    if (severityFilter && String(f.severity || "").toLowerCase() !== severityFilter) return false;
    if (ruleFilter && !String(f.ruleId || "").toLowerCase().includes(ruleFilter)) return false;
    if (fileFilter && !String(f.file || f.location || "").toLowerCase().includes(fileFilter)) return false;
    if (queryFilter) {
      const hay = `${f.ruleId || ""} ${f.title || ""} ${f.message || ""} ${f.detail || ""} ${f.file || ""}`.toLowerCase();
      if (!hay.includes(queryFilter)) return false;
    }
    return true;
  };

  const filteredScan = scanFindings.filter(filterFn).slice(0, limit).map((f) => ({
    ruleId: f.ruleId,
    severity: f.severity,
    confidence: f.confidence,
    cwe: f.cwe || "",
    file: node_path.relative(root, String(f.file || "")).replace(/\\/g, "/"),
    line: f.line,
    message: f.message,
  }));

  const filteredManual = manualFindings.filter(filterFn).slice(0, limit);
  return JSON.stringify(
    {
      ok: true,
      totalScanFindings: scanFindings.length,
      matchedScanFindings: filteredScan.length,
      suppressed,
      baselineSkipped,
      findings: filteredScan,
      manualFindings: filteredManual,
    },
    null,
    2
  );
}

async function aiExecuteFindingsBaseline(root, input = {}) {
  if (!root) return "findings_baseline requires an open project workspace.";
  const act = String(input.action || "set").toLowerCase();
  if (act === "set" || act === "clear") {
    const res = await aiControlInvoke("security:baseline", root, act);
    return JSON.stringify(res, null, 2);
  }
  if (act === "export") {
    const format = input.format === "json" ? "json" : "sarif";
    const res = await aiControlInvoke("security:export", root, format);
    if (res?.ok && input.outPath) {
      const resolved = aiResolvePath(root, input.outPath);
      if (!resolved.error) {
        await promises.mkdir(node_path.dirname(resolved.path), { recursive: true });
        await writeFileAtomic(resolved.path, res.text || "", "utf8");
        return JSON.stringify({ ok: true, format, count: res.count, savedTo: resolved.relative }, null, 2);
      }
    }
    if (res?.ok && res.text && res.text.length > 24000) {
      return JSON.stringify({ ok: true, format, count: res.count, preview: `${res.text.slice(0, 24000)}\n... [truncated]` }, null, 2);
    }
    return JSON.stringify(res, null, 2);
  }
  return `Unknown findings_baseline action "${act}".`;
}

async function aiExecuteTerminalSession(root, input = {}, send) {
  const act = String(input.action || "list").toLowerCase();

  if (act === "list") {
    const list = [];
    for (const [id, s] of aiPersistentTerminals.entries()) {
      list.push({
        id,
        label: s.label,
        cwd: s.cwd,
        alive: !s.exited,
        exitCode: s.exitCode,
        bufferedBytes: s.output.length,
        unreadBytes: Math.max(0, s.output.length - s.readOffset),
      });
    }
    return JSON.stringify({ ok: true, sessions: list }, null, 2);
  }

  if (act === "start") {
    if (aiPersistentTerminals.size >= 8) {
      return "Too many persistent terminal sessions (max 8). Close an unused session first.";
    }
    const cwd = input.cwd ? (aiResolvePath(root, input.cwd).path || root || process.cwd()) : (root || process.cwd());
    const choice = input.shell ? String(input.shell).toLowerCase() : undefined;
    const spec = typeof shellFor === "function" ? shellFor(cwd, choice) : {
      file: process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/bash"),
      args: [],
      label: process.platform === "win32" ? "cmd" : "bash",
    };

    const id = `term-${aiPersistentTermSeq++}`;
    const entry = {
      id,
      label: spec.label || spec.file,
      cwd: spec.cwd ?? cwd,
      output: "",
      readOffset: 0,
      exited: false,
      exitCode: null,
      write: null,
      kill: null,
    };

    const appendOutput = (chunk) => {
      entry.output += String(chunk);
      if (entry.output.length > 262144) {
        const drop = entry.output.length - 262144;
        entry.output = entry.output.slice(drop);
        entry.readOffset = Math.max(0, entry.readOffset - drop);
      }
    };

    if (nodePty) {
      const ptyChild = nodePty.spawn(spec.file, spec.args, {
        name: "xterm-256color",
        cols: Number(input.cols) || 120,
        rows: Number(input.rows) || 32,
        cwd: entry.cwd,
        env: { ...process.env, TERM: "xterm-256color" },
      });
      ptyChild.onData(appendOutput);
      ptyChild.onExit(({ exitCode }) => {
        entry.exited = true;
        entry.exitCode = exitCode;
      });
      entry.write = (data) => ptyChild.write(data);
      entry.kill = () => { try { killProcessTree(ptyChild); } catch { try { ptyChild.kill(); } catch {} } };
    } else {
      const child = node_child_process.spawn(spec.file, spec.args, {
        cwd: entry.cwd,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdout.on("data", (d) => appendOutput(d.toString("utf8")));
      child.stderr.on("data", (d) => appendOutput(d.toString("utf8")));
      child.on("close", (code) => {
        entry.exited = true;
        entry.exitCode = code;
      });
      entry.write = (data) => child.stdin.write(data);
      entry.kill = () => { try { killProcessTree(child); } catch { try { child.kill(); } catch {} } };
    }

    aiPersistentTerminals.set(id, entry);
    if (input.command) {
      const cmdText = String(input.command);
      const risk = aiAssessCommandRisk(cmdText);
      if (risk.destructive) {
        const perm = await aiRequestPermission(send, {
          title: "Destructive command in terminal_session",
          detail: risk.reason,
          command: cmdText,
          tool: "terminal_session",
        });
        if (!perm?.allowed) {
          entry.kill();
          aiPersistentTerminals.delete(id);
          return `Blocked by user confirmation policy (${risk.reason}).`;
        }
      }
      entry.write(cmdText.endsWith("\n") ? cmdText : `${cmdText}\n`);
    }
    const waitMs = Math.max(100, Math.min(5000, Number(input.waitMs) || 600));
    await new Promise((r) => setTimeout(r, waitMs));
    const slice = entry.output.slice(entry.readOffset);
    entry.readOffset = entry.output.length;
    return JSON.stringify(
      { ok: true, id, label: entry.label, cwd: entry.cwd, alive: !entry.exited, output: slice },
      null,
      2
    );
  }

  const sessionId = String(input.id || "").trim();
  const entry = aiPersistentTerminals.get(sessionId);
  if (!entry) return `Terminal session "${sessionId}" not found.`;

  if (act === "write") {
    const data = String(input.data ?? input.command ?? "");
    if (!data) return "terminal_session write requires `data` or `command`.";
    const risk = aiAssessCommandRisk(data);
    if (risk.destructive) {
      const perm = await aiRequestPermission(send, {
        title: "Destructive command in terminal_session",
        detail: risk.reason,
        command: data,
        tool: "terminal_session",
      });
      if (!perm?.allowed) {
        return `Blocked by user confirmation policy (${risk.reason}).`;
      }
    }
    if (entry.exited) return `Terminal session "${sessionId}" has already exited (code ${entry.exitCode}).`;
    const newline = input.appendNewline !== false && !data.endsWith("\n") && !data.endsWith("\r");
    entry.write(newline ? `${data}\n` : data);
    const waitMs = Math.max(0, Math.min(8000, Number(input.waitMs) || 800));
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    const slice = entry.output.slice(entry.readOffset);
    entry.readOffset = entry.output.length;
    return JSON.stringify({ ok: true, id: sessionId, alive: !entry.exited, output: slice }, null, 2);
  }

  if (act === "read") {
    const fromOffset = input.all ? 0 : entry.readOffset;
    const text = entry.output.slice(fromOffset);
    entry.readOffset = entry.output.length;
    return JSON.stringify({ ok: true, id: sessionId, alive: !entry.exited, exitCode: entry.exitCode, output: text }, null, 2);
  }

  if (act === "close" || act === "kill") {
    entry.kill?.();
    aiPersistentTerminals.delete(sessionId);
    return JSON.stringify({ ok: true, closed: sessionId }, null, 2);
  }

  return `Unknown terminal_session action "${act}".`;
}

async function aiExecuteEngineControl(root, input = {}, send) {
  const act = String(input.action || "status").toLowerCase();
  if (act === "status") {
    const res = await aiControlInvoke("engine:status");
    return JSON.stringify(res, null, 2);
  }
  if (act === "entries") {
    if (!root) return "engine_control entries requires an open workspace.";
    const res = await aiControlInvoke("engine:entries", root);
    return JSON.stringify(res, null, 2);
  }
  if (act === "start") {
    if (!root) return "engine_control start requires an open workspace.";
    const res = await aiControlInvoke("engine:start", root, String(input.directory || ""));
    aiEmitToolSync(send, "engine", { status: res?.status || res });
    return JSON.stringify(res, null, 2);
  }
  if (act === "stop") {
    const res = await aiControlInvoke("engine:stop");
    aiEmitToolSync(send, "engine", { status: res?.status || { running: false } });
    return JSON.stringify(res, null, 2);
  }
  if (act === "reload") {
    const res = await aiControlInvoke("engine:reload", String(input.path || ""));
    return JSON.stringify(res, null, 2);
  }
  return `Unknown engine_control action "${act}".`;
}

async function aiExecuteLspNavigate(root, input = {}) {
  const act = String(input.action || "definition").toLowerCase();
  if (!root) return "lsp_navigate requires an open workspace.";
  const fileArg = String(input.path || input.file || "").trim();
  const line = Math.max(0, (Number(input.line) || 1) - (input.zeroBased ? 0 : 1));
  const character = Math.max(0, Number(input.character ?? input.column) || 0);

  let absPath = "";
  if (fileArg) {
    const resolved = aiResolvePath(root, fileArg);
    if (resolved.error) return resolved.error;
    absPath = resolved.path;
    try {
      const content = await promises.readFile(absPath, "utf8");
      await aiControlInvoke("lsp:open", root, absPath, content);
    } catch (error) {
      return `Could not open ${fileArg} for LSP: ${String(error.message || error)}`;
    }
  }

  if (act === "definition") {
    if (!absPath) return "lsp_navigate definition requires `path`.";
    const res = await aiControlInvoke("lsp:definition", absPath, line, character);
    return JSON.stringify(res, null, 2);
  }
  if (act === "references") {
    if (!absPath) return "lsp_navigate references requires `path`.";
    const res = await aiControlInvoke("lsp:references", absPath, line, character);
    return JSON.stringify(res, null, 2);
  }
  if (act === "hover") {
    if (!absPath) return "lsp_navigate hover requires `path`.";
    const res = await aiControlInvoke("lsp:hover", absPath, line, character);
    return JSON.stringify(res, null, 2);
  }
  if (act === "symbols" || act === "document_symbols") {
    if (!absPath) return "lsp_navigate symbols requires `path`.";
    const res = await aiControlInvoke("lsp:documentSymbol", absPath);
    return JSON.stringify(res, null, 2);
  }
  if (act === "workspace_symbols") {
    if (!absPath) return "lsp_navigate workspace_symbols requires a reference `path` inside the workspace.";
    const res = await aiControlInvoke("lsp:workspaceSymbol", absPath, String(input.query || ""));
    return JSON.stringify(res, null, 2);
  }
  if (act === "completion") {
    if (!absPath) return "lsp_navigate completion requires `path`.";
    const res = await aiControlInvoke("lsp:completion", absPath, line, character);
    return JSON.stringify(res, null, 2);
  }
  if (act === "code_actions") {
    if (!absPath) return "lsp_navigate code_actions requires `path`.";
    const res = await aiControlInvoke("lsp:codeActions", absPath, line, character, line, character, input.codes || []);
    return JSON.stringify(res, null, 2);
  }
  return `Unknown lsp_navigate action "${act}".`;
}

async function aiExecuteDebugControl(root, input = {}) {
  const act = String(input.action || "").toLowerCase();
  if (!act) return "debug_control requires `action`.";
  if (act === "start") {
    const file = input.file ? (aiResolvePath(root, input.file).path || input.file) : "";
    const bps = Array.isArray(input.breakpoints) ? input.breakpoints : [];
    const res = await aiControlInvoke("debug:start", root || process.cwd(), file, bps);
    return JSON.stringify(res, null, 2);
  }
  if (act === "start_browser") {
    const bps = Array.isArray(input.breakpoints) ? input.breakpoints : [];
    const res = await aiControlInvoke("debug:startBrowser", bps, root || "");
    return JSON.stringify(res, null, 2);
  }
  if (act === "stop") return JSON.stringify(await aiControlInvoke("debug:stop"), null, 2);
  if (act === "resume") return JSON.stringify(await aiControlInvoke("debug:resume"), null, 2);
  if (act === "step_over") return JSON.stringify(await aiControlInvoke("debug:stepOver"), null, 2);
  if (act === "step_into") return JSON.stringify(await aiControlInvoke("debug:stepInto"), null, 2);
  if (act === "step_out") return JSON.stringify(await aiControlInvoke("debug:stepOut"), null, 2);
  if (act === "pause") return JSON.stringify(await aiControlInvoke("debug:pause"), null, 2);
  if (act === "evaluate") {
    const res = await aiControlInvoke("debug:evaluate", input.callFrameId || null, String(input.expression || ""));
    return JSON.stringify(res, null, 2);
  }
  if (act === "properties") {
    const res = await aiControlInvoke("debug:properties", String(input.objectId || ""));
    return JSON.stringify(res, null, 2);
  }
  if (act === "set_breakpoint") {
    const file = input.file ? (aiResolvePath(root, input.file).path || input.file) : "";
    const res = await aiControlInvoke(
      "debug:setBreakpoint",
      file,
      Math.max(1, Number(input.line) || 1),
      input.enabled !== false,
      input.id || null,
      input.condition || ""
    );
    return JSON.stringify(res, null, 2);
  }
  return `Unknown debug_control action "${act}".`;
}

async function aiExecuteCustomToolRun(root, input = {}) {
  const act = String(input.action || "list").toLowerCase();
  if (act === "list") {
    const res = await aiControlInvoke("tools:list", root || "");
    return JSON.stringify(res, null, 2);
  }
  if (act === "run") {
    const toolId = String(input.toolId || "").trim();
    const commandId = String(input.commandId || "run").trim();
    if (!toolId) return "wide_custom_tool_run run requires `toolId`.";
    const res = await aiControlInvoke("tools:run", root || "", toolId, commandId, {
      active: input.active ?? null,
      input: input.input ?? "",
    });
    return JSON.stringify(res, null, 2);
  }
  if (act === "cancel") {
    const res = await aiControlInvoke("tools:cancel", String(input.runId || ""));
    return JSON.stringify(res, null, 2);
  }
  if (act === "scaffold") {
    const res = await aiControlInvoke("tools:scaffold", root || "", String(input.name || ""));
    return JSON.stringify(res, null, 2);
  }
  return `Unknown wide_custom_tool_run action "${act}".`;
}

async function aiExecuteTestRun(root, input = {}) {
  if (!root) return "run_tests requires an open workspace.";
  const act = String(input.action || "discover").toLowerCase();
  if (act === "discover") {
    return JSON.stringify(await aiControlInvoke("test:discover", root), null, 2);
  }
  if (act === "run") {
    let framework = input.framework ? String(input.framework) : "";
    if (!framework) {
      const disc = await aiControlInvoke("test:discover", root);
      framework = disc?.framework || "";
    }
    if (!framework) return JSON.stringify({ ok: false, error: "No supported test framework detected." }, null, 2);
    const res = await aiControlInvoke("test:run", root, framework, {
      rel: input.file || input.rel || "",
      name: input.testName || input.name || "",
    });
    return JSON.stringify(res, null, 2);
  }
  return `Unknown run_tests action "${act}".`;
}

async function aiExecuteUiStateGet(root) {
  const [proxyStatus, engineStatus, oastStatus, vaultRefs] = await Promise.all([
    aiControlInvoke("proxy:status"),
    aiControlInvoke("engine:status"),
    aiControlInvoke("oast:status"),
    readVault().then((v) => (v.entries || []).length).catch(() => 0),
  ]);
  return JSON.stringify(
    {
      ok: true,
      workspaceRoot: root || "",
      activeFile: aiLastUiState.activeFile || "",
      activePanel: aiLastUiState.activePanel || "",
      language: aiLastUiState.language || "en",
      openTabs: Array.isArray(aiLastKnownOpenTabs) ? aiLastKnownOpenTabs : [],
      catcher: proxyStatus,
      engine: engineStatus,
      oast: oastStatus,
      vaultCredentialCount: vaultRefs,
      persistentTerminals: aiPersistentTerminals.size,
      pendingPermissions: aiPendingPermissions.size,
      browser: typeof aiBrowserPublicState === "function" ? aiBrowserPublicState() : { open: Boolean(aiBrowserSession?.open) },
    },
    null,
    2
  );
}
