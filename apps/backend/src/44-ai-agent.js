const AI_MAX_TOOL_ROUNDS = 24;
const AI_MAX_TOOL_RESULT_BYTES = 100 * 1024;

const AI_TOOLS = [
  {
    name: "read_file",
    description:
      "Read a text file from the open project workspace. Give a path relative to the project root. Returns the file's contents with line numbers.",
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
      "List the files and folders in one directory of the project workspace. Empty path lists the project root.",
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
      "Search the whole project for a string or regular expression. Returns matching files with line numbers and matching lines.",
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
      "Find the files most relevant to a description or set of terms, ranked across the whole project, each with a short snippet.",
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
      "Open a file in the Wide editor so the user can view it. Does not return the file contents; use read_file to read contents.",
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
      "Create a new file or replace an existing file's entire contents directly in the project workspace on disk. Always use this tool when creating a new script/file or rewriting a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root (e.g. 'script.py' or 'src/utils.ts')." },
        content: { type: "string", description: "The complete contents to write to the file." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Make a targeted change to an existing file in the project workspace by replacing an exact snippet (`find`) with new text (`replace`). Read the file first with read_file so `find` matches the existing text.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root." },
        find: { type: "string", description: "Exact text in the file to replace." },
        replace: { type: "string", description: "Replacement text." },
      },
      required: ["path", "find", "replace"],
    },
  },
  {
    name: "create_dir",
    description:
      "Create a new directory (and any parent directories) in the project workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to the project root." },
      },
      required: ["path"],
    },
  },
  {
    name: "delete_file",
    description:
      "Delete a file from the project workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root." },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command in the project root and return its combined output and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command line to run, e.g. 'npm test' or 'python script.py'." },
      },
      required: ["command"],
    },
  },
  {
    name: "git",
    description:
      "Run a git command in the project and return its output. Allowed: status, diff, log, show, branch, rev-parse, remote, add, commit.",
    parameters: {
      type: "object",
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
          description: 'git arguments as an array, e.g. ["status"] or ["diff"].',
        },
      },
      required: ["args"],
    },
  },
  {
    name: "transform_data",
    description:
      "Transform, encode, decode, hash, or format data using Wide's CyberChef / Decoder engine. Supported operations: base64_encode, base64_decode, hex_encode, hex_decode, url_encode, url_decode, jwt_decode, md5, sha1, sha256, sha512, rot13, gzip_compress, gzip_decompress, json_format.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description:
            "The transformation operation to perform. Supported: base64_encode, base64_decode, hex_encode, hex_decode, url_encode, url_decode, jwt_decode, md5, sha1, sha256, sha512, rot13, gzip_compress, gzip_decompress, json_format.",
        },
        input: {
          type: "string",
          description: "The input text or data to transform.",
        },
      },
      required: ["operation", "input"],
    },
  },
  {
    name: "open_tool_tab",
    description:
      "Open or navigate to a specific tool or panel tab in Wide IDE (Pitcher API client, Catcher web proxy, scanner, repeater, intruder, CyberChef/decoder, terminal, problems/diagnostics, findings, browser, explorer, search, settings).",
    parameters: {
      type: "object",
      properties: {
        tab: {
          type: "string",
          description:
            "Target tool or panel name. Options: 'pitcher', 'catcher', 'scanner', 'repeater', 'intruder', 'proxy', 'cyberchef', 'decoder', 'terminal', 'problems', 'findings', 'browser', 'explorer', 'search', 'git', 'tests', 'settings'.",
        },
        subtool: {
          type: "string",
          description:
            "Optional subtool for Catcher workbench (e.g. 'scanner', 'repeater', 'intruder', 'proxy', 'target', 'sequencer').",
        },
      },
      required: ["tab"],
    },
  },
  {
    name: "get_diagnostics",
    description:
      "Inspect compile errors, TypeScript issues, syntax problems, and linter warnings for a specific file or the entire project. Call this after editing code to verify the workspace builds without errors.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path to a specific file relative to the project root. If omitted, returns a project-wide diagnostics summary.",
        },
      },
      required: [],
    },
  },
  {
    name: "send_http_request",
    description:
      "Send an HTTP or HTTPS request using Wide's Pitcher engine. Allows inspecting API responses, testing endpoints, verifying web vulnerabilities, checking status codes, headers, response times, and bodies.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Target HTTP or HTTPS URL (e.g. 'http://localhost:3000/api/users' or 'https://httpbin.org/get').",
        },
        method: {
          type: "string",
          description: "HTTP method: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS. Defaults to 'GET'.",
        },
        headers: {
          type: "object",
          description: "Optional key-value pairs of request headers (e.g. {'Content-Type': 'application/json', 'Authorization': 'Bearer ...'}).",
        },
        body: {
          type: "string",
          description: "Optional request body (string, JSON string, or form payload).",
        },
        insecure: {
          type: "boolean",
          description: "Whether to allow self-signed or invalid SSL certificates. Defaults to true for local testing.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "run_security_scan",
    description:
      "Run Wide's real-time security AST analysis and taint flow scanner on the project workspace or a specific file. Detects vulnerabilities such as SQL injection, XSS, SSRF, command injection, path traversal, hardcoded secrets, and cryptographic weaknesses.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path to a specific file relative to the project root (optional). If omitted, scans the entire workspace.",
        },
        minSeverity: {
          type: "string",
          description:
            "Minimum severity filter: 'info', 'warning', or 'error'. Defaults to 'info'.",
        },
      },
      required: [],
    },
  },
  {
    name: "check_dependencies",
    description:
      "Audit project dependencies for known CVEs and security advisories using Wide's OSV advisory engine. Inspects package.json, requirements.txt, go.mod, pom.xml, and lockfiles.",
    parameters: {
      type: "object",
      properties: {
        manifest: {
          type: "string",
          description:
            "Path to a specific manifest file (optional, e.g. 'package.json' or 'requirements.txt'). If omitted, audits all manifests across the project.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_open_tabs",
    description:
      "Get the list of currently open tabs and files in the Wide editor, including the active tab, file paths, and document kinds.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "manage_catcher",
    description:
      "Control Wide's built-in Catcher web security workbench and intercepting proxy. Allows starting/stopping the proxy server, inspecting proxy status and listening port, viewing live captured HTTP traffic, and configuring request interception.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "Action to perform: 'status' (get proxy running state, port, intercept state, traffic count), 'start' (start proxy server on 127.0.0.1), 'stop' (stop proxy), 'get_traffic' (view recent captured HTTP requests/responses), or 'set_intercept' (toggle request interception on/off).",
          enum: ["status", "start", "stop", "get_traffic", "set_intercept"],
        },
        intercept: {
          type: "boolean",
          description: "Whether request interception should be enabled (only used when action is 'set_intercept').",
        },
        limit: {
          type: "number",
          description: "Maximum number of recent traffic entries to return (defaults to 15, max 50).",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "decision_score",
    description: "Score and select the optimal candidate among alternatives using DecisionCore multi-criteria weighted scoring.",
    parameters: {
      type: "object",
      properties: {
        candidates: { type: "array", items: { type: "object" }, description: "Array of candidate objects to score." },
        criteria: { type: "array", items: { type: "object" }, description: "Array of criteria with field name and weight." },
        threshold: { type: "number", description: "Minimum acceptance threshold (defaults to 0.5)." }
      },
      required: ["candidates", "criteria"]
    }
  },
  {
    name: "decision_consensus",
    description: "Form an unweighted multi-agent consensus across discrete choices using DecisionCore PluralityConsensus.",
    parameters: {
      type: "object",
      properties: {
        classesCount: { type: "number", description: "Number of discrete choices/classes." },
        votes: { type: "array", items: { type: "object" }, description: "Array of votes with voterId and choice." },
        minVotes: { type: "number", description: "Minimum required votes to settle." }
      },
      required: ["votes"]
    }
  },
  {
    name: "decision_claim",
    description: "Acquire or check an exclusive lease on a shared resource slot using DecisionCore ClaimTable.",
    parameters: {
      type: "object",
      properties: {
        holderId: { type: "number", description: "Unique numeric identifier of the holder." },
        bid: { type: "number", description: "Bid priority value." },
        lifetime: { type: "number", description: "Lease duration in seconds." },
        capacity: { type: "number", description: "Maximum concurrent allowed holders." }
      },
      required: ["holderId"]
    }
  },
];

const AI_WRITE_TOOLS = new Set(["write_file", "edit_file", "create_dir", "delete_file", "run_command"]);

const AI_TOOL_NAME_ALIASES = {
  create_file: "write_file",
  save_file: "write_file",
  write_to_file: "write_file",
  overwrite_file: "write_file",
  new_file: "write_file",
  write: "write_file",
  modify_file: "edit_file",
  update_file: "edit_file",
  replace_in_file: "edit_file",
  str_replace: "edit_file",
  str_replace_editor: "edit_file",
  patch_file: "edit_file",
  edit: "edit_file",
  view_file: "read_file",
  cat: "read_file",
  get_file: "read_file",
  read: "read_file",
  list_files: "list_dir",
  ls: "list_dir",
  dir: "list_dir",
  list_directory: "list_dir",
  grep: "search",
  search_files: "search",
  find_in_files: "search",
  bash: "run_command",
  sh: "run_command",
  shell: "run_command",
  exec: "run_command",
  execute_command: "run_command",
  terminal: "run_command",
  cmd: "run_command",
  mkdir: "create_dir",
  make_dir: "create_dir",
  create_directory: "create_dir",
  rm: "delete_file",
  remove_file: "delete_file",
  unlink: "delete_file",
  open_tool: "open_tool_tab",
  open_tab: "open_tool_tab",
  switch_tab: "open_tool_tab",
  navigate_tool: "open_tool_tab",
  diagnostics: "get_diagnostics",
  check_diagnostics: "get_diagnostics",
  problems: "get_diagnostics",
  check_errors: "get_diagnostics",
  transform: "transform_data",
  decode: "transform_data",
  encode: "transform_data",
  jwt: "transform_data",
  hash: "transform_data",
  http_request: "send_http_request",
  http: "send_http_request",
  pitcher_send: "send_http_request",
  send_request: "send_http_request",
  request: "send_http_request",
  fetch: "send_http_request",
  curl: "send_http_request",
  security_scan: "run_security_scan",
  sec_scan: "run_security_scan",
  scan_security: "run_security_scan",
  scan_project: "run_security_scan",
  vuln_scan: "run_security_scan",
  audit_dependencies: "check_dependencies",
  audit_deps: "check_dependencies",
  osv_scan: "check_dependencies",
  check_cve: "check_dependencies",
  cve_audit: "check_dependencies",
  list_open_tabs: "get_open_tabs",
  open_tabs: "get_open_tabs",
  get_tabs: "get_open_tabs",
  active_tabs: "get_open_tabs",
  catcher: "manage_catcher",
  catcher_proxy: "manage_catcher",
  proxy_control: "manage_catcher",
  control_proxy: "manage_catcher",
  get_proxy_traffic: "manage_catcher",
  proxy_traffic: "manage_catcher",
  catcher_traffic: "manage_catcher",
  start_proxy: "manage_catcher",
  stop_proxy: "manage_catcher",
  proxy_status: "manage_catcher",
  catcher_status: "manage_catcher",
};

const AI_KNOWN_TOOL_NAMES = new Set([
  ...AI_TOOLS.map((t) => t.name),
  ...Object.keys(AI_TOOL_NAME_ALIASES),
]);

function aiNormalizeToolCall(rawName, rawInput) {
  const cleanRaw = String(rawName ?? "").trim().toLowerCase();
  let name = AI_TOOL_NAME_ALIASES[cleanRaw] || String(rawName ?? "").trim();
  const src = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) ? rawInput : {};
  const input = { ...src };

  if (input.path === undefined) {
    const aliasPath =
      src.file_path ?? src.filepath ?? src.filename ?? src.file ?? src.target_file ?? src.directory ?? src.dir;
    if (aliasPath !== undefined) input.path = String(aliasPath);
  }
  if (input.content === undefined) {
    const aliasContent =
      src.code ?? src.text ?? src.body ?? src.new_content ?? src.file_text ?? src.contents;
    if (aliasContent !== undefined) input.content = String(aliasContent);
  }
  if (input.find === undefined) {
    const aliasFind =
      src.old_str ?? src.old_text ?? src.old_string ?? src.search ?? src.original ?? src.target;
    if (aliasFind !== undefined) input.find = String(aliasFind);
  }
  if (input.replace === undefined) {
    const aliasReplace =
      src.new_str ?? src.new_text ?? src.new_string ?? src.replacement;
    if (aliasReplace !== undefined) input.replace = String(aliasReplace);
  }
  if (input.command === undefined) {
    const aliasCommand =
      src.cmd ?? src.script ?? src.shell_command ?? src.command_line;
    if (aliasCommand !== undefined) input.command = String(aliasCommand);
  }
  if (input.query === undefined) {
    const aliasQuery =
      src.pattern ?? src.search_query ?? src.term ?? src.keyword;
    if (aliasQuery !== undefined) input.query = String(aliasQuery);
  }

  if (name === "transform_data") {
    if (input.operation === undefined) {
      const aliasOp = src.op ?? src.type ?? src.action ?? src.method ?? src.mode;
      if (aliasOp !== undefined) input.operation = String(aliasOp);
    }
    if (input.input === undefined) {
      const aliasInput = src.data ?? src.text ?? src.value ?? src.content ?? src.payload;
      if (aliasInput !== undefined) input.input = String(aliasInput);
    }
  }

  if (name === "open_tool_tab") {
    if (input.tab === undefined) {
      const aliasTab = src.tool ?? src.target ?? src.name ?? src.panel ?? src.view;
      if (aliasTab !== undefined) input.tab = String(aliasTab);
    }
    if (input.subtool === undefined) {
      const aliasSub = src.sub ?? src.sub_tool ?? src.view;
      if (aliasSub !== undefined && aliasSub !== input.tab) input.subtool = String(aliasSub);
    }
  }

  if (name === "get_diagnostics") {
    if (input.path === undefined) {
      const aliasPath = src.file ?? src.filepath ?? src.file_path;
      if (aliasPath !== undefined) input.path = String(aliasPath);
    }
  }

  if (name === "send_http_request") {
    if (input.url === undefined) {
      const aliasUrl = src.target ?? src.uri ?? src.address ?? src.endpoint ?? src.link;
      if (aliasUrl !== undefined) input.url = String(aliasUrl);
    }
    if (input.method === undefined) {
      const aliasMethod = src.verb ?? src.http_method;
      if (aliasMethod !== undefined) input.method = String(aliasMethod);
    }
    if (input.headers === undefined) {
      const aliasHeaders = src.header ?? src.req_headers ?? src.request_headers;
      if (aliasHeaders !== undefined) input.headers = aliasHeaders;
    }
    if (input.body === undefined) {
      const aliasBody = src.data ?? src.payload ?? src.post_data ?? src.content;
      if (aliasBody !== undefined) input.body = aliasBody;
    }
    if (input.insecure === undefined) {
      const aliasInsecure = src.allow_insecure ?? src.ignore_ssl ?? src.reject_unauthorized;
      if (aliasInsecure !== undefined) input.insecure = Boolean(aliasInsecure);
    }
  }

  if (name === "run_security_scan") {
    if (input.path === undefined) {
      const aliasPath = src.file ?? src.filepath ?? src.target ?? src.file_path;
      if (aliasPath !== undefined) input.path = String(aliasPath);
    }
    if (input.minSeverity === undefined) {
      const aliasSev = src.severity ?? src.level ?? src.min_severity;
      if (aliasSev !== undefined) input.minSeverity = String(aliasSev);
    }
  }

  if (name === "check_dependencies") {
    if (input.manifest === undefined) {
      const aliasManifest = src.file ?? src.path ?? src.target ?? src.file_path;
      if (aliasManifest !== undefined) input.manifest = String(aliasManifest);
    }
  }

  if (name === "get_open_tabs") {
    return { name: "get_open_tabs", input: {} };
  }

  if (name === "manage_catcher") {
    if (input.action === undefined) {
      const aliasAction = src.command ?? src.operation ?? src.op ?? src.method ?? src.type;
      if (aliasAction !== undefined) input.action = String(aliasAction);
      else if (cleanRaw === "start_proxy") input.action = "start";
      else if (cleanRaw === "stop_proxy") input.action = "stop";
      else if (cleanRaw === "proxy_status" || cleanRaw === "catcher_status") input.action = "status";
      else if (cleanRaw.includes("traffic")) input.action = "get_traffic";
      else input.action = "status";
    }
    if (input.intercept === undefined && src.enabled !== undefined) {
      input.intercept = Boolean(src.enabled);
    }
  }

  if (name === "edit_file" && input.find === undefined && typeof input.content === "string") {
    name = "write_file";
  } else if (
    name === "write_file" &&
    input.content === undefined &&
    typeof input.find === "string" &&
    typeof input.replace === "string"
  ) {
    name = "edit_file";
  }

  return { name, input };
}

function aiEscapeControlCharsInJsonStrings(raw) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === "\\") {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === "\n") {
        out += "\\n";
      } else if (ch === "\r") {
        out += "\\r";
      } else if (ch === "\t") {
        out += "\\t";
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

function aiParseLenientJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^```(?:json|tool_call)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    void 0;
  }
  try {
    return JSON.parse(aiEscapeControlCharsInJsonStrings(trimmed));
  } catch {
    void 0;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sub = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(sub);
    } catch {
      try {
        return JSON.parse(aiEscapeControlCharsInJsonStrings(sub));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function aiParseXmlFunctionBlock(funcName, inner) {
  const params = {};
  const paramRegex = /<parameter=([a-zA-Z0-9_.-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/gi;
  let match;
  let foundParam = false;
  while ((match = paramRegex.exec(inner)) !== null) {
    foundParam = true;
    const key = match[1].trim();
    let val = match[2];
    if (val.startsWith("\n")) val = val.slice(1);
    if (val.endsWith("\n")) val = val.slice(0, -1);
    params[key] = val;
  }
  if (foundParam) {
    return aiNormalizeToolCall(funcName, params);
  }
  const parsedJson = aiParseLenientJson(inner);
  if (parsedJson && typeof parsedJson === "object") {
    const args = parsedJson.arguments ?? parsedJson.input ?? parsedJson.parameters ?? parsedJson;
    return aiNormalizeToolCall(funcName, typeof args === "string" ? (aiParseLenientJson(args) ?? {}) : args);
  }
  return null;
}

function aiConvertParsedObjectToCall(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rawName = obj.name ?? obj.tool ?? obj.function?.name ?? obj.function;
  if (typeof rawName !== "string" || !rawName.trim()) return null;
  let rawArgs = obj.arguments ?? obj.input ?? obj.parameters ?? obj.args ?? obj.function?.arguments;
  if (typeof rawArgs === "string") {
    rawArgs = aiParseLenientJson(rawArgs) ?? {};
  }
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    const rest = { ...obj };
    delete rest.name;
    delete rest.tool;
    delete rest.function;
    delete rest.type;
    rawArgs = rest;
  }
  return aiNormalizeToolCall(rawName, rawArgs);
}

function aiExtractTextToolCalls(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];
  const results = [];

  const toolCallRegex = /<tool_call\b[^>]*>([\s\S]*?)(?:<\/tool_call>|$)/gi;
  let match;
  while ((match = toolCallRegex.exec(raw)) !== null) {
    const body = match[1].trim();
    if (!body) continue;
    const fnMatch = /<function=([a-zA-Z0-9_.-]+)>([\s\S]*?)(?:<\/function>|$)/i.exec(body);
    if (fnMatch) {
      const call = aiParseXmlFunctionBlock(fnMatch[1], fnMatch[2]);
      if (call && call.name) results.push(call);
      continue;
    }
    const parsed = aiParseLenientJson(body);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const call = aiConvertParsedObjectToCall(item);
        if (call && call.name) results.push(call);
      }
    } else if (parsed) {
      const call = aiConvertParsedObjectToCall(parsed);
      if (call && call.name) results.push(call);
    }
  }

  if (results.length > 0) return results;

  const standaloneFnRegex = /<function=([a-zA-Z0-9_.-]+)>([\s\S]*?)<\/function>/gi;
  while ((match = standaloneFnRegex.exec(raw)) !== null) {
    const call = aiParseXmlFunctionBlock(match[1], match[2]);
    if (call && call.name) results.push(call);
  }
  if (results.length > 0) return results;

  const directTagRegex = /<(write_file|edit_file|read_file|list_dir|run_command|search|create_dir|delete_file)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  while ((match = directTagRegex.exec(raw)) !== null) {
    const tagName = match[1].toLowerCase();
    const attrs = match[2] || "";
    let inner = match[3] || "";
    if (inner.startsWith("\n")) inner = inner.slice(1);
    if (inner.endsWith("\n")) inner = inner.slice(0, -1);
    const pathAttr = /\b(?:path|file|filename)=["']([^"']+)["']/i.exec(attrs);
    if (tagName === "write_file") {
      if (pathAttr) {
        results.push(aiNormalizeToolCall("write_file", { path: pathAttr[1], content: inner }));
      } else {
        const parsed = aiParseLenientJson(inner);
        const call = aiConvertParsedObjectToCall({ name: "write_file", ...(parsed || {}) });
        if (call) results.push(call);
      }
    } else if (tagName === "run_command") {
      results.push(aiNormalizeToolCall("run_command", { command: inner.trim() }));
    } else if (tagName === "read_file" || tagName === "list_dir" || tagName === "create_dir" || tagName === "delete_file") {
      results.push(aiNormalizeToolCall(tagName, { path: pathAttr ? pathAttr[1] : inner.trim() }));
    } else if (tagName === "search") {
      results.push(aiNormalizeToolCall("search", { query: inner.trim() }));
    }
  }
  if (results.length > 0) return results;

  const fenceRegex = /```(?:tool_call|json)?\s*\n([\s\S]*?)```/gi;
  while ((match = fenceRegex.exec(raw)) !== null) {
    const body = match[1].trim();
    if (!body.startsWith("{")) continue;
    const parsed = aiParseLenientJson(body);
    if (!parsed) continue;
    const call = aiConvertParsedObjectToCall(parsed);
    if (call && AI_KNOWN_TOOL_NAMES.has(call.name.toLowerCase())) {
      results.push(call);
    }
  }

  return results;
}

function aiCreateStreamFilter(send) {
  let buffer = "";
  let inBlock = null;

  const START_PATTERNS = [
    { start: "<think>", end: "</think>", emitType: "thinking" },
    { start: "<thinking>", end: "</thinking>", emitType: "thinking" },
    { start: "<tool_call", end: "</tool_call>", emitType: null },
    { start: "<function=", end: "</function>", emitType: null },
    { start: "```tool_call", end: "```", emitType: null },
    { start: "<write_file", end: "</write_file>", emitType: null },
    { start: "<edit_file", end: "</edit_file>", emitType: null },
    { start: "<run_command", end: "</run_command>", emitType: null },
  ];

  const findEarliestStart = (text) => {
    const lower = text.toLowerCase();
    let bestIndex = -1;
    let bestPattern = null;
    for (const pat of START_PATTERNS) {
      const idx = lower.indexOf(pat.start);
      if (idx >= 0 && (bestIndex < 0 || idx < bestIndex)) {
        bestIndex = idx;
        bestPattern = pat;
      }
    }
    return bestIndex >= 0 ? { index: bestIndex, pattern: bestPattern } : null;
  };

  const holdTailLength = (text) => {
    const lower = text.toLowerCase();
    for (const pat of START_PATTERNS) {
      const s = pat.start;
      for (let len = Math.min(s.length - 1, lower.length); len >= 1; len -= 1) {
        if (lower.endsWith(s.slice(0, len))) return len;
      }
    }
    return 0;
  };

  const holdEndTailLength = (text, endToken) => {
    const lower = text.toLowerCase();
    for (let len = Math.min(endToken.length - 1, lower.length); len >= 1; len -= 1) {
      if (lower.endsWith(endToken.slice(0, len))) return len;
    }
    return 0;
  };

  return {
    push(chunk) {
      buffer += String(chunk ?? "");
      while (buffer.length > 0) {
        if (inBlock) {
          const lower = buffer.toLowerCase();
          const searchFrom = inBlock.start === "```tool_call" ? 12 : 0;
          const endIdx = lower.indexOf(inBlock.end, searchFrom);
          if (endIdx < 0) {
            if (inBlock.emitType === "thinking") {
              const tail = holdEndTailLength(buffer, inBlock.end);
              const safeLen = buffer.length - tail;
              if (safeLen > 0) {
                send({ type: "thinking", text: buffer.slice(0, safeLen) });
                buffer = buffer.slice(safeLen);
              }
            }
            return;
          }
          if (inBlock.emitType === "thinking" && endIdx > 0) {
            send({ type: "thinking", text: buffer.slice(0, endIdx) });
          }
          buffer = buffer.slice(endIdx + inBlock.end.length);
          if (inBlock.emitType === "thinking" && buffer.startsWith("\n")) {
            buffer = buffer.slice(1);
          }
          inBlock = null;
          continue;
        }
        const found = findEarliestStart(buffer);
        if (found) {
          if (found.index > 0) {
            send({ type: "text", text: buffer.slice(0, found.index) });
          }
          if (found.pattern.emitType === "thinking") {
            buffer = buffer.slice(found.index + found.pattern.start.length);
          } else {
            buffer = buffer.slice(found.index);
          }
          inBlock = found.pattern;
          continue;
        }
        const tail = holdTailLength(buffer);
        const safeLen = buffer.length - tail;
        if (safeLen > 0) {
          send({ type: "text", text: buffer.slice(0, safeLen) });
          buffer = buffer.slice(safeLen);
        }
        break;
      }
    },
    flush() {
      if (inBlock?.emitType === "thinking" && buffer.length > 0) {
        send({ type: "thinking", text: buffer });
      } else if (!inBlock && buffer.length > 0) {
        send({ type: "text", text: buffer });
      }
      buffer = "";
      inBlock = null;
    },
  };
}

