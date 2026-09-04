

const COMMENT_SYNTAX = {
  javascript: {
    line: ["//"],
    block: [["/*", "*/"]],
    strings: [
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    template: true,
    regex: true,
    keep: [
      /^!/,
      /^#\s*sourceMappingURL/,
      /^\s*@(license|preserve)\b/,
      /^\s*@ts-/,
      /^\/\s*<reference\b/,
      /^\s*(eslint|prettier-ignore|istanbul|c8|v8)\b/,
      /^\s*#__PURE__/,
      /^\s*(webpack|vite|@vite)\w*:/,
      /^\s*global\s/,
      /^\s*@jsx\b/,
    ],
  },

  html: {
    block: [["<!--", "-->"]],

    keep: [
      /^\[if\b/,
      /^<!\[endif\]/,
    ],

  },

  css: {
    block: [["/*", "*/"]],
    strings: [
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    keep: [/^!/],
  },

  php: {

    line: ["//", "#"],
    block: [["/*", "*/"]],
    strings: [
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    heredoc: "php",

    phpTags: true,
    keep: [/^\[/],
  },

  python: {
    line: ["#"],
    strings: [
      { open: '"""', close: '"""', escape: "\\" },
      { open: "'''", close: "'''", escape: "\\" },
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    keep: [
      /^!/,
      /^\s*-\*-.*coding[:=]/,
      /^\s*coding[:=]\s*[-\w.]+/,
      /^\s*type:/,
      /^\s*(noqa|nosec|pragma|pylint|mypy|flake8|ruff|isort|yapf|fmt)\b/,
    ],
  },

  csharp: {

    line: ["//"],
    block: [["/*", "*/"]],
    strings: [
      { open: '@"', close: '"', escape: null, doubled: '"' },
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    keep: [/^\s*\$COVERAGE-(OFF|ON)\$/],
  },

  java: {
    line: ["//"],
    block: [["/*", "*/"]],
    strings: [
      { open: '"""', close: '"""', escape: "\\" },
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    keep: [/^\s*(CHECKSTYLE|SUPPRESS|NOSONAR)\b/],
  },

  go: {
    line: ["//"],
    block: [["/*", "*/"]],
    strings: [
      { open: "`", close: "`", escape: null },
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    keep: [
      /^go:/,
      /^\s*\+build\b/,
      /^\s*Code generated .* DO NOT EDIT\./,
      /^\s*nolint\b/,
    ],

    cgo: true,
  },

  ruby: {
    line: ["#"],

    lineBlock: [["=begin", "=end"]],
    strings: [
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
      { open: "%w[", close: "]", escape: "\\" },
      { open: "%i[", close: "]", escape: "\\" },
    ],
    heredoc: "ruby",
    keep: [
      /^!/,
      /^\s*(frozen_string_literal|encoding|coding|warn_indent|shareable_constant_value)\s*:/,
      /^\s*(rubocop|:nodoc:|:nocov:)\b/,
    ],
  },

  rust: {
    line: ["//"],
    block: [["/*", "*/"]],
    nestedBlocks: true,
    strings: [
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    rawStrings: true,
    keep: [/^\s*(rustfmt|clippy|tarpaulin)\b/],
  },

  elixir: {
    line: ["#"],
    strings: [
      { open: '"""', close: '"""', escape: "\\" },
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    keep: [/^!/],
  },

  kotlin: {
    line: ["//"],
    block: [["/*", "*/"]],
    nestedBlocks: true,
    strings: [
      { open: '"""', close: '"""', escape: null },
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    keep: [/^\s*(NOSONAR|noinspection)\b/],
  },

  sql: {
    line: ["--"],
    block: [["/*", "*/"]],
    strings: [
      { open: "'", close: "'", escape: null, doubled: "'" },
      { open: '"', close: '"', escape: null, doubled: '"' },
    ],
    keep: [
      /^!/,
      /^\+/,
    ],
  },

  graphql: {
    line: ["#"],
    strings: [
      { open: '"""', close: '"""', escape: "\\" },
      { open: '"', close: '"', escape: "\\" },
    ],
    keep: [],
  },

  wasm: {
    line: [";;"],
    block: [["(;", ";)"]],
    nestedBlocks: true,
    strings: [{ open: '"', close: '"', escape: "\\" }],
    keep: [],
  },

  scala: {
    line: ["//"],
    block: [["/*", "*/"]],
    nestedBlocks: true,
    strings: [
      { open: '"""', close: '"""', escape: null },
      { open: '"', close: '"', escape: "\\" },
      { open: "'", close: "'", escape: "\\" },
    ],
    keep: [/^\s*\$COVERAGE-(OFF|ON)\$/],
  },

  erlang: {
    line: ["%"],
    strings: [
      { open: '"', close: '"', escape: "\\" },
      { open: "$", close: "", escape: "\\", charLiteral: true },
    ],
    keep: [/^\s*-\*-.*coding[:=]/],
  },
};

COMMENT_SYNTAX.typescript = {
  ...COMMENT_SYNTAX.javascript,

};

const COMMENT_LANGUAGE_BY_EXTENSION = {
  cjs: "javascript", js: "javascript", jsx: "javascript", mjs: "javascript",
  cts: "typescript", mts: "typescript", ts: "typescript", tsx: "typescript",
  htm: "html", html: "html", xhtml: "html",
  css: "css", less: "css", pcss: "css", postcss: "css", scss: "css",
  php: "php", php3: "php", php4: "php", php5: "php", phps: "php", phtml: "php",
  py: "python", pyi: "python", pyw: "python",
  cs: "csharp", csx: "csharp",
  java: "java",
  go: "go",
  gemspec: "ruby", rake: "ruby", rb: "ruby", ru: "ruby",
  rs: "rust",
  ex: "elixir", exs: "elixir",
  kt: "kotlin", kts: "kotlin",
  ddl: "sql", dml: "sql", sql: "sql",
  gql: "graphql", graphql: "graphql", graphqls: "graphql",
  wast: "wasm", wat: "wasm",
  sc: "scala", scala: "scala",
  erl: "erlang", hrl: "erlang",
};

const MAX_STRIP_BYTES = 8 * 1024 * 1024;

function commentLanguageFor(filePath) {
  const name = String(filePath || "").replace(/^.*[\\/]/, "").toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return COMMENT_LANGUAGE_BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

const REGEX_ALLOWED_BEFORE = /(^|[\s(,=:[!&|?{};+\-*%~^<>])$/;
const VALUE_KEYWORDS = /\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

function regexCanFollow(text, index) {
  let before = text.slice(0, index);
  const trimmed = before.replace(/\s+$/, "");
  if (trimmed.length === 0) return true;
  if (VALUE_KEYWORDS.test(trimmed)) return true;
  return REGEX_ALLOWED_BEFORE.test(before);
}

function findComments(text, syntax) {
  const ranges = [];
  const lines = syntax.line ?? [];
  const blocks = syntax.block ?? [];
  const lineBlocks = syntax.lineBlock ?? [];
  const strings = syntax.strings ?? [];

  let inPhp = !syntax.phpTags;
  let i = 0;
  const n = text.length;

  const atLineStart = (at) => at === 0 || text[at - 1] === "\n";

  while (i < n) {
    const rest = text.slice(i, i + 8);

    if (syntax.phpTags) {
      if (!inPhp) {
        const open = text.indexOf("<?", i);
        if (open === -1) break;
        i = open + 2;
        if (text.startsWith("php", i)) i += 3;
        else if (text[i] === "=") i += 1;
        inPhp = true;
        continue;
      }
      if (rest.startsWith("?>")) {
        inPhp = false;
        i += 2;
        continue;
      }
    }

    let consumed = false;

    if (syntax.rawStrings && text[i] === "r") {
      const match = /^r(#*)"/.exec(text.slice(i, i + 32));
      if (match) {
        const terminator = `"${match[1]}`;
        const end = text.indexOf(terminator, i + match[0].length);
        if (end === -1) return null;
        i = end + terminator.length;
        continue;
      }
    }

    if (syntax.heredoc) {
      const heredoc =
        syntax.heredoc === "php"
          ? /^<<<\s*(['"]?)([A-Za-z_]\w*)\1\r?\n/.exec(text.slice(i, i + 80))
          : /^<<[~-]?\s*(['"]?)([A-Za-z_]\w*)\1\r?\n/.exec(text.slice(i, i + 80));
      if (heredoc) {
        const label = heredoc[2];
        const closer = new RegExp(`^[ \\t]*${label}\\b`, "m");
        const after = i + heredoc[0].length;
        const found = closer.exec(text.slice(after));
        if (!found) return null;
        i = after + found.index + found[0].length;
        continue;
      }
    }

    for (const literal of strings) {
      if (!text.startsWith(literal.open, i)) continue;

      if (literal.charLiteral) {
        i += text[i + 1] === literal.escape ? 3 : 2;
        consumed = true;
        break;
      }
      let j = i + literal.open.length;
      let closed = false;
      while (j < n) {
        if (literal.escape && text[j] === literal.escape) {
          j += 2;
          continue;
        }
        if (text.startsWith(literal.close, j)) {

          if (literal.doubled && text.startsWith(literal.doubled, j + literal.close.length)) {
            j += literal.close.length + literal.doubled.length;
            continue;
          }
          j += literal.close.length;
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) return null;
      i = j;
      consumed = true;
      break;
    }
    if (consumed) continue;

    if (syntax.template && text[i] === "`") {
      let j = i + 1;
      let depth = 0;
      let closed = false;
      while (j < n) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (depth === 0 && text.startsWith("${", j)) {
          depth = 1;
          j += 2;
          continue;
        }
        if (depth > 0) {

          if (text[j] === "{") depth += 1;
          else if (text[j] === "}") depth -= 1;
          j += 1;
          continue;
        }
        if (text[j] === "`") {
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) return null;
      i = j;
      continue;
    }

    if (syntax.regex && text[i] === "/" && !text.startsWith("//", i) && !text.startsWith("/*", i)) {
      if (regexCanFollow(text, i)) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < n) {
          const ch = text[j];
          if (ch === "\\") {
            j += 2;
            continue;
          }
          if (ch === "\n") break;
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) {
            j += 1;
            closed = true;
            break;
          }
          j += 1;
        }
        if (closed) {
          while (j < n && /[a-z]/.test(text[j])) j += 1;
          i = j;
          continue;
        }

      }
    }

    let matched = false;

    for (const [open, close] of lineBlocks) {
      if (!atLineStart(i) || !text.startsWith(open, i)) continue;
      const end = text.indexOf(`\n${close}`, i);
      if (end === -1) return null;
      const lineEnd = text.indexOf("\n", end + 1);
      const stop = lineEnd === -1 ? n : lineEnd + 1;
      ranges.push({ start: i, end: stop, text: text.slice(i + open.length, end), whole: true });
      i = stop;
      matched = true;
      break;
    }
    if (matched) continue;

    for (const [open, close] of blocks) {
      if (!text.startsWith(open, i)) continue;
      let j = i + open.length;
      let depth = 1;
      while (j < n) {
        if (syntax.nestedBlocks && text.startsWith(open, j)) {
          depth += 1;
          j += open.length;
          continue;
        }
        if (text.startsWith(close, j)) {
          depth -= 1;
          j += close.length;
          if (depth === 0) break;
          continue;
        }
        j += 1;
      }
      if (depth !== 0) return null;
      ranges.push({ start: i, end: j, text: text.slice(i + open.length, j - close.length) });
      i = j;
      matched = true;
      break;
    }
    if (matched) continue;

    for (const open of lines) {
      if (!text.startsWith(open, i)) continue;

      if (open === "#" && text[i + 1] === "[") continue;
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      ranges.push({ start: i, end: stop, text: text.slice(i + open.length, stop) });
      i = stop;
      matched = true;
      break;
    }
    if (matched) continue;

    i += 1;
  }

  return ranges;
}

function cut(text, ranges) {
  let out = "";
  let at = 0;
  for (const range of ranges) {
    out += text.slice(at, range.start);
    at = range.end;

    const lineStart = out.lastIndexOf("\n") + 1;
    const before = out.slice(lineStart);
    const aloneOnLine = before.trim().length === 0;

    if (aloneOnLine) {
      out = out.slice(0, lineStart);

      if (text[at] === "\r") at += 1;
      if (text[at] === "\n") at += 1;
    } else {
      out = out.replace(/[ \t]+$/, "");
    }
  }
  out += text.slice(at);

  return out.replace(/(\r?\n)[ \t]*(\r?\n)[ \t]*(\r?\n)+/g, "$1$2");
}

function stripComments(text, language) {
  const syntax = COMMENT_SYNTAX[language];
  if (!syntax) return { ok: false, reason: "unsupported" };

  const ranges = findComments(text, syntax);

  if (ranges === null) return { ok: false, reason: "unparsed" };

  const keep = syntax.keep ?? [];
  const cutting = [];
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (keep.some((pattern) => pattern.test(range.text))) continue;

    if (syntax.cgo) {
      const after = text.slice(range.end, range.end + 200);
      if (/^\s*import\s+"C"/.test(after)) continue;
    }

    cutting.push(range);
  }

  return { ok: true, text: cut(text, cutting), removed: cutting.length, found: ranges.length };
}

function stripHtml(text) {
  const RAW = /<(script|style|title|textarea)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let out = "";
  let at = 0;
  let removed = 0;
  let match;

  while ((match = RAW.exec(text)) !== null) {
    const outside = stripComments(text.slice(at, match.index), "html");
    if (!outside.ok) return outside;
    out += outside.text;
    removed += outside.removed;

    const [whole, tag, attributes, body] = match;
    const name = tag.toLowerCase();
    let inner = body;
    if (name === "script") {

      const type = /type\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase();
      if (!type || /javascript|module|ecmascript|jsx|babel/.test(type)) {
        const result = stripComments(body, "javascript");
        if (result.ok) {
          inner = result.text;
          removed += result.removed;
        }
      }
    } else if (name === "style") {
      const result = stripComments(body, "css");
      if (result.ok) {
        inner = result.text;
        removed += result.removed;
      }
    }
    out += whole.slice(0, whole.indexOf(body)) + inner + whole.slice(whole.indexOf(body) + body.length);
    at = match.index + whole.length;
  }

  const tail = stripComments(text.slice(at), "html");
  if (!tail.ok) return tail;
  return { ok: true, text: out + tail.text, removed: removed + tail.removed };
}

function registerCommentHandlers() {

  electron.ipcMain.handle("comments:strip", async (_event, root, filePath, text) => {
    const gate = await requireInstalled("comment-cleaner");
    if (gate) return gate;

    const source = typeof text === "string" ? text : "";
    if (source.length > MAX_STRIP_BYTES) {
      return { ok: false, reason: "too-large", error: "That file is too large to clean." };
    }
    const language = commentLanguageFor(filePath);
    if (!language) {
      return { ok: false, reason: "unsupported", error: "Wide has no cleaner for this kind of file." };
    }

    const result = language === "html" ? stripHtml(source) : stripComments(source, language);
    if (!result.ok) {
      if (result.reason === "unparsed") {
        return {
          ok: false,
          reason: "unparsed",
          error: "This file could not be read all the way through, so nothing was changed.",
        };
      }
      return { ok: false, reason: result.reason, error: "Wide has no cleaner for this kind of file." };
    }
    return { ok: true, text: result.text, removed: result.removed, language };
  });

  electron.ipcMain.handle("comments:language", async (_event, filePath) => {
    const gate = await requireInstalled("comment-cleaner");
    if (gate) return gate;
    return { ok: true, language: commentLanguageFor(filePath) };
  });
}
