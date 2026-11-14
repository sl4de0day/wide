function aiCatcherNormalizeHeaders(headers) {
  if (Array.isArray(headers)) {
    return headers
      .filter((pair) => Array.isArray(pair) && pair.length >= 2 && String(pair[0] || "").trim())
      .map(([k, v]) => [String(k).trim(), String(v ?? "")]);
  }
  if (headers && typeof headers === "object") {
    return Object.entries(headers)
      .filter(([k]) => String(k || "").trim())
      .map(([k, v]) => [String(k).trim(), String(v ?? "")]);
  }
  return [];
}

function aiCatcherEmitSync(send, action, detail = {}) {
  const payload = {
    type: "catcher_sync",
    action,
    running: Boolean(proxyServer),
    port: proxyPort || 0,
    intercepting: Boolean(intercepting),
    interceptingResponses: Boolean(interceptingResponses),
    scope: Array.isArray(proxyScope) ? proxyScope.slice() : [],
    ...detail,
  };
  if (typeof send === "function") {
    try { send(payload); } catch {}
  }
  try {
    if (typeof broadcast === "function") broadcast("ai:event", payload);
  } catch {
    void 0;
  }
}

async function aiExecuteCatcherControl(input = {}, send) {
  const act = String(input.action || "status").toLowerCase();
  if (act === "status") {
    let caTrusted = false;
    try { caTrusted = await caIsTrusted(); } catch {}
    return JSON.stringify(
      {
        running: Boolean(proxyServer),
        port: proxyPort || 0,
        intercepting: Boolean(intercepting),
        interceptingResponses: Boolean(interceptingResponses),
        scope: proxyScope.slice(),
        trafficCount: proxyLog.length,
        pendingRequests: pendingIntercepts.size,
        pendingResponses: pendingResponseIntercepts.size,
        matchReplaceCount: matchReplaceRules.length,
        liveWebSockets: liveWebSockets.size,
        caTrusted,
      },
      null,
      2
    );
  }

  if (act === "start") {
    const started = await startProxy();
    if (!started?.ok) return `Failed to start Catcher proxy: ${started?.error || "unknown error"}`;
    aiCatcherEmitSync(send, "start");
    if (aiBrowserSession.open && typeof aiBrowserEnsureReady === "function") {
      void aiBrowserEnsureReady({ bypassProxy: false }).catch(() => {});
    }
    return JSON.stringify({ ok: true, running: true, port: started.port }, null, 2);
  }

  if (act === "stop") {
    stopProxy();
    aiCatcherEmitSync(send, "stop");
    if (aiBrowserSession.open && typeof aiBrowserEnsureReady === "function") {
      void aiBrowserEnsureReady({ bypassProxy: false }).catch(() => {});
    }
    return JSON.stringify({ ok: true, running: false, port: 0 }, null, 2);
  }

  if (act === "set_intercept" || act === "set_response_intercept") {
    if (typeof input.intercept === "boolean") {
      if (act === "set_response_intercept") {
        interceptingResponses = input.intercept;
        if (!interceptingResponses) releaseResponseIntercepts();
      } else {
        intercepting = input.intercept;
        if (!intercepting) releaseIntercepts();
      }
    }
    if (typeof input.interceptResponses === "boolean") {
      interceptingResponses = input.interceptResponses;
      if (!interceptingResponses) releaseResponseIntercepts();
    }
    aiCatcherEmitSync(send, "set_intercept");
    return JSON.stringify(
      {
        ok: true,
        intercepting: Boolean(intercepting),
        interceptingResponses: Boolean(interceptingResponses),
      },
      null,
      2
    );
  }

  if (act === "set_scope") {
    proxyScope = Array.isArray(input.scope) ? input.scope.map((s) => String(s || "").trim()).filter(Boolean) : [];
    aiCatcherEmitSync(send, "set_scope");
    return JSON.stringify({ ok: true, scope: proxyScope }, null, 2);
  }

  if (act === "clear") {
    proxyLog.length = 0;
    aiCatcherEmitSync(send, "clear");
    return JSON.stringify({ ok: true, cleared: true, trafficCount: 0 }, null, 2);
  }

  if (act === "ca_status") {
    await loadOrMakeCa();
    let trusted = false;
    try { trusted = await caIsTrusted(); } catch {}
    return JSON.stringify({ ok: true, certPath: PROXY_CA_CERT(), trusted }, null, 2);
  }

  if (act === "ca_trust") {
    await loadOrMakeCa();
    if (process.platform === "win32") {
      const r = await runCertutil(["-user", "-addstore", "Root", PROXY_CA_CERT()]);
      return JSON.stringify({ ok: r.ok, trusted: await caIsTrusted(), message: certutilMessage(r.out) }, null, 2);
    }
    return JSON.stringify({ ok: false, certPath: PROXY_CA_CERT(), error: "Automatic CA trust is supported on Windows; import cert manually on this OS." }, null, 2);
  }

  if (act === "get_traffic") {
    return aiExecuteCatcherTrafficQuery({ limit: input.limit || 20 });
  }

  return `Unknown Catcher action '${act}'.`;
}

