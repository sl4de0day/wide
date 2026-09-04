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

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
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
      const name = message.params?.name ?? '';
      if (!TOOLS.some((tool) => tool.name === name)) {
        reply(message.id, {
          content: [{ type: 'text', text: `There is no tool called ${name}.` }],
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

process.stdin.on('close', () => process.exit(0));
