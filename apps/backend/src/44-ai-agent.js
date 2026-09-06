

const AI_MAX_TOOL_ROUNDS = 12;
const AI_MAX_TOOL_RESULT_BYTES = 100 * 1024;

const AI_TOOLS = [
  {
    name: "read_file",
    description:
      "Read a text file from the open project. Give a path relative to the project root. Returns the file's contents with line numbers, so you can refer to a line when you answer.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root." },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description:
      "List the files and folders in one directory of the project. Use this to find your way around before reading; it is much cheaper than reading files to see what exists.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory relative to the project root. Empty means the root itself.",
        },
      },
      required: [],
    },
  },
  {
    name: "search",
    description:
      "Search the whole project for a string or regular expression. Returns matching files with line numbers and the matching line. This is the fastest way to find where something is defined or used.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regular expression to find." },
        regex: { type: "boolean", description: "Treat the query as a regular expression." },
        caseSensitive: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "find_relevant",
    description:
      "Find the files most relevant to a description or a set of terms, ranked across the whole project, each with a short snippet. Use this when you do not know the exact string to grep for — it surfaces the likely files to read next.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you are looking for, in words." },
      },
      required: ["query"],
    },
  },
  {
    name: "open_file",
    description:
      "Open a file in the editor so the person can see it. Use it when you want to show someone what you are talking about. It does not return the contents; read_file does that.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root." },
        line: { type: "number", description: "Line to scroll to, 1-based." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Replace a file's entire contents. Read the file first; you are replacing all of it, not appending. The change is proposed to the person in the editor rather than written to the disk, so it only takes effect once they accept it, and they can undo it with one keystroke.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root." },
        content: { type: "string", description: "The complete new contents of the file." },
      },
      required: ["path", "content"],
    },
  },
];

