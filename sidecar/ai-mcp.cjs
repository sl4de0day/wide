'use strict';

const http = require('node:http');
const readline = require('node:readline');

const PORT = Number(process.env.WIDE_AI_PORT || 0);
const TOKEN = process.env.WIDE_AI_TOKEN || '';
const ROOT = process.env.WIDE_AI_ROOT || '';

if (!PORT || !TOKEN) {
  process.stderr.write('ai-mcp: no port or token; nothing to proxy to.\n');
  process.exit(1);
}

const TOOLS = [
  {
    name: 'read_file',
    description:
      "Read a text file from the open project. Give a path relative to the project root. Returns the contents with line numbers, so you can refer to a line when you answer.",
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the project root.' } },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description:
      'List the files and folders in one directory of the project. Use this to find your way around before reading; it is much cheaper than reading files to see what exists.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory relative to the project root. Empty means the root.' },
      },
      required: [],
    },
  },
  {
    name: 'search',
    description:
      'Search the whole project for a string or regular expression. Returns matching files with line numbers. The fastest way to find where something is defined or used.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regular expression to find.' },
        regex: { type: 'boolean' },
        caseSensitive: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_file',
    description:
      'Open a file in the editor so the person can see it. It does not return the contents; read_file does that.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root.' },
        line: { type: 'number', description: 'Line to scroll to, 1-based.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Replace a file\'s entire contents. Read it first; you are replacing all of it, not appending. The change goes into the editor rather than the disk, so one undo takes it back and nothing is saved until the person saves it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root.' },
        content: { type: 'string', description: 'The complete new contents.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'transform_data',
    description:
      'Transform, encode, decode, hash, or format data using Wide\'s CyberChef / Decoder engine. Supported operations: base64_encode, base64_decode, hex_encode, hex_decode, url_encode, url_decode, jwt_decode, md5, sha1, sha256, sha512, rot13, gzip_compress, gzip_decompress, json_format.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description:
            'The transformation operation to perform. Supported: base64_encode, base64_decode, hex_encode, hex_decode, url_encode, url_decode, jwt_decode, md5, sha1, sha256, sha512, rot13, gzip_compress, gzip_decompress, json_format.',
        },
        input: {
          type: 'string',
          description: 'The input text or data to transform.',
        },
      },
      required: ['operation', 'input'],
    },
  },
  {
    name: 'open_tool_tab',
    description:
      'Open or navigate to a specific tool or panel tab in Wide IDE (Pitcher API client, Catcher web proxy, scanner, repeater, intruder, CyberChef/decoder, terminal, problems/diagnostics, findings, browser, explorer, search, settings).',
    inputSchema: {
      type: 'object',
      properties: {
        tab: {
          type: 'string',
          description:
            'Target tool or panel name. Options: pitcher, catcher, scanner, repeater, intruder, proxy, cyberchef, decoder, terminal, problems, findings, browser, explorer, search, git, tests, settings.',
        },
        subtool: {
          type: 'string',
          description: 'Optional subtool for Catcher workbench (e.g. scanner, repeater, intruder, proxy, target, sequencer).',
        },
      },
      required: ['tab'],
    },
  },
  {
    name: 'get_diagnostics',
    description:
      'Inspect compile errors, TypeScript issues, syntax problems, and linter warnings for a specific file or the entire project. Call this after editing code to verify the workspace builds without errors.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to a specific file relative to the project root. If omitted, returns a project-wide diagnostics summary.',
        },
      },
      required: [],
    },
  },
  {
    name: 'send_http_request',
    description:
      'Send an HTTP or HTTPS request using Wide\'s Pitcher engine. Allows inspecting API responses, testing endpoints, verifying web vulnerabilities, checking status codes, headers, response times, and bodies.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Target HTTP or HTTPS URL (e.g. http://localhost:3000/api/users or https://httpbin.org/get).',
        },
        method: {
          type: 'string',
          description: 'HTTP method: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS. Defaults to GET.',
        },
        headers: {
          type: 'object',
          description: 'Optional key-value pairs of request headers (e.g. {"Content-Type": "application/json"}).',
        },
        body: {
          type: 'string',
          description: 'Optional request body (string, JSON string, or form payload).',
        },
        insecure: {
          type: 'boolean',
          description: 'Whether to allow self-signed or invalid SSL certificates. Defaults to true.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'run_security_scan',
    description:
      'Run Wide\'s real-time security AST analysis and taint flow scanner on the project workspace or a specific file. Detects vulnerabilities such as SQL injection, XSS, SSRF, command injection, path traversal, hardcoded secrets, and cryptographic weaknesses.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to a specific file relative to the project root (optional). If omitted, scans the entire workspace.',
        },
        minSeverity: {
          type: 'string',
          description: 'Minimum severity filter: info, warning, or error. Defaults to info.',
        },
      },
      required: [],
    },
  },
  {
    name: 'check_dependencies',
    description:
      'Audit project dependencies for known CVEs and security advisories using Wide\'s OSV advisory engine. Inspects package.json, requirements.txt, go.mod, pom.xml, and lockfiles.',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: {
          type: 'string',
          description: 'Path to a specific manifest file (optional, e.g. package.json or requirements.txt). If omitted, audits all manifests.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_open_tabs',
    description:
      'Get the list of currently open tabs and files in the Wide editor, including the active tab, file paths, and document kinds.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'manage_catcher',
    description:
      'Control Wide\'s built-in Catcher web security workbench and intercepting proxy. Allows starting/stopping the proxy server, inspecting proxy status and listening port, viewing live captured HTTP traffic, and configuring request interception.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            'Action to perform: status (get proxy state, port, traffic count), start (start proxy on 127.0.0.1), stop (stop proxy), get_traffic (view recent captured HTTP requests/responses), or set_intercept (toggle request interception on/off).',
          enum: ['status', 'start', 'stop', 'get_traffic', 'set_intercept'],
        },
        intercept: {
          type: 'boolean',
          description: 'Whether request interception should be enabled (only used when action is set_intercept).',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of recent traffic entries to return (defaults to 15, max 50).',
        },
      },
      required: ['action'],
    },
  },
];

