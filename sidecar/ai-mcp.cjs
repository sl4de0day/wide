"use strict";

const node_http = require("node:http");
const {
  Server,
  StdioServerTransport,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require("./mcp-vendor.cjs");

const PORT = Number(process.env.WIDE_AI_PORT || "0");
const TOKEN = String(process.env.WIDE_AI_TOKEN || "");
const ROOT = String(process.env.WIDE_AI_ROOT || "");

let cachedTools = [];

function httpRequest(method, path, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    if (!PORT) {
      reject(new Error("Wide AI bridge port is not set."));
      return;
    }
    const body = payload !== undefined ? JSON.stringify(payload) : "";
    const req = node_http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        method,
        path,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          ...(body ? { "content-length": Buffer.byteLength(body, "utf8") } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 200, json: JSON.parse(data || "{}") });
          } catch {
            resolve({ status: res.statusCode || 200, json: { result: data } });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Wide AI bridge request timed out.")));
    if (body) req.write(body);
    req.end();
  });
}

async function fetchBridgeTools() {
  try {
    const reply = await httpRequest("GET", "/tools", undefined, 5000);
    if (reply.status === 200 && Array.isArray(reply.json?.tools) && reply.json.tools.length > 0) {
      cachedTools = reply.json.tools.map((t) => ({
        name: String(t.name),
        description: String(t.description || ""),
        inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
      }));
    }
  } catch {
    void 0;
  }
  return cachedTools;
}

const server = new Server(
  { name: "wide", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await fetchBridgeTools();
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = String(request?.params?.name || "");
  const input = request?.params?.arguments && typeof request.params.arguments === "object"
    ? request.params.arguments
    : {};
  try {
    const reply = await httpRequest("POST", "/tool", { name, input, root: ROOT }, 120000);
    const text =
      typeof reply.json?.result === "string"
        ? reply.json.result
        : JSON.stringify(reply.json ?? {}, null, 2);
    return {
      content: [{ type: "text", text }],
      isError: reply.status >= 400,
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Tool '${name}' failed: ${String(error?.message || error)}` }],
      isError: true,
    };
  }
});

async function main() {
  await fetchBridgeTools();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`wide-mcp fatal: ${String(error?.stack || error)}\n`);
  process.exit(1);
});
