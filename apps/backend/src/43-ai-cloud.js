

const AI_REQUEST_TIMEOUT_MS = 120000;

const AI_HOSTS = {
  gemini: "generativelanguage.googleapis.com",
  deepseek: "api.deepseek.com",
  claude: "api.anthropic.com",
};

const aiCloudTelemetry = {
  claude: {
    requestsLimit: 50,
    requestsRemaining: 50,
    tokensLimit: 80000,
    tokensRemaining: 80000,
    requestsUsed: 0,
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    resetAt: "",
    lastLatencyMs: 0,
    lastStatus: "ready",
    updatedAt: 0,
  },
  deepseek: {
    requestsLimit: 60,
    requestsRemaining: 60,
    tokensLimit: 120000,
    tokensRemaining: 120000,
    requestsUsed: 0,
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    resetAt: "",
    lastLatencyMs: 0,
    lastStatus: "ready",
    updatedAt: 0,
  },
  gemini: {
    requestsLimit: 60,
    requestsRemaining: 60,
    tokensLimit: 100000,
    tokensRemaining: 100000,
    requestsUsed: 0,
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    resetAt: "",
    lastLatencyMs: 0,
    lastStatus: "ready",
    updatedAt: 0,
  },
  "claude-code": {
    requestsLimit: 50,
    requestsRemaining: 50,
    tokensLimit: 100000,
    tokensRemaining: 100000,
    requestsUsed: 0,
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    resetAt: "",
    lastLatencyMs: 0,
    lastStatus: "ready",
    updatedAt: 0,
  },
  opencode: {
    requestsLimit: 60,
    requestsRemaining: 60,
    tokensLimit: 200000,
    tokensRemaining: 200000,
    requestsUsed: 0,
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    resetAt: "",
    lastLatencyMs: 0,
    lastStatus: "ready",
    updatedAt: 0,
  },
};

function aiRecordCloudHeaders(provider, headers, statusCode, latencyMs = 0) {
  const slot = aiCloudTelemetry[provider];
  if (!slot) return;
  const h = headers || {};
  slot.requestsUsed += 1;
  slot.updatedAt = Date.now();
  if (latencyMs > 0) slot.lastLatencyMs = Math.round(latencyMs);
  slot.lastStatus = statusCode === 429 ? "rate_limited" : statusCode === 200 ? "ok" : "error";

  const reqLim = Number(
    h["anthropic-ratelimit-requests-limit"] ??
      h["x-ratelimit-limit-requests"] ??
      h["x-ratelimit-requests-limit"] ??
      0
  );
  const reqRem = Number(
    h["anthropic-ratelimit-requests-remaining"] ??
      h["x-ratelimit-remaining-requests"] ??
      h["x-ratelimit-requests-remaining"] ??
      -1
  );
  const tokLim = Number(
    h["anthropic-ratelimit-tokens-limit"] ??
      h["x-ratelimit-limit-tokens"] ??
      h["x-ratelimit-tokens-limit"] ??
      0
  );
  const tokRem = Number(
    h["anthropic-ratelimit-tokens-remaining"] ??
      h["x-ratelimit-remaining-tokens"] ??
      h["x-ratelimit-tokens-remaining"] ??
      -1
  );
  const reset = String(
    h["anthropic-ratelimit-requests-reset"] ??
      h["anthropic-ratelimit-tokens-reset"] ??
      h["x-ratelimit-reset-requests"] ??
      h["retry-after"] ??
      ""
  );

  if (reqLim > 0) slot.requestsLimit = reqLim;
  if (reqRem >= 0 && !Number.isNaN(reqRem)) {
    slot.requestsRemaining = reqRem;
  } else {
    slot.requestsRemaining = Math.max(0, slot.requestsLimit - (slot.requestsUsed % Math.max(1, slot.requestsLimit)));
  }
  if (tokLim > 0) slot.tokensLimit = tokLim;
  if (tokRem >= 0 && !Number.isNaN(tokRem)) {
    slot.tokensRemaining = tokRem;
  }
  if (reset) slot.resetAt = reset;
}

function aiRecordCloudUsage(provider, input = 0, output = 0) {
  const slot = aiCloudTelemetry[provider];
  if (!slot) return;
  const inTok = Math.max(0, Number(input) || 0);
  const outTok = Math.max(0, Number(output) || 0);
  const total = inTok + outTok;
  slot.inputTokens += inTok;
  slot.outputTokens += outTok;
  slot.tokensUsed += total;
  slot.updatedAt = Date.now();
  if (slot.tokensRemaining > 0 && total > 0) {
    slot.tokensRemaining = Math.max(0, slot.tokensRemaining - total);
  }
}

function aiGetCloudTelemetry() {
  return {
    claude: { ...aiCloudTelemetry.claude },
    deepseek: { ...aiCloudTelemetry.deepseek },
    gemini: { ...aiCloudTelemetry.gemini },
    "claude-code": { ...aiCloudTelemetry["claude-code"] },
    opencode: { ...aiCloudTelemetry.opencode },
  };
}