function aiHasSubstantialCodeBlock(text) {
  const cleaned = String(text ?? "")
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/gi, "");
  const match = /```[a-zA-Z0-9_+-]*\s*\n([\s\S]*?)```/.exec(cleaned);
  if (!match) return false;
  const lines = match[1].trim().split("\n");
  return lines.length >= 2;
}

function aiToolsFor(provider, allowWrites) {
  const own = allowWrites ? AI_TOOLS : AI_TOOLS.filter((tool) => !AI_WRITE_TOOLS.has(tool.name));
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

const AI_ARGS_MAY_BE_EMPTY = new Set(["content", "replace"]);

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

function aiRunShell(root, command) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    let child;
    try {
      child = node_child_process.spawn(command, { cwd: root, shell: true, windowsHide: true });
    } catch (error) {
      resolve(`The command could not start: ${String((error && error.message) || error)}`);
      return;
    }
    const capture = (data) => {
      out += data.toString("utf8");
      if (out.length > AI_MAX_TOOL_RESULT_BYTES) {
        out = out.slice(0, AI_MAX_TOOL_RESULT_BYTES);
        try {
          killProcessTree(child);
        } catch {
          void 0;
        }
      }
    };
    if (child.stdout) child.stdout.on("data", capture);
    if (child.stderr) child.stderr.on("data", capture);
    const timer = setTimeout(() => {
      if (done) return;
      try {
        killProcessTree(child);
      } catch {
        void 0;
      }
      out += "\n… the command ran longer than 60 seconds and was stopped.";
    }, 60000);
    child.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(`The command could not start: ${String((error && error.message) || error)}`);
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(aiTrim(`exit ${code}\n${out || "(no output)"}`));
    });
  });
}