function aiExecuteCatcherTrafficQuery(input = {}) {
  const id = Number(input.id);
  if (Number.isFinite(id) && id > 0) {
    const exact = proxyLog.find((item) => item.id === id);
    if (!exact) return `No captured traffic entry with id ${id}.`;
    return JSON.stringify(
      {
        ...exact,
        reqBody: String(exact.reqBody || "").slice(0, 16000),
        resBody: String(exact.resBody || "").slice(0, 16000),
      },
      null,
      2
    );
  }

  const methodFilter = String(input.method || "").trim().toUpperCase();
  const hostFilter = String(input.host || "").trim().toLowerCase();
  const searchFilter = String(input.search || "").trim().toLowerCase();
  const statusMin = Number.isFinite(Number(input.statusMin)) ? Number(input.statusMin) : null;
  const statusMax = Number.isFinite(Number(input.statusMax)) ? Number(input.statusMax) : null;
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 20));
  const includeBodies = Boolean(input.includeBodies);

  let items = proxyLog.filter((item) => {
    if (methodFilter && String(item.method || "").toUpperCase() !== methodFilter) return false;
    if (hostFilter && !String(item.host || "").toLowerCase().includes(hostFilter)) return false;
    if (statusMin !== null && Number(item.status || 0) < statusMin) return false;
    if (statusMax !== null && Number(item.status || 0) > statusMax) return false;
    if (searchFilter) {
      const hay = `${item.url || ""}\n${item.reqBody || ""}\n${item.resBody || ""}`.toLowerCase();
      if (!hay.includes(searchFilter)) return false;
    }
    return true;
  });

  const totalMatched = items.length;
  items = items.slice(-limit).map((item) => ({
    id: item.id,
    method: item.method,
    url: item.url,
    host: item.host,
    status: item.status,
    ms: item.ms,
    reqLen: String(item.reqBody || "").length,
    resLen: String(item.resBody || "").length,
    ...(includeBodies
      ? {
          reqHeaders: item.reqHeaders,
          reqBody: String(item.reqBody || "").slice(0, 1500),
          resHeaders: item.resHeaders,
          resBody: String(item.resBody || "").slice(0, 1500),
        }
      : {}),
  }));

  return JSON.stringify(
    {
      totalCaptured: proxyLog.length,
      matched: totalMatched,
      returned: items.length,
      entries: items,
    },
    null,
    2
  );
}