function aiRequest({ host, path: requestPath, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("stopped"));
      return;
    }
    const payload = JSON.stringify(body);
    let stream = null;
    const request = node_https.request(
      {
        host,
        path: requestPath,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...headers,
        },
        timeout: AI_REQUEST_TIMEOUT_MS,
        signal,
      },
      (response) => {
        stream = response;
        resolve(response);
      }
    );
    request.on("timeout", () => {
      const failure = new Error("The provider did not answer in time.");
      if (stream) stream.destroy(failure);
      else reject(failure);
      request.destroy(failure);
    });
    request.on("error", reject);
    request.end(payload);
  });
}

async function* aiLines(response) {
  let buffer = "";
  response.setEncoding("utf8");
  for await (const chunk of response) {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, at).replace(/\r$/, "");
      buffer = buffer.slice(at + 1);
    }
  }
  if (buffer.trim()) yield buffer;
}

async function aiErrorBody(response) {
  let text = "";
  response.setEncoding("utf8");
  for await (const chunk of response) {
    if (text.length < 8192) text += chunk;
  }
  try {
    const parsed = JSON.parse(text);
    return (
      parsed?.error?.message ??
      parsed?.error?.msg ??
      parsed?.message ??
      text.slice(0, 400)
    );
  } catch {
    return text.slice(0, 400) || `The provider answered ${response.statusCode}.`;
  }
}

async function* aiStreamDeepSeek({ key, model, system, messages, tools, effort = "fast", signal }) {
  const isThinking = effort === "thinking";
  const selectedModel = model || "deepseek-v4-pro";
  const isReasoner = /reasoner|r1/i.test(selectedModel);
  const body = {
    model: selectedModel,
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
    max_tokens: isThinking ? 8192 : 4096,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (!isReasoner) {
    body.temperature = isThinking ? 0.6 : 0.2;
  }
  if (tools?.length) body.tools = tools;

  const startedAt = Date.now();
  const response = await aiRequest({
    host: AI_HOSTS.deepseek,
    path: "/chat/completions",
    headers: { authorization: `Bearer ${key}` },
    body,
    signal,
  });
  aiRecordCloudHeaders("deepseek", response.headers, response.statusCode, Date.now() - startedAt);
  if (response.statusCode !== 200) {
    yield { type: "error", message: await aiErrorBody(response) };
    return;
  }

  const partialCalls = new Map();

  for await (const line of aiLines(response)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;

    let event;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }

    const delta = event.choices?.[0]?.delta;
    if (delta?.reasoning_content) yield { type: "thinking", text: delta.reasoning_content };
    if (delta?.content) yield { type: "text", text: delta.content };

    for (const call of delta?.tool_calls ?? []) {
      const slot = partialCalls.get(call.index) ?? { id: "", name: "", args: "" };
      if (call.id) slot.id = call.id;
      if (call.function?.name) slot.name = call.function.name;
      if (call.function?.arguments) slot.args += call.function.arguments;
      partialCalls.set(call.index, slot);
    }

    if (event.usage) {
      const inTok = event.usage.prompt_tokens ?? 0;
      const outTok = event.usage.completion_tokens ?? 0;
      aiRecordCloudUsage("deepseek", inTok, outTok);
      yield {
        type: "usage",
        input: inTok,
        output: outTok,
        total: event.usage.total_tokens ?? inTok + outTok,
      };
    }
  }

  for (const call of partialCalls.values()) {
    yield* aiToolUse(call);
  }
}

async function* aiStreamClaude({ key, model, system, messages, tools, effort = "fast", signal }) {
  const isThinking = effort === "thinking";
  const body = {
    model: model || "claude-sonnet-4-5",
    max_tokens: isThinking ? 12288 : 4096,
    temperature: isThinking ? 0.5 : 0.2,
    messages,
    stream: true,
  };
  if (system) body.system = system;
  if (tools?.length) body.tools = tools;

  const startedAt = Date.now();
  const response = await aiRequest({
    host: AI_HOSTS.claude,
    path: "/v1/messages",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    body,
    signal,
  });
  aiRecordCloudHeaders("claude", response.headers, response.statusCode, Date.now() - startedAt);
  if (response.statusCode !== 200) {
    yield { type: "error", message: await aiErrorBody(response) };
    return;
  }

  const blocks = new Map();
  let inputTokens = 0;

  for await (const line of aiLines(response)) {
    if (!line.startsWith("data:")) continue;
    let event;
    try {
      event = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }

    if (event.type === "message_start") {
      inputTokens = event.message?.usage?.input_tokens ?? 0;
    } else if (event.type === "content_block_start") {
      blocks.set(event.index, {
        kind: event.content_block?.type,
        id: event.content_block?.id ?? "",
        name: event.content_block?.name ?? "",
        args: "",
      });
    } else if (event.type === "content_block_delta") {
      const delta = event.delta ?? {};
      if (delta.type === "text_delta") yield { type: "text", text: delta.text };
      else if (delta.type === "thinking_delta") yield { type: "thinking", text: delta.thinking };
      else if (delta.type === "input_json_delta") {
        const slot = blocks.get(event.index);
        if (slot) slot.args += delta.partial_json ?? "";
      }
    } else if (event.type === "content_block_stop") {
      const slot = blocks.get(event.index);
      if (slot?.kind === "tool_use") {
        yield* aiToolUse(slot);
      }
    } else if (event.type === "message_delta") {
      const output = event.usage?.output_tokens ?? 0;
      aiRecordCloudUsage("claude", inputTokens, output);
      yield { type: "usage", input: inputTokens, output, total: inputTokens + output };
    } else if (event.type === "error") {
      yield { type: "error", message: event.error?.message ?? "The provider reported an error." };
    }
  }
}

