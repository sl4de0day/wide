

const AI_REQUEST_TIMEOUT_MS = 120000;

const AI_HOSTS = {
  gemini: "generativelanguage.googleapis.com",
  deepseek: "api.deepseek.com",
  claude: "api.anthropic.com",
};

function aiRequest({ host, path: requestPath, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
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
      },
      (response) => resolve(response)
    );
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("The provider did not answer in time."));
    });
    request.on("error", reject);
    signal?.addEventListener("abort", () => request.destroy(), { once: true });
    request.end(payload);
  });
}

async function* aiLines(response) {
  let buffer = "";
  for await (const chunk of response) {
    buffer += chunk.toString("utf8");
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
  for await (const chunk of response) {
    if (text.length < 8192) text += chunk.toString("utf8");
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

async function* aiStreamDeepSeek({ key, model, system, messages, tools, signal }) {
  const body = {
    model: model || "deepseek-v4-pro",
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools?.length) body.tools = tools;

  const response = await aiRequest({
    host: AI_HOSTS.deepseek,
    path: "/chat/completions",
    headers: { authorization: `Bearer ${key}` },
    body,
    signal,
  });
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
      yield {
        type: "usage",
        input: event.usage.prompt_tokens ?? 0,
        output: event.usage.completion_tokens ?? 0,
        total: event.usage.total_tokens ?? 0,
      };
    }
  }

  for (const call of partialCalls.values()) {
    yield { type: "tool_use", id: call.id, name: call.name, input: aiParseArgs(call.args) };
  }
}

async function* aiStreamClaude({ key, model, system, messages, tools, signal }) {
  const body = {
    model: model || "claude-sonnet-4-5",
    max_tokens: 8192,
    messages,
    stream: true,
  };
  if (system) body.system = system;
  if (tools?.length) body.tools = tools;

  const response = await aiRequest({
    host: AI_HOSTS.claude,
    path: "/v1/messages",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    body,
    signal,
  });
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
        yield { type: "tool_use", id: slot.id, name: slot.name, input: aiParseArgs(slot.args) };
      }
    } else if (event.type === "message_delta") {
      const output = event.usage?.output_tokens ?? 0;
      yield { type: "usage", input: inputTokens, output, total: inputTokens + output };
    } else if (event.type === "error") {
      yield { type: "error", message: event.error?.message ?? "The provider reported an error." };
    }
  }
}

async function* aiStreamGemini({ key, model, system, steps, tools, signal }) {
  const body = {
    model: model || "gemini-3.7-flash",
    input: steps,
    store: false,
    stream: true,
  };
  if (system) body.system_instruction = system;
  if (tools?.length) body.tools = tools;

  const response = await aiRequest({
    host: AI_HOSTS.gemini,
    path: "/v1beta/interactions?alt=sse",
    headers: { "x-goog-api-key": key },
    body,
    signal,
  });
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
      if (call) yield { type: "tool_use", id: call.id, name: call.name, input: aiParseArgs(call.args) };
    } else if (event.event_type === "interaction.completed") {
      const usage = event.interaction?.usage ?? {};
      yield {
        type: "usage",
        input: usage.total_input_tokens ?? 0,
        output: usage.total_output_tokens ?? 0,

        total: usage.total_tokens ?? 0,
      };
      break;
    }
  }
}

function aiParseArgs(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {

    return {};
  }
}

async function aiVerifyKey(provider, key) {
  if (!key) return { ok: false, error: "No key." };
  try {
    if (provider === "claude") {
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
      if (models.statusCode !== 200) return { ok: false, error: await aiErrorBody(models) };
      let text = "";
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