function callWide(name, args) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ root: ROOT, name, input: args || {} });
    const request = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: '/tool',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),

          authorization: `Bearer ${TOKEN}`,
        },
        timeout: 120000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('error', () => resolve('That tool could not be run: the reply was cut off.'));
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => {
          if (response.statusCode !== 200) {
            resolve(`That tool could not be run: ${body.slice(0, 200) || response.statusCode}`);
            return;
          }
          try {
            resolve(String(JSON.parse(body).result ?? ''));
          } catch {
            resolve(body.slice(0, 4000));
          }
        });
      }
    );
    request.on('timeout', () => {
      request.destroy();
      resolve('That tool took too long and was stopped.');
    });
    request.on('error', (error) => resolve(`That tool could not be run: ${error.message}`));
    request.end(payload);
  });
}

const write = (message) => {
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch {
    process.exit(0);
  }
};
const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const text = line.trim();
  if (!text) return;

  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }

  if (message.id === undefined) return;

  try {
    if (message.method === 'initialize') {
      reply(message.id, {

        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'wide', version: '1.0.0' },
      });
      return;
    }

    if (message.method === 'tools/list') {
      reply(message.id, { tools: TOOLS });
      return;
    }

    if (message.method === 'tools/call') {
      const rawName = message.params?.name ?? '';
      const name = String(rawName).replace(/^mcp__(?:wide__)?|^wide_/, '');
      if (!TOOLS.some((tool) => tool.name === name || tool.name === rawName)) {
        reply(message.id, {
          content: [{ type: 'text', text: `There is no tool called ${rawName}.` }],
          isError: true,
        });
        return;
      }
      const result = await callWide(name, message.params?.arguments);
      reply(message.id, { content: [{ type: 'text', text: result }] });
      return;
    }

    if (message.method === 'ping') {
      reply(message.id, {});
      return;
    }

    fail(message.id, -32601, `Unknown method ${message.method}`);
  } catch (error) {
    fail(message.id, -32603, String((error && error.message) || error));
  }
});

process.stdout.on('error', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
