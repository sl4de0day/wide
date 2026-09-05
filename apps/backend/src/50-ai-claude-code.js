

const CLAUDE_TOOL_PORT_HOST = "127.0.0.1";

const CLAUDE_DISALLOWED = [
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
];

const CLAUDE_TOOL_MAX_BODY = 16 * 1024 * 1024;

const claudeToolTurns = new Map();

let claudeToolServer = null;
let claudeToolStarting = null;

function claudeToolBridge() {
  if (claudeToolServer) return Promise.resolve(claudeToolServer);
  if (claudeToolStarting) return claudeToolStarting;

  const starting = new Promise((resolve, reject) => {
    const server = node_http.createServer((request, response) => {
      let settled = false;
      const finish = (status, body) => {
        if (settled) return;
        settled = true;
        try {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(body));
        } catch {

        }
      };
      request.on("error", () => finish(400, {}));
      response.on("error", () => {
        settled = true;
      });

      if (request.method !== "POST" || request.url !== "/tool") return finish(404, {});
      const offered = String(request.headers.authorization ?? "");
      const turn = offered.startsWith("Bearer ") ? claudeToolTurns.get(offered.slice(7)) : null;
      if (!turn) return finish(403, {});

      const decoder = new StringDecoder("utf8");
      let body = "";
      request.on("data", (chunk) => {

        if (body.length < CLAUDE_TOOL_MAX_BODY) body += decoder.write(chunk);
      });
      request.on("end", async () => {
        body += decoder.end();
        let call;
        try {
          call = JSON.parse(body);
        } catch {
          return finish(400, { result: "That request was not valid JSON." });
        }
        try {

          const result = await aiRunTool(turn.root, call.name ?? "", call.input ?? {}, turn.send);
          finish(200, { result });
        } catch (error) {
          finish(200, { result: `That tool failed: ${String(error.message || error)}` });
        }
      });
    });

    server.on("error", reject);
    server.listen(0, CLAUDE_TOOL_PORT_HOST, () => {
      claudeToolServer = { server, port: server.address().port };
      resolve(claudeToolServer);
    });
  });

  claudeToolStarting = starting.then(
    (value) => {
      claudeToolStarting = null;
      return value;
    },
    (error) => {
      claudeToolStarting = null;
      throw error;
    }
  );
  return claudeToolStarting;
}

async function claudeExecutable(at) {
  if (process.platform !== "win32" || /\.(cmd|bat|exe)$/i.test(at)) return at;
  for (const suffix of [".exe", ".cmd", ".bat"]) {
    try {
      await promises.access(at + suffix);
      return at + suffix;
    } catch {

    }
  }
  return at;
}