function aiExecuteCatcherInterceptDecide(input = {}, send) {
  const act = String(input.action || "list").toLowerCase();
  const kind = String(input.kind || "request").toLowerCase();
  const queue = kind === "response" ? pendingResponseIntercepts : pendingIntercepts;

  if (act === "list") {
    return JSON.stringify(
      {
        pendingRequests: [...pendingIntercepts.values()].map((e) => e.request),
        pendingResponses: [...pendingResponseIntercepts.values()].map((e) => e.response),
      },
      null,
      2
    );
  }

  if (act === "forward_all") {
    const count = queue.size;
    for (const entry of queue.values()) entry.resolve({ action: "forward" });
    queue.clear();
    aiCatcherEmitSync(send, "intercept_forward_all");
    return JSON.stringify({ ok: true, kind, forwarded: count });
  }

  if (act === "drop_all") {
    const count = queue.size;
    for (const entry of queue.values()) entry.resolve({ action: "drop" });
    queue.clear();
    aiCatcherEmitSync(send, "intercept_drop_all");
    return JSON.stringify({ ok: true, kind, dropped: count });
  }

  const targetId = Number(input.id);
  const entry = queue.get(targetId);
  if (!entry) {
    return `No pending ${kind} intercept with id ${input.id}. Use action='list' to see held IDs.`;
  }
  queue.delete(targetId);

  if (act === "drop") {
    entry.resolve({ action: "drop" });
    aiCatcherEmitSync(send, "intercept_drop", { id: targetId });
    return JSON.stringify({ ok: true, kind, id: targetId, decision: "drop" });
  }

  const edited = input.edited && typeof input.edited === "object" ? { ...input.edited } : undefined;
  if (edited && edited.headers && !Array.isArray(edited.headers)) {
    edited.headers = aiCatcherNormalizeHeaders(edited.headers);
  }
  entry.resolve({ action: "forward", edited });
  aiCatcherEmitSync(send, "intercept_forward", { id: targetId });
  return JSON.stringify({ ok: true, kind, id: targetId, decision: "forward", edited: Boolean(edited) });
}

function aiExecuteCatcherMatchReplace(input = {}, send) {
  const act = String(input.action || "list").toLowerCase();
  if (act === "list") {
    return JSON.stringify({ count: matchReplaceRules.length, rules: matchReplaceRules }, null, 2);
  }
  if (act === "clear") {
    matchReplaceRules = [];
    aiCatcherEmitSync(send, "match_replace");
    return JSON.stringify({ ok: true, count: 0, rules: [] });
  }
  const incoming = Array.isArray(input.rules) ? input.rules : [];
  const normalized = incoming.map((r, i) => ({
    id: String(r.id || `rule-${Date.now()}-${i}`),
    enabled: r.enabled !== false,
    target: String(r.target || "req-header"),
    match: String(r.match || ""),
    replace: String(r.replace ?? ""),
    regex: Boolean(r.regex),
  }));
  if (act === "add") {
    matchReplaceRules = [...matchReplaceRules, ...normalized];
  } else {
    matchReplaceRules = normalized;
  }
  aiCatcherEmitSync(send, "match_replace");
  return JSON.stringify({ ok: true, count: matchReplaceRules.length, rules: matchReplaceRules }, null, 2);
}

function aiBuildSeedFromInput(input = {}) {
  const id = Number(input.id);
  if (Number.isFinite(id) && id > 0) {
    const found = proxyLog.find((entry) => entry.id === id);
    if (!found) return { error: `No Catcher traffic entry found with id ${id}.` };
    return {
      seed: {
        method: String(found.method || "GET"),
        url: String(found.url || ""),
        headers: Array.isArray(found.reqHeaders) ? found.reqHeaders : [],
        body: String(found.reqBody || ""),
      },
    };
  }
  const url = String(input.url || "").trim();
  if (!url) return { error: "Provide either an existing traffic id or a target url." };
  return {
    seed: {
      method: String(input.method || "GET").toUpperCase(),
      url,
      headers: aiCatcherNormalizeHeaders(input.headers),
      body: typeof input.body === "string" ? input.body : "",
    },
  };
}