function aiToolsFor(provider, allowWrites) {
  const own = allowWrites ? AI_TOOLS : AI_TOOLS.filter((tool) => tool.name !== "write_file");
  const tools = [...own, ...mcpToolSpecs()];
  if (provider === "claude") {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
  if (provider === "gemini") {

    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

function aiResolvePath(root, given) {
  if (!root) return { error: "No project is open." };
  const raw = String(given ?? "").trim();
  const absolute = node_path.resolve(root, raw);
  const relative = node_path.relative(root, absolute);
  if (relative.startsWith("..") || node_path.isAbsolute(relative)) {
    return { error: "That path is outside the project. You can only reach files inside it." };
  }
  return { path: absolute, relative: relative || "." };
}

function aiTrim(text) {
  if (text.length <= AI_MAX_TOOL_RESULT_BYTES) return text;
  return (
    text.slice(0, AI_MAX_TOOL_RESULT_BYTES) +
    `\n\n… truncated at ${AI_MAX_TOOL_RESULT_BYTES} characters. Narrow the request if you need the rest.`
  );
}

const AI_ARGS_MAY_BE_EMPTY = new Set(["content"]);

function aiMissingArgs(name, input) {
  const spec = AI_TOOLS.find((tool) => tool.name === name);
  if (!spec) return [];
  const properties = spec.parameters.properties ?? {};
  return (spec.parameters.required ?? []).filter((key) => {
    const value = input?.[key];
    if (properties[key]?.type !== "string") return value === undefined || value === null;
    if (typeof value !== "string") return true;
    return value.trim() === "" && !AI_ARGS_MAY_BE_EMPTY.has(key);
  });
}

function aiAllowed(channel, args) {
  const verdict = check({ channel, args, subject: "ai" });
  if (verdict.decision === "deny" && verdict.enforced) {
    return { ok: false, reason: verdict.reason || "The policy refused that." };
  }
  return { ok: true };
}

async function aiRunTool(root, name, input, send) {
  try {

    if (isMcpTool(name)) {
      const allowed = aiAllowed("ai:tool.mcp", [name]);
      if (!allowed.ok) return allowed.reason;
      return aiTrim(await mcpCallTool(name, input ?? {}));
    }

    const missing = aiMissingArgs(name, input);
    if (missing.length > 0) {
      return `The call to ${name} arrived without ${missing.join(" and ")}, so nothing was done. Send it again with the whole argument object.`;
    }

    if (name === "find_relevant") {
      const allowed = aiAllowed("ai:tool.search", [root]);
      if (!allowed.ok) return allowed.reason;
      return aiTrim(await findRelevant(root, String(input.query ?? "")));
    }

    if (name === "list_dir") {
      const resolved = aiResolvePath(root, input.path ?? "");
      if (resolved.error) return resolved.error;
      const allowed = aiAllowed("ai:tool.list", [root, resolved.path]);
      if (!allowed.ok) return allowed.reason;
      const dirents = await promises.readdir(resolved.path, { withFileTypes: true });
      return aiTrim(
        dirents
          .filter((entry) => !IGNORED$3.has(entry.name))
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"}  ${entry.name}`)
          .join("\n") || "(empty)"
      );
    }

    if (name === "read_file") {
      const resolved = aiResolvePath(root, input.path);
      if (resolved.error) return resolved.error;
      const allowed = aiAllowed("ai:tool.read", [root, resolved.path]);
      if (!allowed.ok) return allowed.reason;
      const stats = await promises.stat(resolved.path);
      if (stats.size > MAX_FILE_BYTES$1) {
        return `That file is ${stats.size} bytes, too large to read.`;
      }
      const content = await promises.readFile(resolved.path, "utf8");

      return aiTrim(
        content
          .split("\n")
          .map((line, index) => `${String(index + 1).padStart(5)}  ${line}`)
          .join("\n")
      );
    }

    if (name === "search") {
      const allowed = aiAllowed("ai:tool.search", [root]);
      if (!allowed.ok) return allowed.reason;
      const result = await searchInFiles(root, {
        query: String(input.query ?? ""),
        regexp: Boolean(input.regex),
        caseSensitive: Boolean(input.caseSensitive),
      });
      if (result?.error) return result.error;
      const files = result?.files ?? [];
      if (files.length === 0) return "No matches.";
      const lines = [];
      for (const file of files) {
        for (const match of file.matches ?? []) {
          lines.push(`${file.relativePath ?? file.path}:${match.line}  ${String(match.preview ?? "").trim()}`);
        }
      }
      return aiTrim(`${result.total ?? lines.length} matches\n${lines.join("\n")}`);
    }

    if (name === "open_file") {
      const resolved = aiResolvePath(root, input.path);
      if (resolved.error) return resolved.error;

      send({ type: "open", path: resolved.path, line: Number(input.line) || 1 });
      return `Opened ${resolved.relative}.`;
    }

    if (name === "write_file") {
      const resolved = aiResolvePath(root, input.path);
      if (resolved.error) return resolved.error;

      const allowed = aiAllowed("ai:tool.write", [root, resolved.path]);
      if (!allowed.ok) return allowed.reason;
      let existed = true;
      try {
        await promises.access(resolved.path);
      } catch {
        existed = false;
      }
      send({ type: "edit", root, path: resolved.path, content: input.content, existed });

      return `The change to ${resolved.relative} was handed to the editor. It may still be waiting for the person to accept it, so do not assume the copy on disk matches; do not read it back to check, and describe it as a change you are making rather than one that is finished.`;
    }

    return `There is no tool called ${name}.`;
  } catch (error) {
    return `That tool failed: ${String(error.message || error)}`;
  }
}

async function aiRunTurn({ provider, model, key, root, system, messages, allowWrites, signal, send }) {
  const tools = aiToolsFor(provider, allowWrites);
  const history = [...messages];

  for (let round = 0; round < AI_MAX_TOOL_ROUNDS; round += 1) {
    const calls = [];
    let answered = false;
    let said = "";

    const stream =
      provider === "gemini"
        ? aiStreamGemini({ key, model, system, steps: aiToGeminiSteps(history), tools, signal })
        : provider === "claude"
          ? aiStreamClaude({ key, model, system, messages: history, tools, signal })
          : aiStreamDeepSeek({ key, model, system, messages: history, tools, signal });

    for await (const event of stream) {
      if (event.type === "tool_use") calls.push(event);
      else if (event.type === "text") {
        answered = true;
        said += String(event.text ?? "");
      }
      send(event);
    }

    if (calls.length === 0) return { ok: true, answered };

    history.push(aiAssistantTurn(provider, calls, said));

    for (const call of calls) {
      send({ type: "tool_start", id: call.id, name: call.name, input: call.input });
      const result = call.truncated
        ? `The call to ${call.name} arrived cut off, so nothing was done. The provider ended the answer mid-argument; send the call again with the whole argument object, or make a smaller change.`
        : await aiRunTool(root, call.name, call.input ?? {}, send);
      send({ type: "tool_end", id: call.id, name: call.name, result });
      history.push(aiToolResultTurn(provider, call, result));
      if (signal?.aborted) return { ok: false, error: "stopped" };
    }
  }

  send({
    type: "error",
    message: `The assistant used ${AI_MAX_TOOL_ROUNDS} rounds of tools without finishing, and was stopped.`,
  });
  return { ok: false, error: "too-many-rounds" };
}

function aiAssistantTurn(provider, calls, text) {
  const said = String(text ?? "");
  const spoke = said.trim().length > 0;
  if (provider === "claude") {
    const blocks = calls.map((call) => ({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: call.input ?? {},
    }));
    return {
      role: "assistant",
      content: spoke ? [{ type: "text", text: said }, ...blocks] : blocks,
    };
  }
  if (provider === "gemini") {
    const steps = calls.map((call) => ({
      type: "function_call",
      id: call.id,
      name: call.name,
      arguments: JSON.stringify(call.input ?? {}),
    }));
    return {
      role: "assistant",
      geminiSteps: spoke
        ? [{ type: "model_output", content: [{ type: "text", text: said }] }, ...steps]
        : steps,
    };
  }
  return {
    role: "assistant",
    content: spoke ? said : null,
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
    })),
  };
}

