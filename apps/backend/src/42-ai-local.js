

const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
const OLLAMA_START_TIMEOUT_MS = 30000;

function ollamaRequest(method, path, body, { signal, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("stopped"));
      return;
    }
    const payload = body === undefined ? null : JSON.stringify(body);
    let stream = null;
    const keepAliveAgent = new node_http.Agent({ keepAlive: true, keepAliveMsecs: 30000 });
    const request = node_http.request(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path,
        method,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
              "connection": "keep-alive",
            }
          : { "connection": "keep-alive" },
        timeout,
        signal,
        agent: keepAliveAgent,
      },
      (response) => {
        stream = response;
        resolve(response);
      }
    );
    request.on("timeout", () => {
      const failure = new Error("Ollama did not answer in time.");
      if (stream) stream.destroy(failure);
      else reject(failure);
      request.destroy(failure);
    });
    request.on("error", reject);
    request.end(payload ?? undefined);
  });
}

async function ollamaJson(method, path, body, options) {
  const response = await ollamaRequest(method, path, body, options);
  let text = "";
  response.setEncoding("utf8");
  for await (const chunk of response) text += chunk;
  if (response.statusCode !== 200) {
    throw new Error(text.slice(0, 300) || `Ollama answered ${response.statusCode}.`);
  }
  return text ? JSON.parse(text) : {};
}

async function* ollamaStream(method, path, body, options) {
  const response = await ollamaRequest(method, path, body, options);
  response.setEncoding("utf8");
  if (response.statusCode !== 200) {
    let text = "";
    for await (const chunk of response) text += chunk;
    throw new Error(text.slice(0, 300) || `Ollama answered ${response.statusCode}.`);
  }
  let buffer = "";
  for await (const chunk of response) {
    buffer += chunk;
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

async function findOllamaBinary() {
  if (process.platform === "win32") {
    const candidates = [
      node_path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
      node_path.join(process.env.USERPROFILE || "", "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
      node_path.join(process.env.ProgramFiles || "C:\\Program Files", "Ollama", "ollama.exe"),
      node_path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Ollama", "ollama.exe"),
      "C:\\Program Files\\Ollama\\ollama.exe",
      "C:\\Program Files (x86)\\Ollama\\ollama.exe",
    ];
    for (const cand of candidates) {
      if (cand && node_fs.existsSync(cand)) return cand;
    }
  }
  await refreshPath();
  let at = await commandExists("ollama");
  if (at) return at;
  return null;
}

let ollamaStartInFlight = null;

async function ollamaStartServer(at, signal) {
  if (signal?.aborted) return { ok: false, state: "failed", error: "stopped" };
  if (await ollamaAlive()) return { ok: true, state: "running" };
  if (!at) return { ok: false, state: "missing" };

  if (!ollamaStartInFlight) {
    ollamaStartInFlight = (async () => {
      try {
        if (await ollamaAlive()) return { ok: true, state: "running" };
        const dir = node_path.dirname(at);
        const cliExe = node_path.join(dir, process.platform === "win32" ? "ollama.exe" : "ollama");
        const exeToRun = node_fs.existsSync(cliExe) ? cliExe : at;

        const child = node_child_process.spawn(exeToRun, ["serve"], {
          detached: false,
          stdio: "ignore",
          windowsHide: true,
          shell: false,
          env: process.env,
        });
        child.on("error", () => {});
        child.unref();
      } catch (error) {
        return { ok: false, state: "failed", error: String(error.message || error) };
      }

      const deadline = Date.now() + OLLAMA_START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await ollamaAlive()) return { ok: true, state: "running" };
        await new Promise((wake) => setTimeout(wake, 400));
      }
      return {
        ok: false,
        state: "failed",
        error: "Ollama started but did not respond within timeout. Please ensure Ollama is running in the background.",
      };
    })().finally(() => {
      ollamaStartInFlight = null;
    });
  }

  return ollamaStartInFlight;
}

async function ollamaAutoStartIfInstalled() {
  try {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return { ok: false, state: "disabled" };
    if (await ollamaAlive()) return { ok: true, state: "running" };
    const at = await findOllamaBinary();
    if (!at) return { ok: false, state: "missing" };
    return await ollamaStartServer(at);
  } catch {
    return { ok: false, state: "failed" };
  }
}

async function ollamaEnsure(track, signal, { allowInstall = false } = {}) {
  if (signal?.aborted) return { ok: false, state: "failed", error: "stopped" };
  if (await ollamaAlive()) return { ok: true, state: "running" };

  let at = await findOllamaBinary();

  if (!at) {
    if (!allowInstall) {
      return {
        ok: false,
        state: "missing",
        error: "Ollama is not installed.",
      };
    }
    if (signal?.aborted) return { ok: false, state: "failed", error: "stopped" };
    const bootstrap = await bootstrapManager("ollama", track);
    if (!bootstrap.ok) {
      return {
        ok: false,
        state: "missing",
        error: bootstrap.detail || "Ollama installation failed. Please install manually from https://ollama.com.",
      };
    }
    at = bootstrap.path || (await findOllamaBinary());
    if (!at) {
      return {
        ok: false,
        state: "missing",
        error: "Ollama installed but executable was not found. Please verify https://ollama.com installation.",
      };
    }
  }

  return ollamaStartServer(at, signal);
}

let hardwareCache = null;
let lastCpuSample = null;

function sampleCpuPercent() {
  const cpus = require("node:os").cpus() || [];
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times || {};
    idle += times.idle || 0;
    total += (times.user || 0) + (times.nice || 0) + (times.sys || 0) + (times.irq || 0) + (times.idle || 0);
  }
  if (!lastCpuSample) {
    lastCpuSample = { idle, total };
    return 12;
  }
  const idleDiff = idle - lastCpuSample.idle;
  const totalDiff = total - lastCpuSample.total;
  lastCpuSample = { idle, total };
  if (totalDiff <= 0) return 8;
  return Math.max(1, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
}

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
  } else if (process.platform === "win32") {
    const wmi = await readCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress",
    ]);
    if (wmi) {
      try {
        const parsed = JSON.parse(wmi.trim());
        if (parsed && parsed.Name) {
          gpu = String(parsed.Name).trim();
          vram = Math.max(0, Number(parsed.AdapterRAM) || 0);
        }
      } catch {
        void 0;
      }
    }
  }

  hardwareCache = { totalRam, vram, gpu };
  return hardwareCache;
}