function aiExecuteSendToRepeater(input = {}, send) {
  const built = aiBuildSeedFromInput(input);
  if (built.error) return built.error;
  const openUi = input.openUi !== false;
  aiCatcherEmitSync(send, "open_repeater", { seed: built.seed, openUi });
  return JSON.stringify({ ok: true, sentTo: "repeater", seed: built.seed }, null, 2);
}

function aiExecuteSendToIntruder(input = {}, send) {
  const built = aiBuildSeedFromInput(input);
  if (built.error) return built.error;
  const openUi = input.openUi !== false;
  aiCatcherEmitSync(send, "open_intruder", { seed: built.seed, openUi });
  return JSON.stringify({ ok: true, sentTo: "intruder", seed: built.seed }, null, 2);
}

async function aiExecuteRepeaterSend(input = {}, send) {
  const url = String(input.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return "Invalid URL for repeater_send. Must start with http:// or https://.";
  }
  const req = {
    method: String(input.method || "GET").toUpperCase(),
    url,
    headers: aiCatcherNormalizeHeaders(input.headers),
    body: typeof input.body === "string" ? input.body : "",
  };
  if (input.openUi) {
    aiCatcherEmitSync(send, "open_repeater", { seed: req, openUi: true });
  }
  const opts = {
    insecure: input.insecure !== false,
    followRedirects: Boolean(input.followRedirects),
    timeoutMs: 25000,
  };
  let reply;
  if (input.http2) {
    reply = await sendRequestH2(req, opts);
  } else if (input.useSessionMacro) {
    reply = await sendRequestWithSession(req, opts);
  } else {
    reply = await sendRequestOnce(req, opts);
  }
  if (!reply?.ok) {
    return `Repeater request failed: ${reply?.error || "Unknown error"}`;
  }
  return JSON.stringify(
    {
      status: reply.status,
      statusText: reply.statusText,
      ms: reply.ms,
      httpVersion: reply.httpVersion || (input.http2 ? "2.0" : "1.1"),
      headers: reply.headers,
      body: String(reply.body || "").slice(0, 16000),
    },
    null,
    2
  );
}

function aiBuildIntruderCases(template, attackType, payloadSets) {
  const sets = (Array.isArray(payloadSets) ? payloadSets : []).map((s) =>
    Array.isArray(s) ? s.map((v) => String(v ?? "")) : []
  );
  if (sets.length === 0 || sets.every((s) => s.length === 0)) return [];

  const combined = `${template.url}\n${template.body}`;
  const markerRegex = /§([^§\r\n]*)§/g;
  let markers = 0;
  while (markerRegex.exec(combined) !== null) markers += 1;
  const posCount = Math.max(1, markers);

  const replaceMarkers = (text, values) => {
    let idx = 0;
    return String(text || "").replace(/§([^§\r\n]*)§/g, (full, fallback) => {
      const val = values[idx] !== undefined ? values[idx] : values[0] ?? fallback;
      idx += 1;
      return val;
    });
  };

  const cases = [];
  const cap = 100;
  const mode = String(attackType || "sniper").toLowerCase();

  if (mode === "battering-ram") {
    for (const p of sets[0] || []) {
      if (cases.length >= cap) break;
      const vals = Array(posCount).fill(p);
      cases.push({ payload: p, url: replaceMarkers(template.url, vals), body: replaceMarkers(template.body, vals) });
    }
  } else if (mode === "pitchfork") {
    const len = Math.min(...sets.map((s) => s.length));
    for (let i = 0; i < len && cases.length < cap; i += 1) {
      const vals = sets.map((s) => s[i]);
      cases.push({ payload: vals.join(" | "), url: replaceMarkers(template.url, vals), body: replaceMarkers(template.body, vals) });
    }
  } else if (mode === "cluster-bomb") {
    const activeSets = sets.slice(0, posCount);
    const combos = (idx, acc) => {
      if (cases.length >= cap) return;
      if (idx >= activeSets.length) {
        cases.push({ payload: acc.join(" | "), url: replaceMarkers(template.url, acc), body: replaceMarkers(template.body, acc) });
        return;
      }
      for (const item of activeSets[idx] || [""]) {
        if (cases.length >= cap) break;
        combos(idx + 1, [...acc, item]);
      }
    };
    combos(0, []);
  } else {
    const payloads = sets[0] || [];
    for (let pIdx = 0; pIdx < posCount && cases.length < cap; pIdx += 1) {
      for (const p of payloads) {
        if (cases.length >= cap) break;
        let seen = 0;
        const injectAt = (text) =>
          String(text || "").replace(/§([^§\r\n]*)§/g, (_full, def) => {
            const out = seen === pIdx ? p : def;
            seen += 1;
            return out;
          });
        const u = injectAt(template.url);
        const b = injectAt(template.body);
        cases.push({ payload: `[pos ${pIdx + 1}] ${p}`, url: u, body: b });
      }
    }
  }
  return cases;
}

