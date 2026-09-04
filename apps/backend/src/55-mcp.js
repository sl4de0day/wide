

const MCP_PREFIX = "mcp__";

const mcpConnections = new Map();

function mcpConfigPath(root) {
  return node_path.join(root, ".wide", "mcp.json");
}

async function readMcpConfig(root) {
  if (!root) return {};
  try {
    const parsed = JSON.parse(await promises.readFile(mcpConfigPath(root), "utf8"));
    return parsed && typeof parsed === "object" && parsed.servers && typeof parsed.servers === "object"
      ? parsed.servers
      : {};
  } catch {
    return {};
  }
}

function mcpSend(conn, method, params) {
  return new Promise((resolve, reject) => {
    const id = conn.nextId++;
    conn.pending.set(id, { resolve, reject });
    try {
      conn.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    } catch (error) {
      conn.pending.delete(id);
      reject(error);
      return;
    }
    setTimeout(() => {
      if (conn.pending.has(id)) {
        conn.pending.delete(id);
        reject(new Error("The MCP server did not answer in time."));
      }
    }, 30000);
  });
}

function mcpNotify(conn, method, params) {
  try {
    conn.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  } catch {

  }
}

async function connectMcp(name, spec) {
  const child = node_child_process.spawn(spec.command, Array.isArray(spec.args) ? spec.args : [], {
    env: { ...process.env, ...(spec.env && typeof spec.env === "object" ? spec.env : {}) },
    cwd: typeof spec.cwd === "string" ? spec.cwd : undefined,
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
    windowsHide: true,
  });
  const conn = { child, nextId: 1, pending: new Map(), tools: [], name };

  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && conn.pending.has(message.id)) {
        const waiter = conn.pending.get(message.id);
        conn.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message || "MCP error"));
        else waiter.resolve(message.result);
      }

    }
  });
  child.on("error", () => {});
  child.on("close", () => {
    mcpConnections.delete(name);
    for (const waiter of conn.pending.values()) waiter.reject(new Error("The MCP server closed."));
    conn.pending.clear();
  });

  await mcpSend(conn, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "Wide", version: "1.0" },
  });
  mcpNotify(conn, "notifications/initialized", {});
  const list = await mcpSend(conn, "tools/list", {});
  conn.tools = Array.isArray(list && list.tools) ? list.tools : [];
  return conn;
}

async function ensureMcp(root) {
  const servers = await readMcpConfig(root);
  for (const [name, spec] of Object.entries(servers)) {
    if (!spec || typeof spec.command !== "string" || mcpConnections.has(name)) continue;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) continue;
    try {
      mcpConnections.set(name, await connectMcp(name, spec));
    } catch {
      mcpConnections.delete(name);
    }
  }
}

function mcpToolSpecs() {
  const specs = [];
  for (const conn of mcpConnections.values()) {
    for (const tool of conn.tools) {
      if (!tool || typeof tool.name !== "string") continue;
      specs.push({
        name: `${MCP_PREFIX}${conn.name}__${tool.name}`,
        description: tool.description || `${tool.name} (from the ${conn.name} server)`,
        parameters:
          tool.inputSchema && typeof tool.inputSchema === "object"
            ? tool.inputSchema
            : { type: "object", properties: {} },
      });
    }
  }
  return specs;
}

function isMcpTool(name) {
  return typeof name === "string" && name.startsWith(MCP_PREFIX);
}

async function mcpCallTool(name, input) {
  const rest = name.slice(MCP_PREFIX.length);
  const sep = rest.indexOf("__");
  if (sep === -1) return "That is not a valid MCP tool.";
  const serverName = rest.slice(0, sep);
  const toolName = rest.slice(sep + 2);
  const conn = mcpConnections.get(serverName);
  if (!conn) return `The MCP server "${serverName}" is not connected.`;
  try {
    const result = await mcpSend(conn, "tools/call", { name: toolName, arguments: input || {} });
    const text = Array.isArray(result && result.content)
      ? result.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")
      : JSON.stringify(result);
    return result && result.isError ? `The tool reported an error:\n${text}` : text || "(no output)";
  } catch (error) {
    return `The MCP tool failed: ${String(error.message || error)}`;
  }
}