function aiRunGit(root, args) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    let child;
    try {
      child = node_child_process.spawn("git", args, { cwd: root, windowsHide: true });
    } catch (error) {
      resolve(`git could not run: ${String((error && error.message) || error)}. Is git installed?`);
      return;
    }
    const capture = (data) => {
      out += data.toString("utf8");
      if (out.length > AI_MAX_TOOL_RESULT_BYTES) {
        out = out.slice(0, AI_MAX_TOOL_RESULT_BYTES);
        try {
          killProcessTree(child);
        } catch {
          void 0;
        }
      }
    };
    if (child.stdout) child.stdout.on("data", capture);
    if (child.stderr) child.stderr.on("data", capture);
    const timer = setTimeout(() => {
      if (done) return;
      try {
        killProcessTree(child);
      } catch {
        void 0;
      }
    }, 30000);
    child.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(`git could not run: ${String((error && error.message) || error)}. Is git installed?`);
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(aiTrim(`git ${args.join(" ")} (exit ${code})\n${out || "(no output)"}`));
    });
  });
}

const AI_GIT_READ = new Set(["status", "diff", "log", "show", "branch", "rev-parse", "remote", "blame", "tag", "describe", "shortlog"]);
const AI_GIT_WRITE = new Set(["add", "commit"]);
const AI_GIT_BANNED = new Set(["push", "pull", "fetch", "clone", "reset", "clean", "rebase", "merge", "cherry-pick", "revert", "rm", "mv", "config", "gc", "checkout", "switch", "restore", "filter-branch", "update-ref", "reflog", "worktree", "submodule"]);

function isProtectedInstructionsFile(rel) {
  const norm = String(rel || "").replace(/\\/g, "/").toLowerCase().trim();
  return (
    norm === ".wide/ai-instructions.md" ||
    norm === ".wide/ai-instructions" ||
    norm.startsWith(".wide/ai-instructions.")
  );
}

function aiGetLatestUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      const c = messages[i].content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        return c.map((p) => (p && typeof p.text === "string" ? p.text : "")).join(" ");
      }
    }
  }
  return "";
}