async function aiLocalRunningModels() {
  try {
    const ps = await ollamaJson("GET", "/api/ps", undefined, { timeout: 2000 });
    return (ps.models ?? []).map((entry) => {
      const size = Number(entry.size) || 0;
      const sizeVram = Number(entry.size_vram) || 0;
      const gpuRatio = size > 0 ? Math.round((sizeVram / size) * 100) : 0;
      return {
        name: entry.name ?? entry.model ?? "",
        size,
        sizeVram,
        processor: sizeVram > 0 ? `${Math.min(100, gpuRatio)}% GPU` : "100% CPU",
        contextLength: Number(entry.context_length) || 0,
        expiresAt: entry.expires_at ?? "",
      };
    });
  } catch {
    return [];
  }
}

async function aiLiveResources() {
  const os = require("node:os");
  const hw = await aiHardware();
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const usedRam = Math.max(0, totalRam - freeRam);
  const ramPercent = Math.round((usedRam / Math.max(1, totalRam)) * 100);
  const cpuPercent = sampleCpuPercent();
  const cpuCores = (os.cpus() || []).length;

  let vramTotal = hw.vram || 0;
  let vramUsed = 0;
  let gpuUtil = 0;
  let gpu = hw.gpu || "";

  const smi = await readCommand("nvidia-smi", [
    "--query-gpu=name,memory.total,memory.used,utilization.gpu",
    "--format=csv,noheader,nounits",
  ]);
  if (smi) {
    const parts = smi.split("\n")[0].split(",").map((part) => part.trim());
    if (parts[0]) gpu = parts[0];
    if (Number(parts[1]) > 0) vramTotal = Number(parts[1]) * 1024 * 1024;
    if (Number(parts[2]) >= 0) vramUsed = Number(parts[2]) * 1024 * 1024;
    if (Number(parts[3]) >= 0) gpuUtil = Math.min(100, Math.max(0, Number(parts[3])));
  }

  return {
    totalRam,
    freeRam,
    usedRam,
    ramPercent,
    cpuPercent,
    cpuCores,
    gpu,
    vramTotal,
    vramUsed,
    gpuUtil,
  };
}

function aiFitFor(bytes, hardware) {
  if (!bytes) return { fit: "unknown", neededBytes: 0, ratio: 0 };

  const needed = Math.round(bytes * 1.2);
  if (hardware.vram > 0 && needed <= hardware.vram) {
    return { fit: "gpu", neededBytes: needed, ratio: Math.min(1, needed / hardware.vram) };
  }
  if (needed <= hardware.totalRam * 0.8) {
    return { fit: "cpu", neededBytes: needed, ratio: Math.min(1, needed / hardware.totalRam) };
  }
  return { fit: "no", neededBytes: needed, ratio: Math.min(1, needed / Math.max(1, hardware.totalRam)) };
}

