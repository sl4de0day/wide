

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

let claudeToolServer = null;

function claudeToolBridge() {
  if (claudeToolServer) return Promise.resolve(claudeToolServer);
  return new Promise((resolve, reject) => {
    const token = node_crypto.randomBytes(32).toString("hex");
    const server = node_http.createServer(async (request, response) => {
      const finish = (status, body) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.method !== "POST" || request.url !== "/tool") return finish(404, {});
      if (request.headers.authorization !== `Bearer ${token}`) return finish(403, {});

      let body = "";
      request.on("data", (chunk) => {

        if (body.length < 16 * 1024 * 1024) body += chunk;
      });
      request.on("end", async () => {
        let call;
        try {
          call = JSON.parse(body);
        } catch {
          return finish(400, { result: "That request was not valid JSON." });
        }
        try {

          const result = await aiRunTool(
            call.root ?? "",
            call.name ?? "",
            call.input ?? {},
            claudeToolSend
          );
          finish(200, { result });
        } catch (error) {
          finish(200, { result: `That tool failed: ${String(error.message || error)}` });
        }
      });
    });

    server.on("error", reject);
    server.listen(0, CLAUDE_TOOL_PORT_HOST, () => {
      claudeToolServer = { server, token, port: server.address().port };
      resolve(claudeToolServer);
    });
  });
}

let claudeToolSend = () => {};

async function claudeExecutable(at) {
  if (process.platform !== "win32" || /\.(cmd|bat|exe)$/i.test(at)) return at;
  for (const suffix of [".cmd", ".bat", ".exe"]) {
    try {
      await promises.access(at + suffix);
      return at + suffix;
    } catch {

    }
  }
  return at;
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

  const bridge = await claudeToolBridge();
  claudeToolSend = send;

  const prompt = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "Human" : "Assistant"}: ${message.content ?? ""}`)
    .join("\n\n");

  let configDir = "";
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
              WIDE_AI_TOKEN: bridge.token,
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

  if (system) args.push("--append-system-prompt", system);
  if (model) args.push("--model", model);

  const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(at);
  const quote = (value) =>
    /[\s"^&|<>()]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  const file = shim ? process.env.ComSpec || "cmd.exe" : at;
  const argv = shim
    ? ["/d", "/s", "/c", `"${[at, ...args].map(quote).join(" ")}"`]
    : args;

  const sweep = () => {
    if (configDir) void promises.rm(configDir, { recursive: true, force: true }).catch(() => {});
  };

  let child;
  try {
    child = node_child_process.spawn(file, argv, {
      cwd: root || undefined,
      windowsHide: true,
      windowsVerbatimArguments: shim,
      env: { ...process.env, CI: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    sweep();
    send({ type: "error", message: String(error.message || error) });
    return { ok: false, error: String(error.message || error) };
  }

  signal?.addEventListener("abort", () => killProcessTree(child), { once: true });
  child.stdin.end(prompt);

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 16384) stderr += chunk;
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

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line) handle(line);
    }
  });

  const code = await new Promise((resolve) => {
    child.on("error", () => resolve(-1));
    child.on("close", (value) => resolve(value ?? -1));
  });
  claudeToolSend = () => {};
  sweep();

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
