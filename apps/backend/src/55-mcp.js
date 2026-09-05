

const MCP_PREFIX = "mcp__";
const MCP_HANDSHAKE_TIMEOUT_MS = 15000;
const MCP_CALL_TIMEOUT_MS = 120000;
const MCP_RETRY_AFTER_MS = 60000;
const MCP_MAX_DESCRIPTION = 4096;
const MCP_MAX_SCHEMA = 20000;

const mcpConnections = new Map();
const mcpStarting = new Map();
const mcpBroken = new Map();

let mcpRoot = null;

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

function mcpSend(conn, method, params, timeout) {
  return new Promise((resolve, reject) => {
    const id = conn.nextId++;
    const timer = setTimeout(() => {
      if (conn.pending.delete(id)) reject(new Error("The MCP server did not answer in time."));
    }, timeout);
    timer.unref();

    conn.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });

    try {
      conn.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    } catch (error) {
      clearTimeout(timer);
      conn.pending.delete(id);
      reject(error);
    }
  });
}

function mcpNotify(conn, method, params) {
  try {
    conn.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  } catch {

  }
}

function mcpKill(conn) {
  conn.closed = true;
  try {
    conn.child.stdin.end();
  } catch {

  }
  killProcessTree(conn.child);
  try {
    conn.child.kill();
  } catch {

  }
}

function mcpDisposeAll() {
  for (const conn of mcpConnections.values()) mcpKill(conn);
  mcpConnections.clear();
  mcpStarting.clear();
  mcpBroken.clear();
  mcpPending.clear();
  mcpRoot = null;
}

process.on("exit", mcpDisposeAll);

async function connectMcp(root, name, spec, signature) {
  const child = node_child_process.spawn(spec.command, Array.isArray(spec.args) ? spec.args : [], {
    env: { ...process.env, ...(spec.env && typeof spec.env === "object" ? spec.env : {}) },
    cwd: typeof spec.cwd === "string" ? spec.cwd : undefined,
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
    windowsHide: true,
  });
  const conn = { child, nextId: 1, pending: new Map(), tools: [], name, root, signature, closed: false };

  const decoder = new StringDecoder("utf8");
  let buffer = "";
  child.stdin.on("error", () => {});
  child.stdout.on("error", () => {});
  child.stdout.on("data", (chunk) => {
    buffer += decoder.write(chunk);
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

  const gone = () => {
    conn.closed = true;
    if (mcpConnections.get(name) === conn) mcpConnections.delete(name);
    for (const waiter of conn.pending.values()) waiter.reject(new Error("The MCP server closed."));
    conn.pending.clear();
  };
  child.on("error", gone);
  child.on("close", gone);

  try {
    await mcpSend(
      conn,
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "Wide", version: "1.0" },
      },
      MCP_HANDSHAKE_TIMEOUT_MS
    );
    mcpNotify(conn, "notifications/initialized", {});
    const list = await mcpSend(conn, "tools/list", {}, MCP_HANDSHAKE_TIMEOUT_MS);
    conn.tools = Array.isArray(list && list.tools) ? list.tools : [];
  } catch (error) {
    mcpKill(conn);
    throw error;
  }
  return conn;
}

const mcpPending = new Map();

function mcpTrustFile() {
  return node_path.join(electron.app.getPath("userData"), "mcp-trust.json");
}

function mcpSignature(root, name, spec) {
  const args = Array.isArray(spec.args) ? spec.args : [];
  const env =
    spec.env && typeof spec.env === "object" && !Array.isArray(spec.env)
      ? Object.entries(spec.env).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      : [];
  const cwd = typeof spec.cwd === "string" ? spec.cwd : "";
  return node_crypto
    .createHash("sha256")
    .update([root, name, spec.command, JSON.stringify(args), JSON.stringify(env), cwd].join(" "))
    .digest("hex")
    .slice(0, 32);
}