function registerAiLocalHandlers() {
  void ollamaAutoStartIfInstalled();

  electron.ipcMain.handle("ai:localStatus", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const hw = await aiHardware();
    let alive = await ollamaAlive();
    if (!alive) {
      const at = await findOllamaBinary();
      if (!at) {
        return { ok: true, running: false, installed: false, models: [], runningModels: [], hardware: hw };
      }
      const started = await ollamaStartServer(at);
      alive = Boolean(started && started.ok);
      if (!alive) {
        return { ok: true, running: false, installed: true, models: [], runningModels: [], hardware: hw };
      }
    }
    let models = [];
    try {
      const tags = await ollamaJson("GET", "/api/tags");
      models = (tags.models ?? []).map((entry) => {
        const compat = aiFitFor(entry.size, hw);
        return {
          name: entry.name,
          size: entry.size,
          quantization: entry.details?.quantization_level ?? "",
          parameters: entry.details?.parameter_size ?? "",
          family: entry.details?.family ?? "",
          fit: compat.fit,
          neededBytes: compat.neededBytes,
          fitRatio: compat.ratio,
        };
      });
    } catch {
      void 0;
    }
    const runningModels = await aiLocalRunningModels();
    return { ok: true, running: true, installed: true, models, runningModels, hardware: hw };
  });

  electron.ipcMain.handle("ai:localSetup", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    return ollamaEnsure(null, undefined, { allowInstall: true });
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

    let lastStatus = "";
    let ollamaReportedSuccess = false;

    try {
      for await (const chunk of ollamaStream("POST", "/api/pull", { model: name, stream: true }, { timeout: 0 })) {
        if (chunk.error) {
          send({ status: "error", error: chunk.error });
          return { ok: false, error: chunk.error };
        }
        lastStatus = chunk.status ?? "";
        if (lastStatus === "success") ollamaReportedSuccess = true;
        send({
          status: lastStatus,
          total: chunk.total ?? 0,
          completed: chunk.completed ?? 0,
        });
      }

      if (!ollamaReportedSuccess) {
        const deadline = Date.now() + 10000;
        let found = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const tags = await ollamaJson("GET", "/api/tags", undefined, { timeout: 10000 });
            const models = tags.models ?? [];
            const modelBase = name
              .replace(/^hf\.co\//i, "")
              .replace(/\.gguf$/i, "")
              .toLowerCase();
            found = models.some((m) => {
              const mName = m.name.replace(/\.gguf$/i, "").toLowerCase();
              return mName.includes(modelBase.split(":")[0]) || modelBase.includes(mName.split(":")[0]);
            });
            if (found) break;
          } catch {
          }
        }
        if (!found) {
          const errMsg = `Model download reached 100% but the model was not registered by Ollama (last status: "${lastStatus}"). Please try again.`;
          send({ status: "error", error: errMsg });
          return { ok: false, error: errMsg };
        }
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

async function aiRunLocalTurn({ model, root, system, messages, allowWrites, effort = "fast", signal, send }) {
  const ready = await ollamaEnsure(null, signal);
  if (signal?.aborted) return { ok: false, error: "stopped" };
  if (!ready.ok) {
    send({ type: "error", message: ready.error ?? "Ollama is not running." });
    return { ok: false, error: ready.error };
  }
  if (!model) {
    send({ type: "error", message: "No local model is selected." });
    return { ok: false, error: "no-model" };
  }

  const isThinking = effort === "thinking";
  const maxRounds = isThinking ? AI_MAX_TOOL_ROUNDS : 12;
  const tools = aiToolsFor("deepseek", allowWrites);
  const history = system ? [{ role: "system", content: system }, ...messages] : [...messages];
  let supportsNativeTools = true;
  let supportsThinkParam = true;
  let nudgedForFileWrite = false;

  for (let round = 0; round < maxRounds; round += 1) {
    if (signal?.aborted) return { ok: false, error: "stopped" };
    let calls = [];
    let usedTextCalls = false;
    let answered = false;
    let said = "";
    const filter = aiCreateStreamFilter(send);

    const runChatStream = async (withTools, withThinkParam) => {
      const payload = {
        model,
        messages: history,
        stream: true,
        options: {
          temperature: isThinking ? 0.6 : 0.2,
          num_predict: isThinking ? 8192 : 4096,
        },
      };
      if (withThinkParam) {
        payload.think = isThinking;
      }
      if (withTools && tools.length > 0) payload.tools = tools;
      for await (const chunk of ollamaStream("POST", "/api/chat", payload, { signal, timeout: 0 })) {
        if (chunk.error) {
          throw new Error(chunk.error);
        }
        const message = chunk.message ?? {};

        if (message.thinking) send({ type: "thinking", text: message.thinking });
        if (message.content) {
          answered = true;
          said += message.content;
          filter.push(message.content);
        }
        for (const call of message.tool_calls ?? []) {
          let rawArgs = call.function?.arguments ?? {};
          if (typeof rawArgs === "string") {
            rawArgs = aiParseLenientJson(rawArgs) ?? {};
          }
          const norm = aiNormalizeToolCall(call.function?.name ?? "", rawArgs);
          calls.push({
            id: call.id ?? `${norm.name}-${calls.length}`,
            name: norm.name,
            input: norm.input,
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
    };

    try {
      try {
        await runChatStream(supportsNativeTools, supportsThinkParam);
      } catch (innerError) {
        const msg = String(innerError.message || innerError);
        if (supportsThinkParam && /think|thinking.*not supported|unknown field/i.test(msg)) {
          supportsThinkParam = false;
          calls = [];
          said = "";
          try {
            await runChatStream(supportsNativeTools, false);
          } catch (secondError) {
            const msg2 = String(secondError.message || secondError);
            if (supportsNativeTools && /does not support tools|tool.*not supported|template/i.test(msg2)) {
              supportsNativeTools = false;
              calls = [];
              said = "";
              await runChatStream(false, false);
            } else {
              throw secondError;
            }
          }
        } else if (supportsNativeTools && /does not support tools|tool.*not supported|template/i.test(msg)) {
          supportsNativeTools = false;
          calls = [];
          said = "";
          try {
            await runChatStream(false, supportsThinkParam);
          } catch (secondError) {
            supportsThinkParam = false;
            calls = [];
            said = "";
            await runChatStream(false, false);
          }
        } else {
          throw innerError;
        }
      }
      filter.flush();
    } catch (error) {
      if (signal?.aborted) return { ok: false, error: "stopped" };
      send({ type: "error", message: String(error.message || error) });
      return { ok: false, error: String(error.message || error) };
    }

    if (calls.length === 0 && said) {
      const extracted = aiExtractTextToolCalls(said);
      if (extracted.length > 0) {
        calls = extracted;
        usedTextCalls = true;
      }
    }

    if (calls.length === 0) {
      if (!nudgedForFileWrite && round === 0 && allowWrites && root && aiHasSubstantialCodeBlock(said)) {
        nudgedForFileWrite = true;
        history.push({ role: "assistant", content: said });
        history.push({
          role: "user",
          content:
            "SYSTEM: You wrote code in the chat instead of creating or updating the project file in the workspace. Call write_file or edit_file right now using <tool_call>{\"name\": \"write_file\", \"arguments\": {\"path\": \"...\", \"content\": \"...\"}}</tool_call> to apply the code directly to the workspace.",
        });
        continue;
      }
      return { ok: true, answered };
    }

    if (usedTextCalls || !supportsNativeTools) {
      history.push({
        role: "assistant",
        content: said,
      });
      const responses = [];
      for (const call of calls) {
        send({ type: "tool_start", id: call.id, name: call.name, input: call.input });
        const result = await aiRunTool(root, call.name, call.input ?? {}, send, allowWrites);
        send({ type: "tool_end", id: call.id, name: call.name, result });
        responses.push(`<tool_response name="${call.name}">\n${result}\n</tool_response>`);
        if (signal?.aborted) return { ok: false, error: "stopped" };
      }
      history.push({
        role: "user",
        content: `${responses.join("\n\n")}\n\nContinue based on the tool execution results above. If further file changes are needed, call the appropriate tool; otherwise summarize what you did concisely.`,
      });
    } else {
      history.push({
        role: "assistant",
        content: said,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: call.input && typeof call.input === "object" ? call.input : {},
          },
        })),
      });

      for (const call of calls) {
        send({ type: "tool_start", id: call.id, name: call.name, input: call.input });
        const result = await aiRunTool(root, call.name, call.input ?? {}, send, allowWrites);
        send({ type: "tool_end", id: call.id, name: call.name, result });
        history.push({ role: "tool", content: result });
        if (signal?.aborted) return { ok: false, error: "stopped" };
      }
    }
  }

  send({
    type: "error",
    message: `The assistant used ${AI_MAX_TOOL_ROUNDS} rounds of tools without finishing, and was stopped.`,
  });
  return { ok: false, error: "too-many-rounds" };
}