function aiDiffCounts(oldText, newText) {
  const oldLines = String(oldText ?? "").split("\n");
  const newLines = String(newText ?? "").split("\n");
  const n = oldLines.length;
  const m = newLines.length;
  if (!oldText && newText) return { added: m, removed: 0 };
  if (oldText && !newText) return { added: 0, removed: n };
  if (oldText === newText) return { added: 0, removed: 0 };

  const MAX = 2500;
  if (n > MAX || m > MAX) {
    let same = 0;
    const len = Math.min(n, m);
    for (let i = 0; i < len; i += 1) {
      if (oldLines[i] === newLines[i]) same += 1;
    }
    return { added: Math.max(1, m - same), removed: Math.max(1, n - same) };
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lcs = dp[0][0];
  const added = m - lcs;
  const removed = n - lcs;
  return { added: added > 0 ? added : 1, removed: removed > 0 ? removed : 1 };
}

function aiOffsetToPosition(content, offset) {
  const clamped = Math.max(0, Math.min(offset, content.length));
  const slice = content.slice(0, clamped);
  const lines = slice.split("\n");
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  return { line, col };
}

function aiExecuteDataTransform(op, text) {
  try {
    switch (op) {
      case "base64_encode":
      case "base64":
      case "b64_encode":
        return Buffer.from(text, "utf8").toString("base64");

      case "base64_decode":
      case "b64_decode":
      case "atob":
        return Buffer.from(text, "base64").toString("utf8");

      case "hex_encode":
      case "hex":
        return Buffer.from(text, "utf8").toString("hex");

      case "hex_decode":
        return Buffer.from(text.replace(/\s+/g, ""), "hex").toString("utf8");

      case "url_encode":
      case "urlencode":
        return encodeURIComponent(text);

      case "url_decode":
      case "urldecode":
        return decodeURIComponent(text);

      case "md5":
        return node_crypto.createHash("md5").update(text, "utf8").digest("hex");

      case "sha1":
        return node_crypto.createHash("sha1").update(text, "utf8").digest("hex");

      case "sha256":
        return node_crypto.createHash("sha256").update(text, "utf8").digest("hex");

      case "sha512":
        return node_crypto.createHash("sha512").update(text, "utf8").digest("hex");

      case "rot13":
        return text.replace(/[a-zA-Z]/g, (c) => {
          const base = c <= "Z" ? 65 : 97;
          return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
        });

      case "jwt_decode":
      case "jwt": {
        const parts = text.trim().split(".");
        if (parts.length < 2) {
          return "Invalid JWT token: Expected at least header and payload segments separated by '.'";
        }
        const b64UrlDecode = (str) => {
          let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
          while (b64.length % 4) b64 += "=";
          return Buffer.from(b64, "base64").toString("utf8");
        };
        let headerObj = null;
        let payloadObj = null;
        try {
          headerObj = JSON.parse(b64UrlDecode(parts[0]));
        } catch {
          headerObj = b64UrlDecode(parts[0]);
        }
        try {
          payloadObj = JSON.parse(b64UrlDecode(parts[1]));
        } catch {
          payloadObj = b64UrlDecode(parts[1]);
        }
        const out = [];
        out.push("=== JWT Header ===");
        out.push(JSON.stringify(headerObj, null, 2));
        out.push("\n=== JWT Payload ===");
        if (payloadObj && typeof payloadObj === "object") {
          const enriched = { ...payloadObj };
          if (typeof enriched.exp === "number") {
            enriched["_exp_human"] = new Date(enriched.exp * 1000).toISOString();
          }
          if (typeof enriched.iat === "number") {
            enriched["_iat_human"] = new Date(enriched.iat * 1000).toISOString();
          }
          if (typeof enriched.nbf === "number") {
            enriched["_nbf_human"] = new Date(enriched.nbf * 1000).toISOString();
          }
          out.push(JSON.stringify(enriched, null, 2));
        } else {
          out.push(String(payloadObj));
        }
        if (parts[2]) {
          out.push(`\n=== Signature Segment ===\nLength: ${parts[2].length} chars (present)`);
        }
        return out.join("\n");
      }

      case "gzip_compress":
      case "gzip": {
        const compressed = node_zlib.gzipSync(Buffer.from(text, "utf8"));
        return compressed.toString("base64");
      }

      case "gzip_decompress":
      case "gunzip": {
        const decompressed = node_zlib.gunzipSync(Buffer.from(text.trim(), "base64"));
        return decompressed.toString("utf8");
      }

      case "json_format":
      case "json_prettify":
      case "prettify_json": {
        const parsed = JSON.parse(text);
        return JSON.stringify(parsed, null, 2);
      }

      default:
        return `Unsupported operation '${op}'. Supported operations: base64_encode, base64_decode, hex_encode, hex_decode, url_encode, url_decode, jwt_decode, md5, sha1, sha256, sha512, rot13, gzip_compress, gzip_decompress, json_format.`;
    }
  } catch (err) {
    return `Data transformation error for '${op}': ${String(err.message || err)}`;
  }
}

function aiNormalizeToolTabName(target, sub) {
  const t = String(target || "").toLowerCase().trim();
  if (t === "scanner" || t === "repeater" || t === "intruder" || t === "proxy" || t === "target" || t === "sequencer" || t === "collaborator" || t === "vault" || t === "miner") {
    return { tool: "catcher", subtool: t };
  }
  if (t === "catcher") {
    return { tool: "catcher", subtool: sub || "proxy" };
  }
  if (t === "pitcher" || t === "api" || t === "http") {
    return { tool: "pitcher" };
  }
  if (t === "cyberchef" || t === "decoder") {
    return { tool: "cyberchef" };
  }
  if (t === "browser") {
    return { tool: "browser" };
  }
  if (t === "terminal" || t === "bash" || t === "shell") {
    return { tool: "terminal" };
  }
  if (t === "problems" || t === "diagnostics" || t === "errors") {
    return { tool: "problems" };
  }
  if (t === "findings" || t === "security_findings") {
    return { tool: "findings" };
  }
  if (t === "explorer" || t === "files" || t === "project") {
    return { tool: "project" };
  }
  if (t === "search") {
    return { tool: "search" };
  }
  if (t === "git" || t === "source-control" || t === "scm") {
    return { tool: "source-control" };
  }
  if (t === "tests" || t === "test") {
    return { tool: "tests" };
  }
  if (t === "debug") {
    return { tool: "debug" };
  }
  if (t === "build") {
    return { tool: "build" };
  }
  if (t === "settings") {
    return { tool: "settings" };
  }
  if (t === "scratchpad") {
    return { tool: "scratchpad" };
  }
  return { tool: t, subtool: sub };
}

async function aiGetDiagnostics(root, filePath) {
  if (!root) return "No project workspace is currently open.";

  if (filePath) {
    const resolved = aiResolvePath(root, filePath);
    if (resolved.error) return resolved.error;

    let content = "";
    try {
      content = await promises.readFile(resolved.path, "utf8");
    } catch {
      return `Could not read file: ${resolved.relative}`;
    }

    const items = [];
    const isTsJs = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(resolved.path);

    if (isTsJs && typeof tsCall === "function") {
      try {
        const tsResult = await tsCall("diagnostics", [root, resolved.path], { diagnostics: [] });
        const list = Array.isArray(tsResult?.diagnostics) ? tsResult.diagnostics : [];
        for (const item of list) {
          const pos = aiOffsetToPosition(content, item.from ?? 0);
          items.push({
            source: "TypeScript",
            line: pos.line,
            col: pos.col,
            severity: item.severity || "error",
            code: item.code ? `TS${item.code}` : "",
            message: String(item.message || ""),
          });
        }
      } catch (e) {
        void e;
      }
    }

    if (isTsJs && typeof runLinter === "function") {
      try {
        const lintResult = await runLinter({ root, filePath: resolved.path, text: content });
        if (lintResult && lintResult.ok && Array.isArray(lintResult.diagnostics)) {
          for (const item of lintResult.diagnostics) {
            const pos = aiOffsetToPosition(content, item.from ?? 0);
            items.push({
              source: "ESLint",
              line: pos.line,
              col: pos.col,
              severity: item.severity || "warning",
              code: "",
              message: String(item.message || ""),
            });
          }
        }
      } catch (e) {
        void e;
      }
    }

    if (items.length === 0) {
      return `No syntax, type, or lint diagnostics found in ${resolved.relative}. Code is clean!`;
    }

    items.sort((a, b) => a.line - b.line || a.col - b.col);
    const lines = [
      `Found ${items.length} diagnostic(s) in ${resolved.relative}:`,
      ...items.map(
        (it) =>
          `- [Line ${it.line}, Col ${it.col}] [${it.severity.toUpperCase()}${it.code ? ` ${it.code}` : ""} - ${it.source}]: ${it.message}`
      ),
    ];
    return lines.join("\n");
  }

  if (typeof tsCall === "function") {
    try {
      const projResult = await tsCall("projectDiagnostics", [root], { counts: {}, problems: [] });
      const counts = projResult?.counts || {};
      const problems = Array.isArray(projResult?.problems) ? projResult.problems : [];

      const fileKeys = Object.keys(counts);
      if (fileKeys.length === 0 && problems.length === 0) {
        return "No compile, type, or syntax errors detected across the project. Project builds cleanly!";
      }

      const totalErrors = problems.filter((p) => p.severity === "error").length;
      const totalWarnings = problems.filter((p) => p.severity === "warning").length;

      const lines = [
        `Project diagnostics: ${totalErrors} error(s), ${totalWarnings} warning(s) in ${fileKeys.length || 1} file(s):`,
      ];

      const byFile = new Map();
      for (const p of problems) {
        const rel = node_path.relative(root, p.file || "").replace(/\\/g, "/") || p.file;
        if (!byFile.has(rel)) byFile.set(rel, []);
        byFile.get(rel).push(p);
      }

      for (const [file, list] of byFile.entries()) {
        lines.push(`\n* ${file} (${list.length} issues):`);
        for (const item of list.slice(0, 5)) {
          lines.push(`  - Line ${item.line}, Col ${item.column} [${item.severity}]: ${item.message} ${item.code ? `(TS${item.code})` : ""}`);
        }
        if (list.length > 5) {
          lines.push(`  ... and ${list.length - 5} more issues.`);
        }
      }

      return lines.join("\n");
    } catch (e) {
      return `Could not inspect project diagnostics: ${String(e.message || e)}`;
    }
  }

  return "Diagnostics language service is not active for this workspace.";
}

function aiNormalizeHttpRequestHeaders(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const list = [];
    for (const item of raw) {
      if (Array.isArray(item) && item.length >= 2) {
        list.push([String(item[0]), String(item[1])]);
      } else if (typeof item === "string" && item.includes(":")) {
        const colon = item.indexOf(":");
        list.push([item.slice(0, colon).trim(), item.slice(colon + 1).trim()]);
      }
    }
    return list;
  }
  if (typeof raw === "object") {
    return Object.entries(raw).map(([k, v]) => [String(k), String(v ?? "")]);
  }
  return [];
}