async function readMcpTrust() {
  try {
    const parsed = JSON.parse(await promises.readFile(mcpTrustFile(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMcpTrust(trust) {
  try {
    await promises.mkdir(node_path.dirname(mcpTrustFile()), { recursive: true });
    await promises.writeFile(mcpTrustFile(), JSON.stringify(trust, null, 2), "utf8");
  } catch {
    void 0;
  }
}

function mcpReap(root, wanted) {
  for (const [name, conn] of [...mcpConnections]) {
    if (conn.root === root && wanted.get(name)?.signature === conn.signature) continue;
    mcpConnections.delete(name);
    mcpKill(conn);
  }
  for (const [name, failure] of [...mcpBroken]) {
    if (failure.root !== root || !wanted.has(name)) mcpBroken.delete(name);
  }
}

async function ensureMcp(root) {
  const servers = await readMcpConfig(root);
  const trust = await readMcpTrust();

  const wanted = new Map();
  const asked = new Map();
  for (const [name, spec] of Object.entries(servers)) {
    if (!spec || typeof spec.command !== "string") continue;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) continue;
    const signature = mcpSignature(root, name, spec);
    if (trust[signature] === true) {
      wanted.set(name, { spec, signature });
      continue;
    }
    asked.set(name, {
      name,
      signature,
      command: spec.command,
      args: Array.isArray(spec.args) ? spec.args : [],
    });
  }

  mcpRoot = root;
  mcpPending.clear();
  for (const [name, entry] of asked) mcpPending.set(name, entry);
  mcpReap(root, wanted);

  for (const [name, entry] of wanted) {
    const startKey = `${root}\u0000${name}`;
    if (mcpConnections.has(name) || mcpStarting.has(startKey)) continue;
    const failure = mcpBroken.get(name);
    if (failure && failure.signature === entry.signature && Date.now() - failure.at < MCP_RETRY_AFTER_MS) {
      continue;
    }
    const attempt = connectMcp(root, name, entry.spec, entry.signature)
      .then(
        (conn) => {
          mcpBroken.delete(name);
          if (conn.closed || mcpRoot !== root) {
            mcpKill(conn);
            return;
          }
          mcpConnections.set(name, conn);
        },
        () => {
          mcpBroken.set(name, { signature: entry.signature, root, at: Date.now() });
        }
      )
      .finally(() => {
        mcpStarting.delete(startKey);
      });
    mcpStarting.set(startKey, attempt);
  }

  await Promise.all([...mcpStarting.values()]);

  broadcast("mcp:pending", { root, servers: [...mcpPending.values()] });
}

function registerMcpHandlers() {
  electron.ipcMain.handle("mcp:pending", async () => ({ ok: true, servers: [...mcpPending.values()] }));

  electron.ipcMain.handle("mcp:trust", async (_event, signature, allow) => {
    const offered = [...mcpPending.values()].some((entry) => entry.signature === signature);
    if (typeof signature !== "string" || !/^[0-9a-f]{32}$/.test(signature) || (allow && !offered)) {
      return { ok: false, error: "That is not a server Wide offered to run." };
    }
    const trust = await readMcpTrust();
    if (allow) trust[signature] = true;
    else delete trust[signature];
    await writeMcpTrust(trust);

    if (mcpRoot) {
      try {
        await ensureMcp(mcpRoot);
      } catch {
        void 0;
      }
    }
    return { ok: true };
  });
}

function mcpUsableSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  if (schema.type !== "object") return false;
  if (schema.properties !== undefined && (typeof schema.properties !== "object" || Array.isArray(schema.properties))) {
    return false;
  }
  if (schema.required !== undefined && !Array.isArray(schema.required)) return false;
  try {
    return JSON.stringify(schema).length <= MCP_MAX_SCHEMA;
  } catch {
    return false;
  }
}

function mcpToolId(server, tool) {
  if (!/^[A-Za-z0-9_-]+$/.test(server) || !/^[A-Za-z0-9_.-]+$/.test(tool)) return "";
  const plain = `${MCP_PREFIX}${server}__${tool.replace(/\./g, "_")}`;
  if (plain.length <= 64) return plain;
  const tag = node_crypto.createHash("sha256").update(`${server}\u0000${tool}`).digest("hex").slice(0, 8);
  return `${plain.slice(0, 55)}_${tag}`;
}

function mcpToolSpecs() {
  const specs = [];
  const seen = new Set();
  for (const conn of mcpConnections.values()) {
    for (const tool of conn.tools) {
      if (!tool || typeof tool.name !== "string") continue;
      const id = mcpToolId(conn.name, tool.name);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const described =
        typeof tool.description === "string" && tool.description.trim()
          ? tool.description.trim().slice(0, MCP_MAX_DESCRIPTION)
          : `${tool.name} (from the ${conn.name} server)`;
      specs.push({
        name: id,
        description: described,
        parameters: mcpUsableSchema(tool.inputSchema)
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

function mcpFindTool(name) {
  for (const conn of mcpConnections.values()) {
    for (const tool of conn.tools) {
      if (!tool || typeof tool.name !== "string") continue;
      if (mcpToolId(conn.name, tool.name) === name) return { conn, called: tool.name };
    }
  }
  return null;
}

async function mcpCallTool(name, input) {
  const found = mcpFindTool(name);
  if (!found) {
    const rest = name.slice(MCP_PREFIX.length);
    const sep = rest.indexOf("__");
    if (sep === -1) return "That is not a valid MCP tool.";
    return mcpConnections.has(rest.slice(0, sep))
      ? `There is no tool called ${name}.`
      : `The MCP server "${rest.slice(0, sep)}" is not connected.`;
  }
  try {
    const result = await mcpSend(
      found.conn,
      "tools/call",
      { name: found.called, arguments: input || {} },
      MCP_CALL_TIMEOUT_MS
    );
    const text = Array.isArray(result && result.content)
      ? result.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")
      : JSON.stringify(result);
    return result && result.isError ? `The tool reported an error:\n${text}` : text || "(no output)";
  } catch (error) {
    return `The MCP tool failed: ${String(error.message || error)}`;
  }
}