async function claudeShimScript(at) {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(at)) return null;
  let text;
  try {
    text = await promises.readFile(at, "utf8");
  } catch {
    return null;
  }

  const found = text.match(/%~?dp0%?[\\/]?([^"\r\n]+?\.[cm]?js)\b/i);
  if (!found) return null;
  const script = node_path.resolve(node_path.dirname(at), found[1].replace(/^[\\/]+/, ""));
  try {
    await promises.access(script);
    return script;
  } catch {
    return null;
  }
}

async function claudeCodePath() {
  await refreshPath();
  const found = await commandExists("claude");
  if (found) return claudeExecutable(found);

  const prefix = await readCommand("npm", ["prefix", "-g"]);
  if (!prefix) return null;
  const at = await findIn([prefix, node_path.join(prefix, "bin")], "claude");
  return at ? claudeExecutable(at) : null;
}

async function claudeCodeInstall(track) {
  const npm = await commandExists("npm");
  if (!npm) {
    const bootstrap = await bootstrapManager("npm", track);
    if (!bootstrap.ok) {
      return { ok: false, error: bootstrap.detail || "Node.js could not be installed." };
    }
  }
  const run = await runManager(
    "npm",
    ["install", "-g", "--allow-scripts=@anthropic-ai/claude-code", "@anthropic-ai/claude-code"],
    { track }
  );
  if (!run.ok) return { ok: false, error: run.detail ?? "The install failed." };
  const at = await claudeCodePath();
  return at ? { ok: true, path: at } : { ok: false, error: "It installed but could not be found." };
}

async function aiRunClaudeCodeTurn({ root, model, system, messages, signal, send }) {
  const at = await claudeCodePath();
  if (!at) {
    send({ type: "error", message: "The Claude Code CLI is not installed." });
    return { ok: false, error: "not-installed" };
  }

  const script = await claudeShimScript(at);
  const viaShim = !script && process.platform === "win32" && /\.(cmd|bat)$/i.test(at);

  const bridge = await claudeToolBridge();
  const token = node_crypto.randomBytes(32).toString("hex");
  claudeToolTurns.set(token, { root: root ?? "", send });

  let configDir = "";
  const sweep = () => {
    claudeToolTurns.delete(token);
    if (configDir) void promises.rm(configDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const transcript = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => `${message.role === "user" ? "Human" : "Assistant"}: ${message.content ?? ""}`)
      .join("\n\n");

    const prompt = viaShim && system ? `System: ${system}\n\n${transcript}` : transcript;

    let configFile = "";
    try {
      configDir = await promises.mkdtemp(node_path.join(node_os.tmpdir(), "wide-mcp-"));
      configFile = node_path.join(configDir, "mcp.json");
      await promises.writeFile(
        configFile,
        JSON.stringify({
          mcpServers: {
            wide: {
              command: process.execPath,
              args: [node_path.join(appRoot(), "sidecar", "ai-mcp.cjs")],
              env: {
                WIDE_AI_PORT: String(bridge.port),
                WIDE_AI_TOKEN: token,
                WIDE_AI_ROOT: root ?? "",
              },
            },
          },
        }),
        "utf8"
      );
    } catch (error) {
      const message = `The MCP config could not be written: ${error.message}`;
      send({ type: "error", message });
      return { ok: false, error: message };
    }

    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
      "--mcp-config",
      configFile,

      "--disallowedTools",
      ...CLAUDE_DISALLOWED,

      "--permission-mode",
      "bypassPermissions",
    ];

    if (system && !viaShim) args.push("--append-system-prompt", system);
    if (model) args.push("--model", model);

    const quote = (value) => {
      const flat = String(value).replace(/[\r\n]+/g, " ");
      return /[\s"^&|<>()]/.test(flat) ? `"${flat.replace(/"/g, '\\"')}"` : flat;
    };
    const file = script ? process.execPath : viaShim ? process.env.ComSpec || "cmd.exe" : at;
    const argv = script
      ? [script, ...args]
      : viaShim
        ? ["/d", "/s", "/c", `"${[at, ...args].map(quote).join(" ")}"`]
        : args;

    let child;
    try {
      child = node_child_process.spawn(file, argv, {
        cwd: root || undefined,
        windowsHide: true,
        windowsVerbatimArguments: viaShim,
        env: { ...process.env, CI: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      send({ type: "error", message: String(error.message || error) });
      return { ok: false, error: String(error.message || error) };
    }

    if (signal?.aborted) killProcessTree(child);
    else signal?.addEventListener("abort", () => killProcessTree(child), { once: true });

    child.stdin.on("error", () => {});
    child.stdin.end(prompt);

    const errors = new StringDecoder("utf8");
    let stderr = "";
    child.stderr.on("error", () => {});
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16384) stderr += errors.write(chunk);
    });

    let answered = false;
    let buffer = "";

    const toolNames = new Map();

    const handle = (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }

      if (event.type === "assistant") {
        for (const block of event.message?.content ?? []) {
          if (block.type === "text" && block.text) {
            answered = true;
            send({ type: "text", text: block.text });
          } else if (block.type === "thinking" && block.thinking) {
            send({ type: "thinking", text: block.thinking });
          } else if (block.type === "tool_use") {

            const called = String(block.name ?? "").replace(/^mcp__wide__/, "");
            toolNames.set(block.id, called);
            send({ type: "tool_start", name: called, input: block.input ?? {} });
          }
        }
      } else if (event.type === "user") {
        for (const block of event.message?.content ?? []) {
          if (block.type === "tool_result") {
            const text = Array.isArray(block.content)
              ? block.content.map((part) => part.text ?? "").join("")
              : String(block.content ?? "");

            send({
              type: "tool_end",
              name: toolNames.get(block.tool_use_id) ?? "",
              result: text,
            });
          }
        }
      } else if (event.type === "result") {
        if (event.usage) {
          send({
            type: "usage",
            input: event.usage.input_tokens ?? 0,
            output: event.usage.output_tokens ?? 0,
            total: (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0),
          });
        }
        if (event.is_error) {
          send({ type: "error", message: String(event.result ?? "Claude Code reported an error.") });
        }
      }
    };

    const output = new StringDecoder("utf8");
    child.stdout.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      buffer += output.write(chunk);
      let cut;
      while ((cut = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (line) handle(line);
      }
    });

    const code = await new Promise((resolve) => {
      child.on("error", () => resolve(-1));
      child.on("close", (value) => resolve(value ?? -1));
    });

    if (signal?.aborted) return { ok: false, error: "stopped" };
    if (code !== 0 && !answered) {
      const said = stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-1)[0];

      const signedOut = /not.*(logged in|authenticated)|credentials|setup-token/i.test(stderr);
      const message = signedOut
        ? "Claude Code is not signed in yet."
        : said || `Claude Code exited with code ${code}.`;

      if (signedOut) await rememberClaudeCode(false);
      send({ type: "error", message });
      return { ok: false, error: message };
    }

    if (answered) await rememberClaudeCode(true);
    return { ok: true, answered };
  } finally {
    sweep();
  }
}

async function rememberClaudeCode(signedIn) {
  const config = await readAiConfig();
  if (config.claudeCodeSignedIn === signedIn) return;
  await writeAiConfig({ ...config, claudeCodeSignedIn: signedIn });
}

function appRoot() {

  return node_path.resolve(node_path.dirname(process.argv[1] ?? "."), "..");
}

function registerClaudeCodeHandlers() {

  electron.ipcMain.handle("ai:claudeCodeStatus", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const at = await claudeCodePath();
    if (!at) return { ok: true, installed: false, signedIn: false };
    const config = await readAiConfig();
    return { ok: true, installed: true, path: at, signedIn: config.claudeCodeSignedIn === true };
  });

  electron.ipcMain.handle("ai:claudeCodeInstall", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    return claudeCodeInstall(null);
  });

  electron.ipcMain.handle("ai:claudeCodeLogin", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const at = await claudeCodePath();
    if (!at) return { ok: false, error: "The Claude Code CLI is not installed." };
    try {
      const child = node_child_process.spawn(
        process.env.ComSpec || "cmd.exe",
        ["/c", "start", "", "cmd", "/k", `"${at}" setup-token`],
        { detached: true, stdio: "ignore", windowsHide: false }
      );
      child.unref();

      const config = await readAiConfig();
      if (config.claudeCodeSignedIn) await writeAiConfig({ ...config, claudeCodeSignedIn: false });
      return { ok: true, started: true };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });
}