async function aiExecuteHttpRequest(url, method = "GET", headers = {}, body = null, insecure = true) {
  const normUrl = String(url || "").trim();
  if (!normUrl) return "Missing required argument: 'url'.";

  const normMethod = String(method || "GET").trim().toUpperCase();
  const safeHeaders = aiNormalizeHttpRequestHeaders(headers);
  const normBody = body != null ? (typeof body === "object" ? JSON.stringify(body) : String(body)) : null;

  try {
    const proxyOpts =
      typeof proxyServer !== "undefined" && proxyServer && typeof proxyPort === "number" && proxyPort > 0
        ? { host: "127.0.0.1", port: proxyPort }
        : null;

    const res = await sendOnce(normUrl, normMethod, safeHeaders, normBody, HTTP_MAX_REDIRECTS, {
      insecure: insecure !== false,
      ...(proxyOpts ? { proxy: proxyOpts } : {}),
    });

    if (!res.ok) {
      return `HTTP Request to ${normUrl} failed: ${res.error}`;
    }

    const headerLines = (res.headers || []).map(([k, v]) => `${k}: ${v}`).join("\n");
    let formattedBody = String(res.body ?? "");

    if (formattedBody.length < 64 * 1024) {
      try {
        const parsed = JSON.parse(formattedBody);
        formattedBody = JSON.stringify(parsed, null, 2);
      } catch {
              }
    }

    const sections = [
      `HTTP/1.1 ${res.status} ${res.statusText} (${res.ms}ms, ${res.bytes} bytes)`,
      `Final URL: ${res.url}`,
      "",
      "--- Response Headers ---",
      headerLines || "(no headers)",
      "",
      "--- Response Body ---",
      formattedBody || "(empty body)",
    ];

    if (res.truncated) {
      sections.push("\n[Note: Response body exceeded 8MB and was truncated]");
    }

    return aiTrim(sections.join("\n"));
  } catch (err) {
    return `HTTP Request failed with exception: ${String(err.message || err)}`;
  }
}

async function aiExecuteSecurityScan(root, filePath, minSeverity = "info") {
  if (!root) return "No project workspace is currently open.";

  const sevWeight = { info: 1, warning: 2, error: 3 };
  const minWeight = sevWeight[String(minSeverity || "info").toLowerCase()] ?? 1;

  try {
    let result;
    if (filePath) {
      const resolved = aiResolvePath(root, filePath);
      if (resolved.error) return resolved.error;
      result = await secScanFile(root, resolved.path, null);
    } else {
      result = await secScanProject(root);
    }

    const allFindings = Array.isArray(result?.findings) ? result.findings : [];
    const filtered = allFindings.filter((f) => (sevWeight[f.severity] ?? 2) >= minWeight);

    if (filtered.length === 0) {
      return `Wide Security Scanner: 0 vulnerabilities found (scanned ${result?.scanned ?? 1} file(s)). Code passed security inspection with no injection sinks, hardcoded secrets, XSS, or taint flow issues.`;
    }

    const byFile = new Map();
    for (const f of filtered) {
      const rel = node_path.relative(root, f.file || "").replace(/\\/g, "/") || f.file;
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel).push(f);
    }

    const lines = [
      `Wide Security Scanner Report: Found ${filtered.length} vulnerability finding(s) across ${byFile.size} file(s) (scanned ${result?.scanned ?? 1} files):`,
    ];

    for (const [file, items] of byFile.entries()) {
      lines.push(`\n* ${file}:`);
      for (const item of items.slice(0, 10)) {
        const sev = String(item.severity || "warning").toUpperCase();
        const conf = item.confidence ? ` / Conf: ${item.confidence}` : "";
        const cwe = item.cwe ? ` [${item.cwe}]` : "";
        const rule = item.ruleId ? ` (${item.ruleId})` : "";
        lines.push(`  - Line ${item.line}, Col ${item.col || 1} [${sev}${conf}]${cwe}${rule}:`);
        lines.push(`    ${item.message}`);
        if (item.snippet) {
          lines.push(`    Snippet: ${item.snippet.trim().slice(0, 120)}`);
        }
      }
      if (items.length > 10) {
        lines.push(`    ... and ${items.length - 10} more findings in this file.`);
      }
    }

    return aiTrim(lines.join("\n"));
  } catch (err) {
    return `Security scan failed: ${String(err.message || err)}`;
  }
}

async function aiExecuteDependencyCheck(root, manifest) {
  if (!root) return "No project workspace is currently open.";

  if (manifest) {
    const resolved = aiResolvePath(root, manifest);
    if (resolved.error) return resolved.error;
    let content = "";
    try {
      content = await promises.readFile(resolved.path, "utf8");
    } catch {
      return `Could not read manifest file: ${resolved.relative}`;
    }

    secProjectOsv = await readSecOsv(root);
    const findings = auditManifest(resolved.path, content);
    if (!findings || findings.length === 0) {
      return `Dependency Audit for ${resolved.relative}: Clean! No vulnerable packages or CVEs found.`;
    }

    const lines = [
      `Dependency Audit for ${resolved.relative}: Found ${findings.length} vulnerable package advisory/advisories:`,
      ...findings.map((f) => `- [Line ${f.line}] [${(f.severity || "warning").toUpperCase()}] ${f.cwe ? `(${f.cwe}) ` : ""}${f.message}`),
    ];
    return lines.join("\n");
  }

  const manifestNames = ["package.json", "package-lock.json", "requirements.txt", "go.mod", "pom.xml"];
  const allFindings = [];
  const scanned = [];

  for (const name of manifestNames) {
    const p = node_path.join(root, name);
    try {
      const stats = await promises.stat(p);
      if (stats.isFile()) {
        scanned.push(name);
        const text = await promises.readFile(p, "utf8");
        secProjectOsv = await readSecOsv(root);
        const res = auditManifest(p, text);
        if (Array.isArray(res) && res.length > 0) {
          allFindings.push({ file: name, findings: res });
        }
      }
    } catch {
          }
  }

  if (scanned.length === 0) {
    return "No standard package manifests found (looked for package.json, requirements.txt, go.mod, pom.xml).";
  }

  if (allFindings.length === 0) {
    return `Dependency Audit: Clean! No vulnerable dependencies or CVEs found across scanned manifests (${scanned.join(", ")}).`;
  }

  const total = allFindings.reduce((sum, item) => sum + item.findings.length, 0);
  const out = [
    `Dependency Audit: Found ${total} vulnerable dependency issue(s) across project manifests:`,
  ];

  for (const item of allFindings) {
    out.push(`\n* ${item.file} (${item.findings.length} issues):`);
    for (const f of item.findings) {
      out.push(`  - [Line ${f.line}] [${(f.severity || "warning").toUpperCase()}] ${f.cwe ? `(${f.cwe}) ` : ""}${f.message}`);
    }
  }

  return aiTrim(out.join("\n"));
}

let aiLastKnownOpenTabs = [];

function aiExecuteGetOpenTabs(root) {
  if (!Array.isArray(aiLastKnownOpenTabs) || aiLastKnownOpenTabs.length === 0) {
    return "No open tabs reported by the editor currently.";
  }
  const formatted = aiLastKnownOpenTabs.map((t, index) => {
    const activeMarker = t.active ? " (ACTIVE)" : "";
    const kind = t.kind ? ` [${t.kind}]` : "";
    const rel = t.path && root && t.path.startsWith(root)
      ? node_path.relative(root, t.path).replace(/\\/g, "/")
      : t.path || t.name;
    return `${index + 1}. ${t.name || rel}${kind}${activeMarker}${t.path ? ` -> ${rel}` : ""}`;
  });
  return `Currently open tabs in Wide editor (${aiLastKnownOpenTabs.length} tab${aiLastKnownOpenTabs.length > 1 ? "s" : ""}):\n${formatted.join("\n")}`;
}

async function aiExecuteManageCatcher(action = "status", intercept = undefined, limit = 15) {
  const cleanAction = String(action || "status").trim().toLowerCase();

  if (cleanAction === "status") {
    const isRunning = Boolean(typeof proxyServer !== "undefined" && proxyServer);
    const port = typeof proxyPort !== "undefined" ? proxyPort : 0;
    const isIntercepting = typeof intercepting !== "undefined" ? Boolean(intercepting) : false;
    const totalTraffic = typeof proxyLog !== "undefined" && Array.isArray(proxyLog) ? proxyLog.length : 0;
    return `Catcher Intercepting Proxy Status:
- State: ${isRunning ? "RUNNING (Active)" : "STOPPED"}
- Port: ${isRunning ? port : "Not listening"}
- Target Host: 127.0.0.1
- Request Intercept: ${isIntercepting ? "ENABLED (holding requests)" : "DISABLED (pass-through)"}
- Captured Traffic Entries: ${totalTraffic} requests in buffer
${!isRunning ? "\nTip: To start the proxy, invoke `manage_catcher` with action: 'start'." : ""}`;
  }

  if (cleanAction === "start") {
    try {
      if (typeof loadOrMakeCa === "function") await loadOrMakeCa();
      if (typeof startProxy === "function") {
        const listening = await startProxy();
        if (typeof electron !== "undefined" && electron.hostRequest) {
          electron.hostRequest("browser:proxy", { port: proxyPort });
        }
        return `Successfully started Catcher Proxy on 127.0.0.1:${listening.port || proxyPort}. Traffic from the built-in browser and configured apps will now be captured and analyzed in Wide Catcher.`;
      }
      return "Catcher proxy subsystem is not available.";
    } catch (error) {
      return `Failed to start Catcher proxy: ${String((error && error.message) || error)}`;
    }
  }

  if (cleanAction === "stop") {
    try {
      if (typeof stopProxy === "function") {
        stopProxy();
        if (typeof electron !== "undefined" && electron.hostRequest) {
          electron.hostRequest("browser:proxy", { port: 0 });
        }
        return "Catcher Proxy has been stopped.";
      }
      return "Catcher proxy subsystem is not available.";
    } catch (error) {
      return `Failed to stop Catcher proxy: ${String((error && error.message) || error)}`;
    }
  }

  if (cleanAction === "get_traffic" || cleanAction === "traffic") {
    if (typeof proxyLog === "undefined" || !Array.isArray(proxyLog) || proxyLog.length === 0) {
      const isRunning = Boolean(typeof proxyServer !== "undefined" && proxyServer);
      return `No HTTP traffic captured in Catcher yet.${!isRunning ? " (Note: Catcher proxy is currently STOPPED. Start it using `manage_catcher({ action: 'start' })`)" : " (Send HTTP requests through 127.0.0.1:" + proxyPort + " or using Pitcher's `send_http_request` to see captured entries)."}`;
    }
    const max = Math.min(Math.max(1, Number(limit) || 15), 50);
    const slice = proxyLog.slice(-max).reverse();
    const formatted = slice.map((entry, idx) => {
      const method = entry.method || entry.request?.method || "GET";
      const url = entry.url || entry.request?.url || entry.host || "";
      const status = entry.status ? `${entry.status}` : (entry.error ? `ERR (${entry.error})` : "Pending");
      const duration = typeof entry.ms === "number" ? `${entry.ms}ms` : (typeof entry.durationMs === "number" ? `${entry.durationMs}ms` : "");
      const resSize = entry.resBody ? `${Buffer.byteLength(entry.resBody, "utf8")}B` : "";
      let item = `${idx + 1}. [${method}] ${url} -> ${status} (${[duration, resSize].filter(Boolean).join(", ") || "streamed"})`;
      if (entry.reqBody) {
        item += `\n   Request Body: ${entry.reqBody.slice(0, 300)}`;
      }
      if (entry.resBody) {
        item += `\n   Response Body: ${entry.resBody.slice(0, 500)}`;
      }
      return item;
    });
    return `Recent Catcher Proxy Traffic (latest ${slice.length} of ${proxyLog.length} captured requests):\n${formatted.join("\n")}`;
  }

  if (cleanAction === "set_intercept" || cleanAction === "intercept") {
    const shouldEnable = Boolean(intercept);
    if (typeof intercepting !== "undefined") {
      intercepting = shouldEnable;
      if (!intercepting && typeof releaseIntercepts === "function") {
        releaseIntercepts();
      }
      if (typeof broadcast === "function") {
        broadcast("proxy:interceptState", { enabled: intercepting });
      }
      return `Catcher request interception is now ${shouldEnable ? "ENABLED. Incoming HTTP requests will be held for manual inspection and tampering." : "DISABLED. Requests will pass through normally."}`;
    }
    return "Catcher interception control is not available.";
  }

  return `Unknown Catcher action: '${action}'. Supported actions: 'status', 'start', 'stop', 'get_traffic', 'set_intercept'.`;
}

