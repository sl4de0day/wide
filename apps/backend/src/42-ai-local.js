

const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
const OLLAMA_START_TIMEOUT_MS = 30000;

function ollamaRequest(method, path, body, { signal, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = node_http.request(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path,
        method,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : {},
        timeout,
      },
      resolve
    );
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Ollama did not answer in time."));
    });
    request.on("error", reject);
    signal?.addEventListener("abort", () => request.destroy(), { once: true });
    request.end(payload ?? undefined);
  });
}

async function ollamaJson(method, path, body, options) {
  const response = await ollamaRequest(method, path, body, options);
  let text = "";
  for await (const chunk of response) text += chunk.toString("utf8");
  if (response.statusCode !== 200) {
    throw new Error(text.slice(0, 300) || `Ollama answered ${response.statusCode}.`);
  }
  return text ? JSON.parse(text) : {};
}

async function* ollamaStream(method, path, body, options) {
  const response = await ollamaRequest(method, path, body, options);
  if (response.statusCode !== 200) {
    let text = "";
    for await (const chunk of response) text += chunk.toString("utf8");
    throw new Error(text.slice(0, 300) || `Ollama answered ${response.statusCode}.`);
  }
  let buffer = "";
  for await (const chunk of response) {
    buffer += chunk.toString("utf8");
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line);
      } catch {

      }
    }
  }
}

async function ollamaAlive() {
  try {
    await ollamaJson("GET", "/api/tags", undefined, { timeout: 2500 });
    return true;
  } catch {
    return false;
  }
}

async function ollamaEnsure(track) {
  if (await ollamaAlive()) return { ok: true, state: "running" };

  await refreshPath();
  let at = await commandExists("ollama");

  if (!at) {
    const bootstrap = await bootstrapManager("ollama", track);
    if (!bootstrap.ok) {
      return {
        ok: false,
        state: "missing",
        error: bootstrap.detail || "Ollama could not be installed.",
      };
    }
    at = bootstrap.path;
  }

  try {
    const child = node_child_process.spawn(at, ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env,
    });
    child.unref();
  } catch (error) {
    return { ok: false, state: "failed", error: String(error.message || error) };
  }

  const deadline = Date.now() + OLLAMA_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ollamaAlive()) return { ok: true, state: "running" };
    await new Promise((wake) => setTimeout(wake, 500));
  }
  return { ok: false, state: "failed", error: "Ollama was started but never answered." };
}

let hardwareCache = null;

async function aiHardware() {
  if (hardwareCache) return hardwareCache;
  const totalRam = require("node:os").totalmem();
  let vram = 0;
  let gpu = "";

  const smi = await readCommand("nvidia-smi", [
    "--query-gpu=name,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  if (smi) {
    const [name, megabytes] = smi.split("\n")[0].split(",").map((part) => part.trim());
    gpu = name ?? "";
    vram = (Number(megabytes) || 0) * 1024 * 1024;
  }

  hardwareCache = { totalRam, vram, gpu };
  return hardwareCache;
}

function aiFitFor(bytes, hardware) {
  if (!bytes) return { fit: "unknown" };

  const needed = bytes * 1.2;
  if (hardware.vram > 0 && needed <= hardware.vram) return { fit: "gpu" };
  if (needed <= hardware.totalRam * 0.8) return { fit: "cpu" };
  return { fit: "no" };
}

function registerAiLocalHandlers() {

  electron.ipcMain.handle("ai:localStatus", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const alive = await ollamaAlive();
    if (!alive) {
      const installed = Boolean(await commandExists("ollama"));
      return { ok: true, running: false, installed, models: [], hardware: await aiHardware() };
    }
    let models = [];
    try {
      const tags = await ollamaJson("GET", "/api/tags");
      models = (tags.models ?? []).map((entry) => ({
        name: entry.name,
        size: entry.size,
        quantization: entry.details?.quantization_level ?? "",
        parameters: entry.details?.parameter_size ?? "",
        family: entry.details?.family ?? "",
      }));
    } catch {

    }
    return { ok: true, running: true, installed: true, models, hardware: await aiHardware() };
  });

  electron.ipcMain.handle("ai:localSetup", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    return ollamaEnsure(null);
  });

  electron.ipcMain.handle("ai:localPull", async (event, reference) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const name = String(reference ?? "").trim();
    if (!name) return { ok: false, error: "No model was named." };

    const ready = await ollamaEnsure(null);
    if (!ready.ok) return ready;

    const sender = event.sender;
    const send = (payload) => {
      if (!sender.isDestroyed()) sender.send("ai:pull", { reference: name, ...payload });
    };

    try {
      for await (const chunk of ollamaStream("POST", "/api/pull", { model: name, stream: true }, { timeout: 0 })) {
        if (chunk.error) {
          send({ status: "error", error: chunk.error });
          return { ok: false, error: chunk.error };
        }
        send({
          status: chunk.status ?? "",
          total: chunk.total ?? 0,
          completed: chunk.completed ?? 0,
        });
      }
      send({ status: "done", total: 0, completed: 0 });
      return { ok: true, reference: name };
    } catch (error) {
      const message = String(error.message || error);
      send({ status: "error", error: message });
      return { ok: false, error: message };
    }
  });

  electron.ipcMain.handle("ai:localRemove", async (_event, name) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    try {
      await ollamaJson("DELETE", "/api/delete", { model: String(name ?? "") });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });
}