function aiToolResultTurn(provider, call, result) {
  if (provider === "claude") {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: call.id, content: result }],
    };
  }
  if (provider === "gemini") {
    return {
      role: "tool",
      geminiSteps: [
        {
          type: "function_result",
          name: call.name,
          call_id: call.id,
          result: [{ type: "text", text: result }],
        },
      ],
    };
  }
  return { role: "tool", tool_call_id: call.id, content: result };
}

const aiTurns = new Map();

const AI_HOUSE_STYLE = [
  "Formatting rules for your reply, which override any default style you have.",
  "Write plain prose. Emit no Markdown at all: no headings, no hash marks, no asterisks for bold or italic, no backticks, no code fences, no tables, no blockquotes, no horizontal rules.",
  "Do not begin lines with a dash, a bullet or a number to make a list. Write the same content as sentences, or as short lines that begin with the thing itself.",
  "Separate paragraphs with one blank line. Keep paragraphs to a few sentences.",
  "Name files, functions and identifiers inside ordinary sentences rather than marking them up.",
  "When you must show code, put it on its own lines with a blank line before and after, and no fence around it.",
  "Reply in the language the person wrote to you in.",
].join(" ");

function aiSystemPrompt(system) {
  return [String(system || '').trim(), AI_HOUSE_STYLE].filter(Boolean).join(' ');
}

function aiWithHouseStyle(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let last = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.role === "user") {
      last = index;
      break;
    }
  }
  if (last < 0) return list;
  const message = list[last];

  if (typeof message.content !== "string") return list;
  const copy = list.slice();
  copy[last] = {
    ...message,
    content: `${message.content}\n\n[Wide] ${AI_HOUSE_STYLE}`,
  };
  return copy;
}