async function aiRunTool(root, rawName, rawInput, send, allowWrites, userPrompt = "") {
  try {
    const normalized = aiNormalizeToolCall(rawName, rawInput);
    const name = normalized.name;
    const input = normalized.input;

    if (name === "write_file" || name === "edit_file" || name === "delete_file") {
      const resolved = aiResolvePath(root, input.path);
      if (!resolved.error && isProtectedInstructionsFile(resolved.relative)) {
        const isExplicit = /(?:ai-?instructions|talimat|proje kural|instruction|system prompt|custom rules)/i.test(userPrompt || "");
        if (!isExplicit) {
          return "Protected file: `.wide/ai-instructions.md` cannot be modified unless the user explicitly requested to edit project instructions.";
        }
      }
    }

    if (isMcpTool(name)) {
      const allowed = aiAllowed("ai:tool.mcp", [name]);
      if (!allowed.ok) return allowed.reason;
      return aiTrim(await mcpCallTool(name, input ?? {}));
    }

    if (AI_WRITE_TOOLS.has(name) && !allowWrites) {
      return `The tool ${name} is disabled because AI writes are turned off in settings.`;
    }

    const missing = aiMissingArgs(name, input);
    if (missing.length > 0) {
      return `The call to ${name} arrived without required arguments (${missing.join(", ")}). Call ${name} again with all required fields.`;
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
      send({ type: "file_read", root, path: resolved.path, content });
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
      return `Opened ${resolved.relative} in the editor.`;
    }

    if (name === "write_file") {
      const resolved = aiResolvePath(root, input.path);
      if (resolved.error) return resolved.error;
      const allowed = aiAllowed("ai:tool.write", [root, resolved.path]);
      if (!allowed.ok) return allowed.reason;
      let existed = true;
      let oldContent = "";
      try {
        oldContent = await promises.readFile(resolved.path, "utf8");
      } catch {
        existed = false;
      }
      const newContent = String(input.content ?? "");
      await promises.mkdir(node_path.dirname(resolved.path), { recursive: true });
      await writeFileAtomic(resolved.path, newContent, "utf8");
      const { added, removed } = aiDiffCounts(oldContent, newContent);
      send({ type: "edit", root, path: resolved.path, oldContent, content: newContent, existed, added, removed });
      return `Successfully ${existed ? "updated" : "created"} ${resolved.relative} (${Buffer.byteLength(newContent, "utf8")} bytes) in the project workspace.`;
    }

    if (name === "edit_file") {
      const resolved = aiResolvePath(root, input.path);
      if (resolved.error) return resolved.error;
      const allowed = aiAllowed("ai:tool.write", [root, resolved.path]);
      if (!allowed.ok) return allowed.reason;
      let content;
      try {
        content = await promises.readFile(resolved.path, "utf8");
      } catch {
        return `Could not read ${resolved.relative}. If it does not exist yet, create it with write_file.`;
      }
      const find = String(input.find ?? "");
      if (!find) return "edit_file needs a non-empty `find` snippet.";
      const replace = String(input.replace ?? "");

      let next = null;
      const exactPieces = content.split(find);
      if (exactPieces.length - 1 === 1) {
        next = exactPieces.join(replace);
      } else if (exactPieces.length - 1 > 1) {
        return `The snippet matches ${exactPieces.length - 1} times in ${resolved.relative}. Include more surrounding lines so it matches exactly once.`;
      } else {
        const usesCrlf = content.includes("\r\n");
        const normContent = content.replace(/\r\n/g, "\n");
        const normFind = find.replace(/\r\n/g, "\n");
        const normReplace = replace.replace(/\r\n/g, "\n");
        const normPieces = normContent.split(normFind);
        if (normPieces.length - 1 === 1) {
          const joined = normPieces.join(normReplace);
          next = usesCrlf ? joined.replace(/\n/g, "\r\n") : joined;
        } else if (normPieces.length - 1 > 1) {
          return `The snippet matches ${normPieces.length - 1} times in ${resolved.relative}. Include more surrounding lines so it matches exactly once.`;
        } else {
          return `The snippet was not found in ${resolved.relative}. Read the file again with read_file and copy the exact text.`;
        }
      }

      await writeFileAtomic(resolved.path, next, "utf8");
      const { added, removed } = aiDiffCounts(content, next);
      send({ type: "edit", root, path: resolved.path, oldContent: content, content: next, existed: true, added, removed });
      return `Successfully edited ${resolved.relative} in the project workspace.`;
    }

    if (name === "create_dir") {
      const resolved = aiResolvePath(root, input.path);
      if (resolved.error) return resolved.error;
      const allowed = aiAllowed("ai:tool.write", [root, resolved.path]);
      if (!allowed.ok) return allowed.reason;
      await promises.mkdir(resolved.path, { recursive: true });
      return `Created directory ${resolved.relative}.`;
    }

    if (name === "delete_file") {
      const resolved = aiResolvePath(root, input.path);
      if (resolved.error) return resolved.error;
      const allowed = aiAllowed("ai:tool.write", [root, resolved.path]);
      if (!allowed.ok) return allowed.reason;
      await promises.rm(resolved.path, { force: true });
      return `Deleted ${resolved.relative}.`;
    }

    if (name === "run_command") {
      if (!allowWrites) return "Running commands is turned off. The person can turn on AI writes and commands in the AI settings.";
      if (!root) return "No project is open.";
      const command = String(input.command ?? "").trim();
      if (!command) return "run_command needs a command line.";
      const allowed = aiAllowed("ai:tool.exec", [root, command]);
      if (!allowed.ok) return allowed.reason;
      return await aiRunShell(root, command);
    }

    if (name === "git") {
      if (!root) return "No project is open.";
      const args = Array.isArray(input.args)
        ? input.args.map((value) => String(value))
        : String(input.args ?? "").split(/\s+/).filter(Boolean);
      if (args.length === 0) return 'git needs arguments, for example ["status"].';
      const sub = args[0];
      if (AI_GIT_BANNED.has(sub)) return `git ${sub} is not allowed from the assistant.`;
      const mutating = AI_GIT_WRITE.has(sub);
      if (!AI_GIT_READ.has(sub) && !mutating) {
        return `git ${sub} is not in the allowed set (status, diff, log, show, branch, rev-parse, remote, add, commit).`;
      }
      if (mutating && !allowWrites) return "Git writes (add/commit) are turned off. The person can turn on AI writes in the AI settings.";
      const allowed = aiAllowed(mutating ? "ai:tool.write" : "ai:tool.search", [root]);
      if (!allowed.ok) return allowed.reason;
      return await aiRunGit(root, args);
    }

    if (name === "transform_data") {
      const op = String(input.operation ?? "").trim().toLowerCase();
      const text = String(input.input ?? "");
      return aiExecuteDataTransform(op, text);
    }

    if (name === "open_tool_tab") {
      const target = String(input.tab ?? "").trim().toLowerCase();
      const sub = input.subtool ? String(input.subtool).trim().toLowerCase() : undefined;
      const valid = aiNormalizeToolTabName(target, sub);
      send({ type: "open_tool", tool: valid.tool, subtool: valid.subtool });
      return `Opened ${valid.tool}${valid.subtool ? ` (${valid.subtool})` : ""} in Wide IDE.`;
    }

    if (name === "get_diagnostics") {
      return await aiGetDiagnostics(root, input.path);
    }

    if (name === "send_http_request") {
      return await aiExecuteHttpRequest(input.url, input.method, input.headers, input.body, input.insecure);
    }

    if (name === "run_security_scan") {
      return await aiExecuteSecurityScan(root, input.path, input.minSeverity);
    }

    if (name === "check_dependencies") {
      return await aiExecuteDependencyCheck(root, input.manifest);
    }

    if (name === "get_open_tabs") {
      return aiExecuteGetOpenTabs(root);
    }

    if (name === "manage_catcher") {
      return await aiExecuteManageCatcher(input.action, input.intercept, input.limit);
    }

    if (name === "decision_score") {
      const candidates = Array.isArray(input.candidates) ? input.candidates : [];
      const criteria = Array.isArray(input.criteria) ? input.criteria : [];
      if (candidates.length === 0) return "decision_score requires non-empty candidates array.";
      const scorer = new DecisionWeightedScorer(
        criteria.map((cr) => ({
          weight: Number(cr.weight || 1.0),
          term: (idx) => Number(candidates[idx]?.[cr.field] ?? 0.0)
        }))
      );
      const sel = scorer.trySelect(candidates.length, Number(input.threshold || 0.5));
      return JSON.stringify({ ok: true, bestIndex: sel.best, score: sel.score, success: sel.success });
    }

    if (name === "decision_consensus") {
      const votes = Array.isArray(input.votes) ? input.votes : [];
      const count = Number(input.classesCount || 4);
      const c = new DecisionConsensus(count, Math.max(16, votes.length), Number(input.windowSec || 6.0), Number(input.minVotes || 1));
      const now = Date.now() / 1000.0;
      for (const v of votes) c.vote(Number(v.voterId || 1), Number(v.choice || 0), now);
      const settled = c.resolve(now);
      return JSON.stringify({ ok: true, settled, agreedClass: c.value });
    }

    if (name === "decision_claim") {
      const holderId = Number(input.holderId || 1);
      const bid = Number(input.bid || 1.0);
      const lifetime = Number(input.lifetime || 10.0);
      const capacity = Number(input.capacity || 1);
      const now = Date.now() / 1000.0;
      const ok = aiDecisionHub.claims.tryClaim(holderId, bid, lifetime, now, capacity);
      return JSON.stringify({ ok, occupancy: aiDecisionHub.claims.occupancy(now) });
    }

    return `There is no tool called ${name}.`;
  } catch (error) {
    return `That tool failed: ${String(error.message || error)}`;
  }
}