async function* aiStreamGemini({ key, model, system, steps, tools, effort = "fast", signal }) {
  const body = {
    model: model || "gemini-3.7-flash",
    input: steps,
    store: false,
    stream: true,
  };
  if (system) body.system_instruction = system;
  if (tools?.length) body.tools = tools;
  void effort;

  const startedAt = Date.now();
  const response = await aiRequest({
    host: AI_HOSTS.gemini,
    path: "/v1beta/interactions?alt=sse",
    headers: { "x-goog-api-key": key },
    body,
    signal,
  });
  aiRecordCloudHeaders("gemini", response.headers, response.statusCode, Date.now() - startedAt);
  if (response.statusCode !== 200) {
    yield { type: "error", message: await aiErrorBody(response) };
    return;
  }

  const stepTypes = new Map();
  const calls = new Map();

  for await (const line of aiLines(response)) {
    if (!line.startsWith("data:")) continue;
    let event;
    try {
      event = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }

    if (event.event_type === "step.start") {
      stepTypes.set(event.index, event.step?.type);
      if (event.step?.type === "function_call") {
        calls.set(event.index, { id: event.step.id ?? "", name: event.step.name ?? "", args: "" });
      }
    } else if (event.event_type === "step.delta") {
      const kind = stepTypes.get(event.index);
      const delta = event.delta ?? {};
      if (delta.type === "text" && kind === "model_output") {
        yield { type: "text", text: delta.text };
      } else if (delta.type === "text" && kind === "thought") {
        yield { type: "thinking", text: delta.text };
      } else if (calls.has(event.index) && typeof delta.arguments === "string") {
        calls.get(event.index).args += delta.arguments;
      }
    } else if (event.event_type === "step.stop") {
      const call = calls.get(event.index);
      if (call) yield* aiToolUse(call);
    } else if (event.event_type === "interaction.completed") {
      const usage = event.interaction?.usage ?? {};
      const inTok = usage.total_input_tokens ?? 0;
      const outTok = usage.total_output_tokens ?? 0;
      aiRecordCloudUsage("gemini", inTok, outTok);
      yield {
        type: "usage",
        input: inTok,
        output: outTok,
        total: usage.total_tokens ?? inTok + outTok,
      };
      break;
    }
  }
}

function aiParseArgs(text) {
  if (!text) return { ok: true, input: {} };
  try {
    const input = JSON.parse(text);
    if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, input: {} };
    return { ok: true, input };
  } catch {
    return { ok: false, input: {} };
  }
}

function* aiToolUse(call) {
  const parsed = aiParseArgs(call.args);
  yield { type: "tool_use", id: call.id, name: call.name, input: parsed.input, truncated: !parsed.ok };
}

async function aiVerifyKey(provider, key) {
  if (!key) return { ok: false, error: "No key." };
  try {
    if (provider === "claude") {
      const startedAt = Date.now();
      const models = await new Promise((resolve, reject) => {
        const request = node_https.request(
          {
            host: AI_HOSTS.claude,
            path: "/v1/models?limit=20",
            method: "GET",
            headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
            timeout: 20000,
          },
          resolve
        );
        request.on("timeout", () => (request.destroy(), reject(new Error("timeout"))));
        request.on("error", reject);
        request.end();
      });
      aiRecordCloudHeaders("claude", models.headers, models.statusCode, Date.now() - startedAt);
      if (models.statusCode !== 200) return { ok: false, error: await aiErrorBody(models) };
      let text = "";
      models.setEncoding("utf8");
      for await (const chunk of models) text += chunk;
      const parsed = JSON.parse(text);
      return { ok: true, models: (parsed.data ?? []).map((entry) => entry.id) };
    }

    const stream =
      provider === "deepseek"
        ? aiStreamDeepSeek({ key, messages: [{ role: "user", content: "hi" }] })
        : aiStreamGemini({
            key,
            model: "gemini-3.5-flash-lite",
            steps: [{ type: "user_input", content: [{ type: "text", text: "hi" }] }],
          });
    for await (const event of stream) {
      if (event.type === "error") return { ok: false, error: event.message };

      if (event.type === "text" || event.type === "usage") return { ok: true, models: [] };
    }
    return { ok: true, models: [] };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}