async function aiRunLocalTurn({ model, root, system, messages, allowWrites, signal, send }) {
  const ready = await ollamaEnsure(null);
  if (!ready.ok) {
    send({ type: "error", message: ready.error ?? "Ollama is not running." });
    return { ok: false, error: ready.error };
  }
  if (!model) {
    send({ type: "error", message: "No local model is selected." });
    return { ok: false, error: "no-model" };
  }

  const tools = aiToolsFor("deepseek", allowWrites);
  const history = system ? [{ role: "system", content: system }, ...messages] : [...messages];

  for (let round = 0; round < AI_MAX_TOOL_ROUNDS; round += 1) {
    const calls = [];
    let answered = false;

    try {
      for await (const chunk of ollamaStream(
        "POST",
        "/api/chat",
        { model, messages: history, tools, stream: true },
        { signal, timeout: 0 }
      )) {
        if (chunk.error) {
          send({ type: "error", message: chunk.error });
          return { ok: false, error: chunk.error };
        }
        const message = chunk.message ?? {};

        if (message.thinking) send({ type: "thinking", text: message.thinking });
        if (message.content) {
          answered = true;
          send({ type: "text", text: message.content });
        }
        for (const call of message.tool_calls ?? []) {
          calls.push({
            id: call.id ?? `${call.function?.name}-${calls.length}`,
            name: call.function?.name ?? "",
            input: call.function?.arguments ?? {},
          });
        }
        if (chunk.done) {
          send({
            type: "usage",
            input: chunk.prompt_eval_count ?? 0,
            output: chunk.eval_count ?? 0,
            total: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
          });
        }
      }
    } catch (error) {
      if (signal?.aborted) return { ok: false, error: "stopped" };
      send({ type: "error", message: String(error.message || error) });
      return { ok: false, error: String(error.message || error) };
    }

    if (calls.length === 0) return { ok: true, answered };

    history.push({
      role: "assistant",
      content: "",
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
      })),
    });

    for (const call of calls) {
      send({ type: "tool_start", id: call.id, name: call.name, input: call.input });
      const result = await aiRunTool(root, call.name, call.input ?? {}, send);
      send({ type: "tool_end", id: call.id, name: call.name, result });
      history.push({ role: "tool", content: result });
      if (signal?.aborted) return { ok: false, error: "stopped" };
    }
  }

  send({
    type: "error",
    message: `The assistant used ${AI_MAX_TOOL_ROUNDS} rounds of tools without finishing, and was stopped.`,
  });
  return { ok: false, error: "too-many-rounds" };
}
