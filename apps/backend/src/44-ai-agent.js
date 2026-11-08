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

async function aiRunTool(root, rawName, rawInput, send, allowWrites) {
  try {
    const normalized = aiNormalizeToolCall(rawName, rawInput);
    const name = normalized.name;
    const input = normalized.input;

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
      send({ type: "edit", root, path: resolved.path, oldContent, content: newContent, existed });
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
      send({ type: "edit", root, path: resolved.path, oldContent: content, content: next, existed: true });
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

    for (const call of calls) {
      const norm = aiNormalizeToolCall(call.name, call.input);
      send({ type: "tool_start", id: call.id, name: norm.name, input: norm.input });
      const result = call.truncated
        ? `The call to ${norm.name} arrived cut off, so nothing was done. Send the call again with the complete argument object.`
        : await aiRunTool(root, norm.name, norm.input ?? {}, send, allowWrites);
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
    "You have direct access to the following tools to read, search, create, edit, and run files in the user's project workspace:",
    JSON.stringify(specs),
    "",
    "## How to Call Tools",
    "Whenever you need to inspect files, create a new script/file, edit existing code, or run a command, invoke the appropriate tool.",
    "If native function calling is active, use it directly. You can ALWAYS invoke any tool by emitting a <tool_call> XML block containing a JSON object with \"name\" and \"arguments\":",
    "<tool_call>",
    "{\"name\": \"write_file\", \"arguments\": {\"path\": \"example.py\", \"content\": \"print('Hello World')\\n\"}}",
    "</tool_call>",
    "",
    "Examples of tool calls:",
    "1. Create or overwrite a file in the project:",
    "<tool_call>",
    "{\"name\": \"write_file\", \"arguments\": {\"path\": \"script.py\", \"content\": \"import os\\nprint(os.getcwd())\\n\"}}",
    "</tool_call>",
    "2. Read an existing file before editing:",
    "<tool_call>",
    "{\"name\": \"read_file\", \"arguments\": {\"path\": \"package.json\"}}",
    "</tool_call>",
    "3. Edit a specific section of an existing file:",
    "<tool_call>",
    "{\"name\": \"edit_file\", \"arguments\": {\"path\": \"src/index.js\", \"find\": \"const port = 3000;\", \"replace\": \"const port = 8080;\"}}",
    "</tool_call>",
    "4. List files in a directory:",
    "<tool_call>",
    "{\"name\": \"list_dir\", \"arguments\": {\"path\": \"\"}}",
    "</tool_call>",
  ].join("\n");
}

const AI_INSTRUCTION_FILES = [
  ".wide/ai-instructions.md",
  ".wide/ai-instructions",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
];

async function aiReadProjectInstructions(root) {
  if (!root) return { path: "", relativePath: "", content: "", exists: false };
  const primary = node_path.join(root, ".wide", "ai-instructions.md");
  for (const rel of AI_INSTRUCTION_FILES) {
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
    "# Wide IDE Autonomous Coding Agent",
    "You are an autonomous AI software engineering agent integrated directly into Wide IDE.",
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
      `[Agent Reminder: You are an autonomous coding agent inside Wide IDE (workspace: ${root}). ` +
        `If the user is asking you to write a script, create a file, or edit/fix code in the project, DO NOT just print the code in chat — you MUST call write_file or edit_file (either via native tool call or <tool_call>{"name": "write_file", "arguments": {"path": "...", "content": "..."}}</tool_call>) to create or update the actual file in the project workspace. Reply in the user's language.]`
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
          system,
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
          system,
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
      const info = await aiReadProjectInstructions(String(root));
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