async function aiExecuteIntruderAttack(input = {}, send) {
  const url = String(input.url || "").trim();
  if (!/^https?:\/\//i.test(url.replace(/§[^§]*§/g, "x"))) {
    return "Invalid base URL for intruder_attack.";
  }
  const template = {
    method: String(input.method || "GET").toUpperCase(),
    url,
    headers: aiCatcherNormalizeHeaders(input.headers),
    body: typeof input.body === "string" ? input.body : "",
  };
  const cases = aiBuildIntruderCases(template, input.attackType || "sniper", input.payloadSets);
  if (cases.length === 0) {
    return "No payloads provided or markers found. Pass payloadSets array and optionally §marker§ placeholders in url/body.";
  }

  aiCatcherEmitSync(send, "open_intruder", { seed: template, openUi: true });

  const workers = Math.max(1, Math.min(10, Number(input.concurrency) || 4));
  const results = new Array(cases.length);
  let cursor = 0;

  const runWorker = async () => {
    while (cursor < cases.length) {
      const idx = cursor;
      cursor += 1;
      const item = cases[idx];
      const res = await sendRequestOnce(
        { method: template.method, url: item.url, headers: template.headers, body: item.body },
        { insecure: true, followRedirects: Boolean(input.followRedirects), timeoutMs: 15000 }
      );
      results[idx] = {
        index: idx + 1,
        payload: item.payload,
        status: res?.ok ? res.status : 0,
        length: res?.ok ? Buffer.byteLength(String(res.body || ""), "utf8") : 0,
        ms: res?.ms || 0,
        error: res?.ok ? undefined : res?.error,
        snippet: res?.ok ? String(res.body || "").slice(0, 140).replace(/\s+/g, " ") : "",
      };
    }
  };

  await Promise.all(Array.from({ length: Math.min(workers, cases.length) }, runWorker));
  return JSON.stringify(
    {
      attackType: input.attackType || "sniper",
      totalRequests: results.length,
      results,
    },
    null,
    2
  );
}

function aiExecuteCatcherWsSend(input = {}) {
  if (input.connectionId === undefined || input.connectionId === null) {
    const active = [...liveWebSockets.entries()].map(([id]) => {
      const logEntry = proxyLog.find((p) => p.id === id);
      return {
        id,
        url: logEntry?.url || "",
        state: "open",
      };
    });
    return JSON.stringify({ count: active.length, connections: active }, null, 2);
  }
  const entry = liveWebSockets.get(Number(input.connectionId));
  if (!entry) return `No active WebSocket connection with id ${input.connectionId}.`;
  const dir = input.direction === "client" ? "client" : "server";
  const text = String(input.text ?? "");
  const socket = dir === "client" ? entry.clientSocket : entry.upstream;
  if (!socket || socket.destroyed || !socket.writable) {
    return "Target WebSocket endpoint is not writable.";
  }
  const frame = encodeWsFrame(text, dir === "server");
  socket.write(frame);
  return JSON.stringify({ ok: true, id: Number(input.connectionId), direction: dir, bytes: Buffer.byteLength(text, "utf8") });
}