async function aiRunTurn({ provider, model, key, root, system, messages, allowWrites, effort = "fast", signal, send }) {
  const isThinking = effort === "thinking";
  const maxRounds = isThinking ? AI_MAX_TOOL_ROUNDS : 12;
  const tools = aiToolsFor(provider, allowWrites);
  const history = [...messages];
  let nudgedForFileWrite = false;

  for (let round = 0; round < maxRounds; round += 1) {
    const calls = [];
    let answered = false;
    let said = "";
    const filter = aiCreateStreamFilter(send);

    const stream =
      provider === "gemini"
        ? aiStreamGemini({ key, model, system, steps: aiToGeminiSteps(history), tools, effort, signal })
        : provider === "claude"
          ? aiStreamClaude({ key, model, system, messages: history, tools, effort, signal })
          : aiStreamDeepSeek({ key, model, system, messages: history, tools, effort, signal });

    for await (const event of stream) {
      if (event.type === "tool_use") {
        const norm = aiNormalizeToolCall(event.name, event.input);
        calls.push({ ...event, name: norm.name, input: norm.input });
      } else if (event.type === "text") {
        const chunkText = String(event.text ?? "");
        answered = true;
        said += chunkText;
        filter.push(chunkText);
      } else {
        send(event);
      }
    }
    filter.flush();

    if (calls.length === 0) {
      const textCalls = aiExtractTextToolCalls(said);
      for (let i = 0; i < textCalls.length; i += 1) {
        calls.push({
          id: `text-call-${round}-${i}`,
          name: textCalls[i].name,
          input: textCalls[i].input,
          fromText: true,
        });
      }
    }

    if (calls.length === 0) {
      if (!nudgedForFileWrite && round === 0 && allowWrites && root && aiHasSubstantialCodeBlock(said)) {
        nudgedForFileWrite = true;
        history.push({ role: "assistant", content: said });
        history.push({
          role: "user",
          content:
            `[Wide IDE Agent System]: You output code in the chat message without calling write_file or edit_file to write it to the project workspace (${root}). ` +
            `If this code should be saved as a new script/file or applied to an existing project file, call write_file or edit_file NOW using a tool call or:\n` +
            `<tool_call>\n{"name": "write_file", "arguments": {"path": "filename.ext", "content": "..."}}\n</tool_call>\n` +
            `If no project file should be created or modified, do not output anything.`,
        });
        continue;
      }
      return { ok: true, answered };
    }

    history.push(aiAssistantTurn(provider, calls, said));

    const latestUserText = aiGetLatestUserText(history);

    const callCounts = new Map();
    for (const call of calls) {
      const norm = aiNormalizeToolCall(call.name, call.input);
      const sig = `${norm.name}:${JSON.stringify(norm.input || {})}`;
      const count = (callCounts.get(sig) || 0) + 1;
      callCounts.set(sig, count);

      if (count > 3) {
        const errorResult = "DecisionCore CommitmentGate: Repeated identical tool invocation suppressed to prevent oscillation. Please synthesize your findings and proceed.";
        send({ type: "tool_start", id: call.id, name: norm.name, input: norm.input });
        send({ type: "tool_end", id: call.id, name: norm.name, result: errorResult });
        history.push(aiToolResultTurn(provider, call, errorResult));
        continue;
      }

      send({ type: "tool_start", id: call.id, name: norm.name, input: norm.input });
      const result = call.truncated
        ? `The call to ${norm.name} arrived cut off, so nothing was done. Send the call again with the complete argument object.`
        : await aiRunTool(root, norm.name, norm.input ?? {}, send, allowWrites, latestUserText);
      send({ type: "tool_end", id: call.id, name: norm.name, result });
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

async function aiWorkspaceOverview(root) {
  if (!root) return "";
  try {
    const dirents = await promises.readdir(root, { withFileTypes: true });
    const items = dirents
      .filter((entry) => !IGNORED$3.has(entry.name))
      .slice(0, 60)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    return items.length > 0 ? items.join(", ") : "(empty directory)";
  } catch {
    return "";
  }
}

function aiBuildToolCatalogPrompt(allowWrites) {
  const available = allowWrites ? AI_TOOLS : AI_TOOLS.filter((tool) => !AI_WRITE_TOOLS.has(tool.name));
  const specs = available.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  return [
    "## Available IDE Tools",
    "You have direct access to the following tools to read, search, create, edit, run, and interact with Wide IDE:",
    JSON.stringify(specs),
    "",
    "## How to Call Tools",
    "Whenever you need to inspect files, edit code, open a tool tab, send an HTTP request, control Catcher proxy, or run a security scan, invoke the appropriate tool.",
    "If native function calling is active, use it directly. You can ALWAYS invoke any tool by emitting a <tool_call> XML block containing a JSON object with \"name\" and \"arguments\":",
    "<tool_call>",
    "{\"name\": \"open_tool_tab\", \"arguments\": {\"tab\": \"pitcher\"}}",
    "</tool_call>",
    "",
    "Examples of tool calls:",
    "1. Open a tool tab in Wide IDE (Pitcher, Catcher, Scanner, CyberChef, etc.):",
    "<tool_call>",
    "{\"name\": \"open_tool_tab\", \"arguments\": {\"tab\": \"pitcher\"}}",
    "</tool_call>",
    "2. Send an HTTP request via Wide's Pitcher engine:",
    "<tool_call>",
    "{\"name\": \"send_http_request\", \"arguments\": {\"url\": \"http://localhost:3000/api/health\", \"method\": \"GET\"}}",
    "</tool_call>",
    "3. Control Catcher Intercepting Proxy (start proxy, check status, inspect traffic):",
    "<tool_call>",
    "{\"name\": \"manage_catcher\", \"arguments\": {\"action\": \"start\"}}",
    "</tool_call>",
    "<tool_call>",
    "{\"name\": \"manage_catcher\", \"arguments\": {\"action\": \"get_traffic\", \"limit\": 10}}",
    "</tool_call>",
    "4. Run Wide's Security AST and taint flow scan:",
    "<tool_call>",
    "{\"name\": \"run_security_scan\", \"arguments\": {}}",
    "</tool_call>",
    "5. Create or overwrite a file in the project workspace:",
    "<tool_call>",
    "{\"name\": \"write_file\", \"arguments\": {\"path\": \"script.py\", \"content\": \"print('Hello World')\\n\"}}",
    "</tool_call>",
    "6. Read an existing file before editing:",
    "<tool_call>",
    "{\"name\": \"read_file\", \"arguments\": {\"path\": \"package.json\"}}",
    "</tool_call>",
    "7. Edit a specific section of an existing file:",
    "<tool_call>",
    "{\"name\": \"edit_file\", \"arguments\": {\"path\": \"src/index.js\", \"find\": \"const port = 3000;\", \"replace\": \"const port = 8080;\"}}",
    "</tool_call>",
    "8. List files in a directory:",
    "<tool_call>",
    "{\"name\": \"list_dir\", \"arguments\": {\"path\": \"\"}}",
    "</tool_call>",
  ].join("\n");
}

const WIDE_INSTRUCTION_FILES = [
  ".wide/ai-instructions.md",
  ".wide/ai-instructions",
];

const FALLBACK_AGENT_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
];

async function aiReadProjectInstructions(root, strictWideOnly = false) {
  if (!root) return { path: "", relativePath: "", content: "", exists: false };
  const primary = node_path.join(root, ".wide", "ai-instructions.md");
  for (const rel of WIDE_INSTRUCTION_FILES) {
    const full = node_path.join(root, ...rel.split("/"));
    try {
      const stats = await promises.stat(full);
      if (stats.isFile() && stats.size <= 256 * 1024) {
        const text = await promises.readFile(full, "utf8");
        return { path: full, relativePath: rel, content: text, exists: true };
      }
    } catch {
    }
  }
  if (strictWideOnly) {
    return { path: primary, relativePath: ".wide/ai-instructions.md", content: "", exists: false };
  }
  for (const rel of FALLBACK_AGENT_FILES) {
    const full = node_path.join(root, ...rel.split("/"));
    try {
      const stats = await promises.stat(full);
      if (stats.isFile() && stats.size <= 256 * 1024) {
        const text = await promises.readFile(full, "utf8");
        if (text.trim()) {
          return { path: full, relativePath: rel, content: text.trim(), exists: true };
        }
      }
    } catch {
    }
  }
  try {
    const stats = await promises.stat(primary);
    if (stats.isFile()) {
      const text = await promises.readFile(primary, "utf8");
      return { path: primary, relativePath: ".wide/ai-instructions.md", content: text, exists: true };
    }
  } catch {
  }
  return { path: primary, relativePath: ".wide/ai-instructions.md", content: "", exists: false };
}

async function aiBuildAgentSystemPrompt(system, root, allowWrites, projectInstructions = "", effort = "fast") {
  const overview = await aiWorkspaceOverview(root);
  const trimmedSystem = String(system || "").trim();
  const hasInstructionsInSystem = projectInstructions && trimmedSystem.includes(projectInstructions);
  const isThinking = effort === "thinking";
  const effortRules = isThinking
    ? [
        "## Effort Mode: Deep Thinking (Active)",
        "1. Before executing tool calls or writing your final response, enclose your step-by-step architectural reasoning, edge-case analysis, and file modification plan inside a `<think>...</think>` block.",
        "2. Inspect relevant files thoroughly using `read_file` or `search` to verify types, imports, and side effects before applying edits.",
      ].join("\n")
    : [
        "## Effort Mode: Fast Execution (Active)",
        "1. Do NOT output `<think>` blocks or lengthy preambles. Proceed straight to executing the required tool calls (`read_file`, `write_file`, `edit_file`) and give a direct, concise answer.",
      ].join("\n");

  const coreRules = [
    "# Wide IDE Autonomous Coding & Security Agent",
    "You are an autonomous AI software engineering and security agent integrated natively into Wide IDE.",
    "Wide IDE is a next-generation engineering environment that uniquely unites high-performance code editing with built-in web security tools:",
    "- Pitcher: Comprehensive API client (REST, GraphQL, WebSocket, gRPC, auth, test scripting).",
    "- Catcher: Web security workbench and intercepting proxy for live pentesting and traffic inspection.",
    "- Security Scanner: Real-time AST vulnerability inspection engine flagging injection sinks, weak crypto, and secret leaks.",
    "- Decoder / CyberChef: Integrated encoder/decoder suite (Base64, Hex, URL, JWT, hashing, compression).",
    "- Git & Terminal: Native source control and shell execution directly within the workspace.",
    root
      ? `The user's active project workspace is open at: ${root}`
      : "No project workspace folder is currently open.",
    overview ? `Top-level files and folders in the project workspace: ${overview}` : "",
    "",
    effortRules,
    "",
    "## Critical Agentic Behavior Rules",
    "1. YOU ARE A CODE AGENT, NOT A PASSIVE CHATBOT. You directly operate on the user's project files.",
    "2. NEVER dump full scripts or file implementations into the chat window when the user asks you to write a script, create a file, build a feature, fix a bug, or modify code. You MUST call `write_file` or `edit_file` to write the code directly into the project files on disk.",
    "3. If the user asks you to write a script or create code without specifying a filename, pick a clean, appropriate filename in the project workspace (for example `script.py`, `index.js`, `main.py`, etc.) and immediately call `write_file` to create it.",
    "4. Before editing an existing file, read it first with `read_file` so you know its exact contents, then modify it with `edit_file` or `write_file`.",
    "5. After your tool calls complete and the files are written on disk, provide a concise, helpful summary in the user's language explaining which files you created or modified.",
    "6. NEVER modify, overwrite, create, or delete `.wide/ai-instructions.md` unless the user explicitly requested to update project instructions. That file is managed exclusively by the user.",
    "7. LANGUAGE CONSISTENCY: Always converse and summarize in the user's language (if the user writes in Turkish, reply in fluent Turkish; if English, respond in English).",
    "8. SECURITY MINDSET: Always produce clean, secure, production-grade code. Never introduce SQL injection, XSS, command injection, path traversal, hardcoded secrets, or insecure dependencies. Fix issues defensively at their root cause.",
    "9. NATIVE WIDE TOOLS CONSCIOUSNESS & CONTROL: You have full programmatic control over Wide's built-in tools! NEVER tell the user 'I cannot click Pitcher/Catcher in the UI', or that you cannot interact with Wide's interface. You do not need to click UI buttons like a human; you ARE the core agent of Wide IDE! When the user asks you to demonstrate, test, or use Pitcher, Catcher, Scanner, or Decoder:",
    "   - Use `open_tool_tab` to navigate to that tool on the user's screen (e.g. `open_tool_tab({ tab: 'pitcher' })` or `open_tool_tab({ tab: 'catcher', subtool: 'proxy' })`).",
    "   - Use `manage_catcher` to start the Catcher proxy (`action: 'start'`), check status (`action: 'status'`), inspect live captured traffic (`action: 'get_traffic'`), or toggle intercept (`action: 'set_intercept'`).",
    "   - Use `send_http_request` to dispatch HTTP/HTTPS requests with Wide's Pitcher engine.",
    "   - Use `run_security_scan` to trigger AST & taint vulnerability scans.",
    "   - Use `transform_data` to encode/decode/hash data in CyberChef.",
    "   Actively call these tools to perform the actions directly!",
    projectInstructions && !hasInstructionsInSystem
      ? `\n## Project AI Instructions (.wide/ai-instructions.md — Mandatory Project Rules)\n${projectInstructions}`
      : "",
    "",
    aiBuildToolCatalogPrompt(allowWrites),
  ]
    .filter((line) => line !== undefined && line !== "")
    .join("\n");

  return [trimmedSystem, coreRules].filter(Boolean).join("\n\n");
}

function aiWithAgentDirective(messages, root, allowWrites, projectInstructions = "") {
  const list = Array.isArray(messages) ? messages : [];
  if (!root && !projectInstructions) return list;
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
  const parts = [message.content];
  if (projectInstructions) {
    parts.push(`[Project AI Instructions (.wide/ai-instructions.md — You MUST follow these rules):\n${projectInstructions}]`);
  }
  if (root && allowWrites) {
    parts.push(
      `[Agent Reminder: You are an autonomous coding and security agent inside Wide IDE (workspace: ${root}). ` +
        `Wide IDE uniquely integrates code editing with live security & API tools: ` +
        `Pitcher (send_http_request), Catcher Proxy & Pentest Workbench (manage_catcher), AST Security Scanner (run_security_scan), CyberChef Decoder (transform_data), and UI Navigation (open_tool_tab). ` +
        `DO NOT say you cannot click or interact with Pitcher/Catcher in the UI — you have native tools for them! ` +
        `If the user asks you to write code, create a file, or demonstrate/test Pitcher or Catcher, actively invoke your tools (` +
        `open_tool_tab, manage_catcher, send_http_request, write_file, edit_file). ` +
        `Apply secure coding practices and reply in the user's language (e.g. your language).]`
    );
  }
  copy[last] = {
    ...message,
    content: parts.join("\n\n"),
  };
  return copy;
}

const AI_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function aiCleanImages(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const image of value) {
    const mime = String((image && image.mime) || "").toLowerCase();
    const data = String((image && image.data) || "");
    if (!AI_IMAGE_MIMES.has(mime) || !data) continue;
    out.push({ mime, data });
    if (out.length >= 4) break;
  }
  return out;
}

function aiApplyImages(messages, provider) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((message) => {
    const images = aiCleanImages(message && message.images);
    if (images.length === 0) {
      if (message && message.images) {
        const { images: _drop, ...rest } = message;
        return rest;
      }
      return message;
    }
    const { images: _drop, ...rest } = message;
    const text = String(rest.content ?? "");

    if (provider === "claude") {
      return {
        ...rest,
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...images.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mime, data: image.data },
          })),
        ],
      };
    }

    if (provider === "deepseek") {
      return {
        ...rest,
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mime};base64,${image.data}` },
          })),
        ],
      };
    }

    if (provider === "local") {
      return { ...rest, images: images.map((image) => image.data) };
    }

    return rest;
  });
}

function registerAiAgentHandlers() {
  electron.ipcMain.handle("ai:telemetry", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    try {
      const [system, runningModels] = await Promise.all([
        aiLiveResources(),
        aiLocalRunningModels(),
      ]);
      return {
        ok: true,
        system,
        runningModels,
        cloud: aiGetCloudTelemetry(),
      };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });

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
      effort = "fast",
    } = request ?? {};
    const cleanEffort = effort === "thinking" ? "thinking" : "fast";
    if (Array.isArray(request?.openTabs)) {
      aiLastKnownOpenTabs = request.openTabs;
    }
    if (!id) return { ok: false, error: "No turn id." };

    const egress = check({ channel: "ai:egress", args: [provider], subject: "user" });
    if (egress.decision === "deny" && egress.enforced) {
      return { ok: false, error: egress.reason || "The policy refused that provider." };
    }

    const config = await readAiConfig();
    const key = await aiKeyFor(provider === "claude-code" ? "claude" : provider);
    if (!key && provider !== "claude-code" && provider !== "opencode" && provider !== "local") {
      return { ok: false, error: "no-key" };
    }

    const projInstr = await aiReadProjectInstructions(root);
    const prompt = await aiBuildAgentSystemPrompt(system, root, config.allowWrites, projInstr.content, cleanEffort);
    const turn = aiApplyImages(aiWithAgentDirective(messages, root, config.allowWrites, projInstr.content), provider);

    const sender = event.sender;
    const controller = new AbortController();
    aiTurns.set(id, controller);

    if (provider !== "claude-code" && provider !== "opencode") {
      try {
        await ensureMcp(root);
      } catch {
        void 0;
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
      if (provider === "opencode") {
        return await aiRunOpenCodeTurn({
          root,
          model,
          system: prompt,
          messages,
          projectInstructions: projInstr.content,
          allowWrites: config.allowWrites,
          effort: cleanEffort,
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
          effort: cleanEffort,
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
        effort: cleanEffort,
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
          model,
          root: "",
          system,
          messages,
          allowWrites: false,
          signal: controller.signal,
          send: (event) => {
            if (event.type === "text" && typeof event.text === "string") text += event.text;
          },
        });
      } else if (provider === "opencode") {
        await aiRunOpenCodeTurn({
          root: "",
          model,
          system: prompt,
          messages,
          projectInstructions: "",
          allowWrites: false,
          effort: "fast",
          signal: controller.signal,
          send: (event) => {
            if (event.type === "text" && typeof event.text === "string") text += event.text;
          },
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

  electron.ipcMain.handle("ai:instructionsGet", async (_event, root) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };
    try {
      const info = await aiReadProjectInstructions(String(root), true);
      return { ok: true, path: info.path, relativePath: info.relativePath, content: info.content, exists: info.exists };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });

  electron.ipcMain.handle("ai:instructionsSave", async (_event, root, content) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };
    const resolved = aiResolvePath(String(root), ".wide/ai-instructions.md");
    if (resolved.error) return { ok: false, error: resolved.error };
    try {
      await promises.mkdir(node_path.dirname(resolved.path), { recursive: true });
      const text = String(content ?? "");
      await writeFileAtomic(resolved.path, text, "utf8");
      return { ok: true, path: resolved.path, content: text };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
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