function registerAiAgentHandlers() {

  electron.ipcMain.handle("ai:send", async (event, request) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;

    const {
      id,
      root = "",
      provider = "deepseek",
      model = "",
      messages = [],
      system = "",
    } = request ?? {};
    if (!id) return { ok: false, error: "No turn id." };

    const egress = check({ channel: "ai:egress", args: [provider], subject: "user" });
    if (egress.decision === "deny" && egress.enforced) {
      return { ok: false, error: egress.reason || "The policy refused that provider." };
    }

    const prompt = aiSystemPrompt(system);
    const turn = aiWithHouseStyle(messages);

    const config = await readAiConfig();
    const key = await aiKeyFor(provider === "claude-code" ? "claude" : provider);
    if (!key && provider !== "claude-code" && provider !== "local") {
      return { ok: false, error: "no-key" };
    }

    const sender = event.sender;
    const controller = new AbortController();
    aiTurns.set(id, controller);

    if (provider !== "claude-code") {
      try {
        await ensureMcp(root);
      } catch {

      }
    }
    if (controller.signal.aborted) {
      aiTurns.delete(id);
      return { ok: false, error: "stopped" };
    }

    const send = (payload) => {
      if (!sender.isDestroyed()) sender.send("ai:event", { ...payload, id });
    };

    try {
      if (provider === "claude-code") {

        return await aiRunClaudeCodeTurn({
          root,
          model,
          system: prompt,
          messages: turn,
          signal: controller.signal,
          send,
        });
      }
      if (provider === "local") {
        return await aiRunLocalTurn({
          model,
          root,
          system: prompt,
          messages: turn,
          allowWrites: config.allowWrites,
          signal: controller.signal,
          send,
        });
      }
      return await aiRunTurn({
        provider,
        model,
        key,
        root,
        system: prompt,
        messages: turn,
        allowWrites: config.allowWrites,
        signal: controller.signal,
        send,
      });
    } catch (error) {

      if (controller.signal.aborted) return { ok: false, error: "stopped" };
      send({ type: "error", message: String(error.message || error) });
      return { ok: false, error: String(error.message || error) };
    } finally {
      aiTurns.delete(id);
      send({ type: "done" });
    }
  });

  electron.ipcMain.handle("ai:complete", async (_event, prefix, suffix, language) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return { ok: false };
    const config = await readAiConfig();
    const local = config.tab === "local";
    const provider = local ? "local" : config.provider;
    const model = local ? config.localModel : config.cloudModel?.[config.provider] ?? "";
    const system =
      "You are an inline code completion engine. Continue the code exactly at <CURSOR>. " +
      "Output ONLY the raw text to insert at the cursor — no explanation, no markdown, no code fences. " +
      "Prefer completing the current line or a short block. If nothing sensible fits, output nothing.";
    const user = `Language: ${language || "text"}\n\n${String(prefix ?? "")}<CURSOR>${String(suffix ?? "")}`;
    const messages = [{ role: "user", content: user }];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let text = "";
    try {
      if (local) {
        await aiRunLocalTurn({
          model, root: "", system, messages, allowWrites: false,
          signal: controller.signal,
          send: (event) => { if (event.type === "text" && typeof event.text === "string") text += event.text; },
        });
      } else {
        const key = await aiKeyFor(provider === "claude-code" ? "claude" : provider);
        if (!key) return { ok: false };
        const stream =
          provider === "gemini"
            ? aiStreamGemini({ key, model, system, steps: aiToGeminiSteps(messages), tools: [], signal: controller.signal })
            : provider === "claude" || provider === "claude-code"
              ? aiStreamClaude({ key, model, system, messages, tools: [], signal: controller.signal })
              : provider === "deepseek"
                ? aiStreamDeepSeek({ key, model, system, messages, tools: [], signal: controller.signal })
                : null;
        if (!stream) return { ok: false };
        for await (const event of stream) {
          if (event.type === "text" && typeof event.text === "string") text += event.text;
        }
      }
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }

    const out = text.replace(/```[a-z0-9]*\n?/gi, "").replace(/```/g, "").replace(/^\n/, "");
    return { ok: true, text: out };
  });

  electron.ipcMain.handle("ai:commitFile", async (_event, root, path, content) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    if (typeof content !== "string") return { ok: false, error: "No content was given to write." };
    const resolved = aiResolvePath(root, path);
    if (resolved.error) return { ok: false, error: resolved.error };
    const allowed = aiAllowed("ai:tool.write", [root, resolved.path]);
    if (!allowed.ok) return { ok: false, error: allowed.reason };
    try {
      await promises.mkdir(node_path.dirname(resolved.path), { recursive: true });
      await writeFileAtomic(resolved.path, content, "utf8");
      return { ok: true, path: resolved.path };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  electron.ipcMain.handle("ai:stop", async (_event, id) => {
    const controller = aiTurns.get(id);
    if (!controller) return { ok: true, stopped: false };
    controller.abort();
    aiTurns.delete(id);
    return { ok: true, stopped: true };
  });

  electron.ipcMain.handle("ai:verifyKey", async (_event, provider, key) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const result = await aiVerifyKey(provider, String(key ?? "").trim());
    return result;
  });
}

function aiToGeminiSteps(messages) {
  const steps = [];
  for (const message of messages) {
    if (message.geminiSteps) {
      steps.push(...message.geminiSteps);
      continue;
    }
    if (message.role === "user") {
      steps.push({ type: "user_input", content: [{ type: "text", text: String(message.content ?? "") }] });
    } else if (message.role === "assistant" && message.content) {
      steps.push({ type: "model_output", content: [{ type: "text", text: String(message.content) }] });
    }
  }
  return steps;
}
