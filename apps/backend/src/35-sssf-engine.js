

class SssfError extends Error {
  constructor(message, position) {
    super(message);
    this.name = "SssfError";
    this.position = position ?? { line: 0, column: 0 };
  }
}
const PUNCTUATION =  new Set(["{", "}", "[", "]", "(", ")", "=", ","]);
const isIdentStart = (char) => /[A-Za-z_]/.test(char);
const isIdentPart = (char) => /[A-Za-z0-9_.\-]/.test(char);
function tokenize(source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;
  const here = () => ({ line, column });
  const advance = (count = 1) => {
    for (let step = 0; step < count; step += 1) {
      if (source[index] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      index += 1;
    }
  };
  while (index < source.length) {
    const char = source[index];
    if (char === "#") {
      while (index < source.length && source[index] !== "\n") advance();
      continue;
    }
    if (/\s/.test(char)) {
      advance();
      continue;
    }
    if (PUNCTUATION.has(char)) {
      tokens.push({ kind: "punct", value: char, position: here() });
      advance();
      continue;
    }
    if (char === '"') {
      const position = here();
      advance();
      let value = "";
      while (index < source.length && source[index] !== '"') {
        if (source[index] === "\n") {
          throw new SssfError("A string was not closed before the end of the line.", position);
        }
        if (source[index] === "\\") {
          const escaped = source[index + 1];
          if (escaped === void 0) break;
          value += escaped === "n" ? "\n" : escaped === "t" ? "	" : escaped;
          advance(2);
          continue;
        }
        value += source[index];
        advance();
      }
      if (source[index] !== '"') throw new SssfError("A string was never closed.", position);
      advance();
      tokens.push({ kind: "string", value, position });
      continue;
    }
    if (char === "/") {
      const position = here();
      advance();
      let pattern = "";
      let inClass = false;
      while (index < source.length) {
        const current = source[index];
        if (current === "\n") {
          throw new SssfError("A regex was not closed before the end of the line.", position);
        }
        if (current === "\\") {
          pattern += current + (source[index + 1] ?? "");
          advance(2);
          continue;
        }
        if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) break;
        pattern += current;
        advance();
      }
      if (source[index] !== "/") throw new SssfError("A regex was never closed.", position);
      advance();
      let flags = "";
      while (index < source.length && /[gimsuy]/.test(source[index])) {
        flags += source[index];
        advance();
      }
      try {
        RegExp(pattern, flags);
      } catch (error) {
        throw new SssfError(`Invalid regex: ${error.message}`, position);
      }
      tokens.push({ kind: "regex", value: pattern, flags, position });
      continue;
    }
    if (/[0-9]/.test(char)) {
      const position = here();
      let raw = "";
      while (index < source.length && /[0-9_]/.test(source[index])) {
        raw += source[index];
        advance();
      }
      tokens.push({ kind: "number", value: Number(raw.replace(/_/g, "")), position });
      continue;
    }
    if (isIdentStart(char)) {
      const position = here();
      let value = "";
      while (index < source.length && isIdentPart(source[index])) {
        value += source[index];
        advance();
      }
      tokens.push({ kind: "ident", value, position });
      continue;
    }
    throw new SssfError(`Unexpected character ${JSON.stringify(char)}.`, here());
  }
  tokens.push({ kind: "eof", value: null, position: here() });
  return tokens;
}
const MODES =  new Set(["enforce", "audit", "off"]);
const FAIL_MODES =  new Set(["closed", "open"]);
const AUDIT_MODES =  new Set(["always", "never"]);
const UNITS =  new Set(["second", "minute", "hour"]);
const SUBJECTS =  new Set(["user", "ai", "system"]);
function parse(tokens) {
  let cursor = 0;
  const peek = (offset = 0) => tokens[Math.min(cursor + offset, tokens.length - 1)];
  const done = () => peek().kind === "eof";
  const fail2 = (message, token = peek()) => {
    throw new SssfError(message, token.position);
  };
  const next = () => tokens[cursor++];
  const isWord = (value, offset = 0) => {
    const token = peek(offset);
    return token.kind === "ident" && token.value === value;
  };
  const isPunct = (value, offset = 0) => {
    const token = peek(offset);
    return token.kind === "punct" && token.value === value;
  };
  const eatWord = (value) => {
    if (!isWord(value)) return false;
    cursor += 1;
    return true;
  };
  const expectWord = (value) => {
    if (!isWord(value)) fail2(`Expected '${value}'.`);
    return next();
  };
  const expectPunct = (value) => {
    if (!isPunct(value)) fail2(`Expected '${value}'.`);
    return next();
  };
  const expectIdent = (what) => {
    if (peek().kind !== "ident") fail2(`Expected ${what}.`);
    return next();
  };
  const expectString = (what) => {
    if (peek().kind !== "string") fail2(`Expected ${what}.`);
    return next();
  };
  const expectNumber = (what) => {
    if (peek().kind !== "number") fail2(`Expected ${what}.`);
    return next();
  };
  const expectOneOf = (allowed, what) => {
    const token = expectIdent(what);
    if (!allowed.has(token.value)) {
      fail2(`${what} must be one of: ${[...allowed].join(", ")}.`, token);
    }
    return token;
  };
  function parsePatternRef() {
    const token = peek();
    if (token.kind === "string") {
      next();
      return { type: "glob", pattern: token.value, position: token.position };
    }
    if (token.kind === "regex") {
      next();
      return { type: "regex", pattern: token.value, flags: token.flags, position: token.position };
    }
    if (token.kind === "ident") {
      next();
      return { type: "set", name: token.value, position: token.position };
    }
    return fail2('Expected a set name, a "glob" or a /regex/.');
  }
  function parsePrimary() {
    const token = peek();
    if (isPunct("(")) {
      next();
      const inner = parseExpression();
      expectPunct(")");
      return inner;
    }
    if (isWord("not")) {
      next();
      return { kind: "not", operand: parsePrimary(), position: token.position };
    }
    if (isWord("always")) {
      next();
      return { kind: "always", position: token.position };
    }
    if (isWord("path")) {
      next();
      if (eatWord("inside")) {
        expectWord("project");
        return { kind: "pathInside", position: token.position };
      }
      if (eatWord("outside")) {
        expectWord("project");
        return { kind: "not", operand: { kind: "pathInside" }, position: token.position };
      }
      if (eatWord("matches")) {
        return { kind: "pathMatches", pattern: parsePatternRef(), position: token.position };
      }

      if (eatWord("opened")) {
        return { kind: "pathOpened", position: token.position };
      }
      return fail2("After 'path', expected 'inside', 'outside', 'opened' or 'matches'.");
    }
    if (isWord("command")) {
      next();
      expectWord("matches");
      return { kind: "commandMatches", pattern: parsePatternRef(), position: token.position };
    }
    if (isWord("subject")) {
      next();
      expectWord("is");
      const who = expectOneOf(SUBJECTS, "A subject");
      return { kind: "subjectIs", subject: who.value, position: token.position };
    }
    if (isWord("channel")) {
      next();
      expectWord("is");
      const name = expectString("a channel name in quotes");
      return { kind: "channelIs", channel: name.value, position: token.position };
    }
    if (isWord("arg")) {
      next();
      const index = expectNumber("an argument index");
      expectWord("matches");
      return {
        kind: "argMatches",
        index: index.value,
        pattern: parsePatternRef(),
        position: token.position
      };
    }
    return fail2("Expected a condition.");
  }
  function parseAnd() {
    let left = parsePrimary();
    while (isWord("and")) {
      const position = next().position;
      left = { kind: "and", left, right: parsePrimary(), position };
    }
    return left;
  }
  function parseExpression() {
    let left = parseAnd();
    while (isWord("or")) {
      const position = next().position;
      left = { kind: "or", left, right: parseAnd(), position };
    }
    return left;
  }
  function parseProfile() {
    const start = expectWord("profile").position;
    const name = expectString("a profile name in quotes");
    expectPunct("{");
    const profile = { name: name.value, mode: "enforce", failMode: "closed", position: start };
    while (!isPunct("}")) {
      if (done()) fail2("The profile block was never closed.");
      if (eatWord("mode")) {
        profile.mode = expectOneOf(MODES, "A mode").value;
        continue;
      }
      if (eatWord("fail")) {
        profile.failMode = expectOneOf(FAIL_MODES, "A fail mode").value;
        continue;
      }
      fail2("Only 'mode' and 'fail' are allowed inside a profile.");
    }
    expectPunct("}");
    return profile;
  }
  function parseSet() {
    const start = expectWord("set").position;
    const name = expectIdent("a set name");
    expectPunct("=");
    expectPunct("[");
    const patterns = [];
    while (!isPunct("]")) {
      if (done()) fail2("The set was never closed.");
      const entry = expectString('a "glob" pattern');
      patterns.push(entry.value);
      if (!isPunct("]")) expectPunct(",");
    }
    expectPunct("]");
    return { name: name.value, patterns, position: start };
  }
  function parseRule(effect) {
    const position = peek().position;
    let condition;
    if (eatWord("when")) {
      condition = parseExpression();
    } else if (isWord("always")) {
      next();
      condition = { kind: "always", position };
    } else {
      fail2(`After '${effect}', expected 'when' or 'always'.`);
    }
    let reason = null;
    if (eatWord("reason")) reason = expectString("a reason in quotes").value;
    return { effect, condition, reason, position };
  }
  function parseCapability() {
    const start = expectWord("capability").position;
    const name = expectIdent("a capability name");
    expectPunct("{");
    const capability = {
      name: name.value,
      describe: null,
      rules: [],
      limit: null,
      audit: "on-deny",
      position: start
    };
    while (!isPunct("}")) {
      if (done()) fail2(`The capability '${capability.name}' was never closed.`);
      if (isWord("allow") || isWord("deny")) {
        capability.rules.push(parseRule(next().value));
        continue;
      }
      if (isWord("require")) {
        next();
        expectWord("approval");
        capability.rules.push(parseRule("approve"));
        continue;
      }
      if (eatWord("describe")) {
        capability.describe = expectString("a description in quotes").value;
        continue;
      }
      if (eatWord("limit")) {
        const count = expectNumber("a limit count");
        expectWord("per");
        const unit = expectOneOf(UNITS, "A limit unit");
        if (count.value <= 0) fail2("A limit must be greater than zero.", count);
        capability.limit = { count: count.value, unit: unit.value, position: count.position };
        continue;
      }
      if (eatWord("audit")) {
        if (eatWord("on")) {
          expectWord("deny");
          capability.audit = "on-deny";
          continue;
        }
        capability.audit = expectOneOf(AUDIT_MODES, "An audit mode").value;
        continue;
      }
      fail2(`Unknown setting inside capability '${capability.name}'.`);
    }
    expectPunct("}");
    return capability;
  }
  function parseBinding() {
    const start = expectWord("bind").position;
    const isTool = eatWord("tool");
    const subject = expectString(isTool ? "a tool name in quotes" : "a channel name in quotes");
    expectWord("to");
    const capability = expectIdent("a capability name");
    const fields = {};
    if (isPunct("{")) {
      next();
      while (!isPunct("}")) {
        if (done()) fail2("The binding block was never closed.");
        const field = expectIdent("a field name");
        expectPunct("=");
        if (eatWord("arg")) {
          const index = expectNumber("an argument index");
          fields[field.value] = { from: "arg", index: index.value };
        } else if (eatWord("field")) {
          const source = expectIdent("a field name");
          fields[field.value] = { from: "field", name: source.value };
        } else {
          fail2("Expected 'arg <n>' or 'field <name>'.");
        }
        if (!isPunct("}")) expectPunct(",");
      }
      expectPunct("}");
    }
    return {
      kind: isTool ? "tool" : "channel",
      subject: subject.value,
      capability: capability.value,
      fields,
      position: start
    };
  }
  function parseAuditBlock() {
    const start = expectWord("audit").position;
    expectPunct("{");
    const audit = {
      file: "sssf-audit.jsonl",
      chain: "sha256",
      retain: 5e3,
      redact: [],
      position: start
    };
    while (!isPunct("}")) {
      if (done()) fail2("The audit block was never closed.");
      if (eatWord("sink")) {
        expectWord("file");
        audit.file = expectString("a file name in quotes").value;
        continue;
      }
      if (eatWord("chain")) {
        const algorithm = expectIdent("a hash algorithm");
        if (algorithm.value !== "sha256" && algorithm.value !== "none") {
          fail2("Only 'sha256' and 'none' are supported for chain.", algorithm);
        }
        audit.chain = algorithm.value;
        continue;
      }
      if (eatWord("retain")) {
        const count = expectNumber("a record count");
        expectWord("records");
        audit.retain = count.value;
        continue;
      }
      if (eatWord("redact")) {
        expectPunct("[");
        while (!isPunct("]")) {
          if (done()) fail2("The redact list was never closed.");
          audit.redact.push(expectString("a field name in quotes").value);
          if (!isPunct("]")) expectPunct(",");
        }
        expectPunct("]");
        continue;
      }
      fail2("Unknown setting inside the audit block.");
    }
    expectPunct("}");
    return audit;
  }
  const ast = {
    format: null,
    profile: null,
    sets: [],
    capabilities: [],
    bindings: [],
    audit: null
  };
  if (!isWord("format")) {
    fail2("An sssF file must start with a format directive, e.g. 'format sssF 1'.");
  }
  next();
  const dialect = expectIdent("a format name");
  const version = expectNumber("a format version");
  ast.format = { name: dialect.value, version: version.value, position: dialect.position };
  while (!done()) {
    if (isWord("profile")) {
      const profile = parseProfile();
      if (ast.profile) fail2("Only one profile block is allowed.", { position: profile.position });
      ast.profile = profile;
      continue;
    }
    if (isWord("set")) {
      ast.sets.push(parseSet());
      continue;
    }
    if (isWord("capability")) {
      ast.capabilities.push(parseCapability());
      continue;
    }
    if (isWord("bind")) {
      ast.bindings.push(parseBinding());
      continue;
    }
    if (isWord("audit") && isPunct("{", 1)) {
      const audit = parseAuditBlock();
      if (ast.audit) fail2("Only one audit block is allowed.", { position: audit.position });
      ast.audit = audit;
      continue;
    }
    fail2("Expected profile, set, capability, bind or audit.");
  }
  return ast;
}
const SPECIAL = /[.+^${}()|[\]\\]/g;
function globToRegExp(pattern) {
  let out = "";
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "*") {
      const isDouble = pattern[index + 1] === "*";
      if (isDouble) {
        if (pattern[index + 2] === "/") {
          out += "(?:.*/)?";
          index += 3;
          continue;
        }
        out += ".*";
        index += 2;
        continue;
      }
      out += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      index += 1;
      continue;
    }
    out += char.replace(SPECIAL, "\\$&");
    index += 1;
  }
  return new RegExp(`^${out}$`, "i");
}
function compilePattern(pattern) {
  return {
    source: pattern,
    againstBasename: !pattern.includes("/"),
    regexp: globToRegExp(pattern)
  };
}
const normalizePath = (value) => String(value).replace(/\\/g, "/");
function matchesPattern(compiled, { relativePath, basename }) {
  const subject = compiled.againstBasename ? basename : relativePath;
  return subject !== null && compiled.regexp.test(subject);
}
const SUPPORTED_FORMAT = "sssF";
const SUPPORTED_VERSION = 1;
const UNIT_MS = { second: 1e3, minute: 6e4, hour: 36e5 };
class Diagnostics {
  constructor() {
    this.entries = [];
  }
  add(severity, message, position) {
    this.entries.push({ severity, message, line: position?.line ?? 0, column: position?.column ?? 0 });
  }
  error(message, position) {
    this.add("error", message, position);
  }
  warn(message, position) {
    this.add("warning", message, position);
  }
  get errors() {
    return this.entries.filter((entry) => entry.severity === "error");
  }
  get warnings() {
    return this.entries.filter((entry) => entry.severity === "warning");
  }
}
function resolvePattern(reference, sets, diagnostics) {
  if (reference.type === "set") {
    const found = sets.get(reference.name);
    if (!found) {
      diagnostics.error(`Unknown set '${reference.name}'.`, reference.position);
      return { kind: "glob", patterns: [], label: reference.name };
    }
    found.used = true;
    return { kind: "glob", patterns: found.compiled, label: reference.name };
  }
  if (reference.type === "regex") {
    return {
      kind: "regex",
      regexp: new RegExp(reference.pattern, reference.flags),
      label: `/${reference.pattern}/`
    };
  }
  return {
    kind: "glob",
    patterns: [compilePattern(reference.pattern)],
    label: reference.pattern
  };
}
function pathHits(resolved, context) {
  if (context.relativePath === null && context.basename === null) return false;
  if (resolved.kind === "regex") {
    return resolved.regexp.test(context.relativePath ?? context.rawPath ?? "");
  }
  return resolved.patterns.some((pattern) => matchesPattern(pattern, context));
}
function compileCondition(node, sets, diagnostics) {
  switch (node.kind) {
    case "always":
      return () => true;
    case "not": {
      const operand = compileCondition(node.operand, sets, diagnostics);
      return (context) => !operand(context);
    }
    case "and": {
      const left = compileCondition(node.left, sets, diagnostics);
      const right = compileCondition(node.right, sets, diagnostics);
      return (context) => left(context) && right(context);
    }
    case "or": {
      const left = compileCondition(node.left, sets, diagnostics);
      const right = compileCondition(node.right, sets, diagnostics);
      return (context) => left(context) || right(context);
    }
    case "pathInside":
      return (context) => context.insideProject === true;
    case "pathOpened":
      return (context) => context.openedFile === true;
    case "pathMatches": {
      const resolved = resolvePattern(node.pattern, sets, diagnostics);
      return (context) => pathHits(resolved, context);
    }
    case "commandMatches": {
      const resolved = resolvePattern(node.pattern, sets, diagnostics);
      return (context) => {
        if (typeof context.command !== "string" || context.command.length === 0) return false;
        if (resolved.kind === "regex") return resolved.regexp.test(context.command);
        return resolved.patterns.some((pattern) => pattern.regexp.test(context.command));
      };
    }
    case "subjectIs":
      return (context) => context.subject === node.subject;
    case "channelIs":
      return (context) => context.channel === node.channel;
    case "argMatches": {
      const resolved = resolvePattern(node.pattern, sets, diagnostics);
      return (context) => {
        const value = context.args?.[node.index];
        if (typeof value !== "string") return false;
        if (resolved.kind === "regex") return resolved.regexp.test(value);
        return resolved.patterns.some((pattern) => pattern.regexp.test(value));
      };
    }
    default:
      diagnostics.error(`Unsupported condition '${node.kind}'.`, node.position);
      return () => false;
  }
}
const isUnconditional = (node) => node.kind === "always";
function compileCapability(node, sets, diagnostics) {
  const rules = [];
  let terminatedAt = null;
  for (const rule of node.rules) {
    if (terminatedAt !== null && rule.effect !== "approve") {
      diagnostics.warn(
        `This rule can never be reached: line ${terminatedAt} already matches everything.`,
        rule.position
      );
    }
    if (isUnconditional(rule.condition) && rule.effect !== "approve" && terminatedAt === null) {
      terminatedAt = rule.position.line;
    }
    rules.push({
      effect: rule.effect,
      reason: rule.reason,
      line: rule.position.line,
      test: compileCondition(rule.condition, sets, diagnostics)
    });
  }
  if (rules.length === 0) {
    diagnostics.warn(
      `Capability '${node.name}' has no rules, so every call falls through to the profile's fail mode.`,
      node.position
    );
  }
  return {
    name: node.name,
    describe: node.describe,
    audit: node.audit,
    limit: node.limit ? { count: node.limit.count, windowMs: UNIT_MS[node.limit.unit], unit: node.limit.unit } : null,

    rules: rules.filter((rule) => rule.effect !== "approve"),
    approvalRules: rules.filter((rule) => rule.effect === "approve")
  };
}
function compile(source, { path = "sssF.include" } = {}) {
  const diagnostics = new Diagnostics();
  let ast;
  try {
    ast = parse(tokenize(source));
  } catch (error) {
    if (error instanceof SssfError) {
      diagnostics.error(error.message, error.position);
      return { program: null, diagnostics: diagnostics.entries };
    }
    throw error;
  }
  if (ast.format.name !== SUPPORTED_FORMAT) {
    diagnostics.error(
      `Unknown format '${ast.format.name}'; this build understands '${SUPPORTED_FORMAT}'.`,
      ast.format.position
    );
  }
  if (ast.format.version > SUPPORTED_VERSION) {
    diagnostics.error(
      `Format version ${ast.format.version} is newer than this build understands (${SUPPORTED_VERSION}).`,
      ast.format.position
    );
  }
  const sets =  new Map();
  for (const entry of ast.sets) {
    if (sets.has(entry.name)) {
      diagnostics.error(`Set '${entry.name}' is declared twice.`, entry.position);
      continue;
    }
    sets.set(entry.name, {
      name: entry.name,
      compiled: entry.patterns.map(compilePattern),
      position: entry.position,
      used: false
    });
  }
  const capabilities =  new Map();
  for (const entry of ast.capabilities) {
    if (capabilities.has(entry.name)) {
      diagnostics.error(`Capability '${entry.name}' is declared twice.`, entry.position);
      continue;
    }
    capabilities.set(entry.name, compileCapability(entry, sets, diagnostics));
  }
  if (!capabilities.has("ipc.default")) {
    diagnostics.warn(
      "No 'ipc.default' capability is declared, so any channel without a bind falls through to the profile's fail mode.",
      ast.profile?.position
    );
  }
  for (const entry of sets.values()) {
    if (!entry.used) diagnostics.warn(`Set '${entry.name}' is never used.`, entry.position);
  }
  const channels =  new Map();
  const tools =  new Map();
  for (const binding of ast.bindings) {
    if (!capabilities.has(binding.capability)) {
      diagnostics.error(
        `Binding for '${binding.subject}' names an unknown capability '${binding.capability}'.`,
        binding.position
      );
      continue;
    }
    const target = binding.kind === "tool" ? tools : channels;
    if (target.has(binding.subject)) {
      diagnostics.error(`'${binding.subject}' is bound twice.`, binding.position);
      continue;
    }
    target.set(binding.subject, { capability: binding.capability, fields: binding.fields });
  }
  if (diagnostics.errors.length > 0) {
    return { program: null, diagnostics: diagnostics.entries };
  }
  const profile = ast.profile ?? { name: "default", mode: "enforce", failMode: "closed" };
  const program = {
    source: {
      path,
      hash: node_crypto.createHash("sha256").update(source).digest("hex").slice(0, 16),
      compiledAt: Date.now()
    },
    profile: { name: profile.name, mode: profile.mode, failMode: profile.failMode },
    capabilities,
    channels,
    tools,
    audit: ast.audit ?? {
      file: "sssf-audit.jsonl",
      chain: "sha256",
      retain: 5e3,
      redact: []
    },
    stats: {
      sets: sets.size,
      capabilities: capabilities.size,
      channelBindings: channels.size,
      toolBindings: tools.size,
      rules: [...capabilities.values()].reduce(
        (total, capability) => total + capability.rules.length + capability.approvalRules.length,
        0
      )
    }
  };
  return { program, diagnostics: diagnostics.entries };
}
const GENESIS = "0".repeat(64);
class AuditLog {
  constructor({ directory, config: config2 }) {
    this.path = node_path.join(directory, node_path.basename(config2.file || "sssf-audit.jsonl"));
    this.chain = config2.chain ?? "sha256";
    this.retain = config2.retain ?? 5e3;
    this.redact = new Set(config2.redact ?? []);
    this.previousHash = null;
    this.sequence = 0;
    this.lines = 0;
    this.pending = Promise.resolve();
    this.ready = null;

    this.buffer = [];
    this.flushTimer = null;
  }

  async init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await promises.mkdir(node_path.dirname(this.path), { recursive: true });
      try {
        const existing = await promises.readFile(this.path, "utf8");
        const lines = existing.split("\n").filter(Boolean);
        this.lines = lines.length;
        const last = lines[lines.length - 1];
        if (last) {
          const parsed = JSON.parse(last);
          this.previousHash = parsed.h ?? GENESIS;
          this.sequence = (parsed.seq ?? 0) + 1;
        }
      } catch {
        this.previousHash = null;
      }
      if (this.previousHash === null) this.previousHash = GENESIS;
    })();
    return this.ready;
  }
  hashOf(record2) {
    if (this.chain === "none") return null;
    return node_crypto.createHash("sha256").update(`${record2.p}
${JSON.stringify(record2)}`).digest("hex");
  }
  redactValues(values) {
    if (!values) return void 0;
    const out = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === void 0) continue;
      if (this.redact.has(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = typeof value === "string" && value.length > 300 ? `${value.slice(0, 300)}…` : value;
    }
    return Object.keys(out).length > 0 ? out : void 0;
  }

  append(entry) {
    this.pending = this.pending.then(() => this.write(entry)).catch((error) => {
      console.error("[sssF] Could not write the audit record:", error.message);
    });
    return this.pending;
  }
  async write(entry) {
    await this.init();
    const record2 = {
      v: 1,
      seq: this.sequence,
      at: ( new Date()).toISOString(),
      subject: entry.subject,
      capability: entry.capability,
      decision: entry.decision,
      enforced: entry.enforced,
      mode: entry.mode,
      reason: entry.reason ?? null,
      rule: entry.rule ?? null,
      p: this.previousHash
    };
    if (entry.channel) record2.channel = entry.channel;
    if (entry.tool) record2.tool = entry.tool;
    if (entry.target) record2.target = entry.target;
    if (entry.limited) record2.limited = true;
    if (entry.requiresApproval) record2.approval = true;
    if (entry.policyHash) record2.policy = entry.policyHash;
    const values = this.redactValues(entry.values);
    if (values) record2.values = values;
    const hash = this.hashOf(record2);
    const line = JSON.stringify(hash === null ? record2 : { ...record2, h: hash });
    this.previousHash = hash ?? GENESIS;
    this.sequence += 1;
    this.lines += 1;

    this.buffer.push(line);
    this.scheduleFlush();
    if (this.retain > 0 && this.lines > this.retain * 1.25) {
      await this.flush();
      await this.trim();
    }
  }
  scheduleFlush() {
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 250);
    this.flushTimer.unref?.();
  }
  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    const chunk = `${this.buffer.join("\n")}\n`;
    this.buffer.length = 0;
    try {
      await promises.appendFile(this.path, chunk, "utf8");
    } catch (error) {
      console.error("[sssF] Could not write the audit records:", error.message);
    }
  }
  async trim() {
    const existing = await promises.readFile(this.path, "utf8");
    const lines = existing.split("\n").filter(Boolean);
    const kept = lines.slice(-this.retain);
    const marker = {
      v: 1,
      seq: this.sequence,
      at: ( new Date()).toISOString(),
      subject: "system",
      capability: "audit.trim",
      decision: "allow",
      enforced: false,
      mode: "system",
      reason: `Trimmed to the most recent ${this.retain} records; ${lines.length - kept.length} dropped`,
      rule: null,
      p: GENESIS
    };
    const markerHash = this.hashOf(marker);
    await promises.writeFile(
      this.path,
      `${[JSON.stringify(markerHash === null ? marker : { ...marker, h: markerHash }), ...kept].join("\n")}
`,
      "utf8"
    );
    this.lines = kept.length + 1;
    this.sequence += 1;
    const last = kept[kept.length - 1];
    this.previousHash = last ? JSON.parse(last).h ?? GENESIS : markerHash ?? GENESIS;
  }

  async tail(count = 100) {
    await this.flush();
    try {
      const existing = await promises.readFile(this.path, "utf8");
      return existing.split("\n").filter(Boolean).slice(-count).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { malformed: true, line };
        }
      }).reverse();
    } catch {
      return [];
    }
  }

  async verify() {
    if (this.chain === "none") {
      return { ok: true, chained: false, records: 0, brokenAt: null };
    }
    await this.flush();
    let text;
    try {
      text = await promises.readFile(this.path, "utf8");
    } catch {
      return { ok: true, chained: true, records: 0, brokenAt: null };
    }
    const lines = text.split("\n").filter(Boolean);
    let expected = GENESIS;
    let resync = false;
    for (let index = 0; index < lines.length; index += 1) {
      let parsed;
      try {
        parsed = JSON.parse(lines[index]);
      } catch {
        return { ok: false, chained: true, records: lines.length, brokenAt: index + 1, reason: "Malformed record" };
      }
      const { h, ...body } = parsed;
      if (body.capability === "audit.trim") {
        expected = GENESIS;
        resync = false;
      } else if (resync) {
        expected = body.p;
        resync = false;
      }
      if (body.p !== expected) {
        return {
          ok: false,
          chained: true,
          records: lines.length,
          brokenAt: index + 1,
          reason: "The record does not follow the one before it"
        };
      }
      const recomputed = node_crypto.createHash("sha256").update(`${body.p}
${JSON.stringify(body)}`).digest("hex");
      if (recomputed !== h) {
        return {
          ok: false,
          chained: true,
          records: lines.length,
          brokenAt: index + 1,
          reason: "The record was altered after it was written"
        };
      }
      expected = h;
      if (body.capability === "audit.trim") resync = true;
    }
    return { ok: true, chained: true, records: lines.length, brokenAt: null };
  }
}
const windows =  new Map();
function resetLimits() {
  windows.clear();
}

function windowFor(capability) {
  let ring = windows.get(capability.name);
  if (!ring) {
    ring = { stamps: new Float64Array(capability.limit.count), head: 0, size: 0 };
    windows.set(capability.name, ring);
  }
  return ring;
}
function withinLimit(capability, now) {
  if (!capability.limit) return true;
  const ring = windowFor(capability);
  const cutoff = now - capability.limit.windowMs;
  const capacity = ring.stamps.length;

  while (ring.size > 0 && ring.stamps[ring.head] <= cutoff) {
    ring.head = (ring.head + 1) % capacity;
    ring.size -= 1;
  }
  return ring.size < capability.limit.count;
}
function consumeLimit(capability, now) {
  if (!capability.limit) return;
  const ring = windowFor(capability);
  const capacity = ring.stamps.length;
  if (ring.size === capacity) {

    ring.stamps[ring.head] = now;
    ring.head = (ring.head + 1) % capacity;
    return;
  }
  ring.stamps[(ring.head + ring.size) % capacity] = now;
  ring.size += 1;
}
function extractFields(fields, { args, toolArgs }) {
  const out = {};
  for (const [name, source] of Object.entries(fields ?? {})) {
    if (source.from === "arg") {
      out[name] = args?.[source.index];
    } else if (source.from === "field") {
      out[name] = toolArgs?.[source.name];
    }
  }
  return out;
}
function buildContext({
  subject = "user",
  channel = null,
  tool = null,
  projectRoot: projectRoot2 = null,
  projectRoots = null,
  openedFiles = null,
  values = {},
  args = []
}) {
  const rawPath = typeof values.path === "string" && values.path.length > 0 ? values.path : null;

  const root =
    typeof projectRoot2 === "string" && projectRoot2.length > 0
      ? projectRoot2
      : typeof values.root === "string" && values.root.length > 0
        ? values.root
        : null;

  const roots =
    Array.isArray(projectRoots) && projectRoots.length > 0
      ? projectRoots
      : root
        ? [root]
        : [];

  let relativePath = null;
  let insideProject = null;
  let basename = null;
  let matchedRoot = null;

  const isUrl = rawPath !== null && /^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath);
  if (rawPath !== null && !isUrl) {
    basename = node_path.basename(rawPath);
    if (roots.length > 0) {

      const absolute = node_path.isAbsolute(rawPath) ? rawPath : node_path.join(roots[0], rawPath);
      insideProject = false;
      relativePath = normalizePath(absolute);
      for (const candidate of roots) {
        const rel = node_path.relative(candidate, absolute);
        if (rel === "" || (!rel.startsWith("..") && !node_path.isAbsolute(rel))) {
          insideProject = true;
          matchedRoot = candidate;
          relativePath = normalizePath(rel);
          break;
        }
      }
      basename = node_path.basename(absolute);
    } else {
      relativePath = normalizePath(rawPath);
    }
  }

  let openedFile = false;
  if (rawPath !== null && !isUrl && openedFiles && openedFiles.size > 0) {
    openedFile = openedFiles.has(normalizePath(node_path.resolve(rawPath)).toLowerCase());
  }

  return {
    subject,
    channel,
    tool,
    projectRoot: matchedRoot ?? root,
    rawPath,
    relativePath,
    basename,
    insideProject,
    openedFile,
    command: typeof values.command === "string" ? values.command : null,
    args
  };
}
function decide(program, capabilityName, context, { now = Date.now() } = {}) {
  const capability = program.capabilities.get(capabilityName);
  if (!capability) {
    const decision2 = program.profile.failMode === "open" ? "allow" : "deny";
    return finish(program, {
      capability: capabilityName,
      decision: decision2,
      reason: `No capability '${capabilityName}' is declared`,
      rule: null,
      requiresApproval: false,
      limited: false
    });
  }
  if (!withinLimit(capability, now)) {
    return finish(program, {
      capability: capabilityName,
      decision: "deny",
      reason: `Rate limit reached: ${capability.limit.count} per ${capability.limit.unit}`,
      rule: null,
      requiresApproval: false,
      limited: true
    });
  }
  let decision = null;
  let reason = null;
  let rule = null;
  for (const candidate of capability.rules) {
    if (!candidate.test(context)) continue;
    decision = candidate.effect;
    reason = candidate.reason;
    rule = candidate.line;
    break;
  }
  if (decision === null) {
    decision = program.profile.failMode === "open" ? "allow" : "deny";
    reason = `No rule matched; fail ${program.profile.failMode}`;
  }
  const requiresApproval = decision === "allow" && capability.approvalRules.some((candidate) => candidate.test(context));
  if (decision === "allow") consumeLimit(capability, now);
  return finish(program, {
    capability: capabilityName,
    decision,
    reason,
    rule,
    requiresApproval,
    limited: false
  });
}
function finish(program, verdict) {
  const capability = program.capabilities.get(verdict.capability);
  const mode = program.profile.mode;
  const enforced = verdict.decision === "deny" && mode === "enforce";
  const auditMode = capability?.audit ?? "on-deny";
  const shouldAudit = auditMode === "always" || auditMode === "on-deny" && verdict.decision === "deny" || mode === "audit" && verdict.decision === "deny";
  return {
    ...verdict,
    describe: capability?.describe ?? null,
    mode,
    enforced,
    shouldAudit: auditMode === "never" ? false : shouldAudit
  };
}
const UNBOUND = { capability: "ipc.default", fields: {} };
function bindingFor(program, { channel, tool }) {
  if (tool !== void 0 && tool !== null) return program.tools.get(tool) ?? UNBOUND;
  if (channel !== void 0 && channel !== null) return program.channels.get(channel) ?? UNBOUND;
  return UNBOUND;
}
const policyCandidates = () => [
  process.resourcesPath && node_path.join(process.resourcesPath, "sssF.include"),
  node_path.join(__dirname, "../../sssF.include"),
  node_path.join(electron.app.getAppPath(), "sssF.include")
].filter(Boolean);

const BOOTSTRAP_SOURCE = `
format sssF 1
profile "bootstrap" {
  mode enforce
  fail closed
}
capability ipc.default {
  describe "Security policy failed to load — operations are blocked until it is fixed"
  deny always reason "No valid security policy is loaded"
  audit always
}
`;
const ROOT_SOURCES =  new Set(["dialog:openFolder", "workspace:openRecent"]);

const WORKFLOW_SOURCES =  new Set(["workflow:open", "workflow:create", "workflow:setFolders"]);
const state = {
  program: null,
  degraded: false,
  policyPath: null,
  diagnostics: [],
  lastError: null,
  projectRoot: null,

  openedFiles:  new Set(),

  projectRoots: [],
  audit: null,
  counters: { allowed: 0, denied: 0, blocked: 0, approvals: 0 },
  watcher: null,
  installed: false
};
const broadcast = (channel, payload) => {
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
};
function report(diagnostics, policyPath) {
  for (const entry of diagnostics) {
    const where = `${policyPath}:${entry.line}:${entry.column}`;
    const line = `[sssF] ${entry.severity}: ${entry.message} (${where})`;
    if (entry.severity === "error") console.error(line);
    else console.warn(line);
  }
}
async function readPolicy() {
  for (const candidate of policyCandidates()) {
    try {
      return { source: await promises.readFile(candidate, "utf8"), path: candidate };
    } catch {
    }
  }
  return null;
}
async function load({ initial = false } = {}) {
  const found = await readPolicy();
  if (!found) {
    if (state.program) return false;
    const bootstrap = compile(BOOTSTRAP_SOURCE, { path: "<bootstrap>" });
    state.program = bootstrap.program;
    state.degraded = true;
    state.lastError = "No sssF.include was found; all operations are blocked until a policy is in place.";
    state.policyPath = null;
    console.error(`[sssF] ${state.lastError}`);
    return false;
  }
  const { program, diagnostics } = compile(found.source, { path: found.path });
  report(diagnostics, found.path);
  state.policyPath = found.path;
  state.diagnostics = diagnostics;
  if (!program) {
    const summary = diagnostics.find((entry) => entry.severity === "error");
    state.lastError = `${summary?.message ?? "Compilation failed"} (line ${summary?.line ?? 0})`;
    if (state.program && !state.degraded) {
      console.error(`[sssF] ${state.lastError} — keeping the previously compiled policy.`);
      return false;
    }
    const bootstrap = compile(BOOTSTRAP_SOURCE, { path: "<bootstrap>" });
    state.program = bootstrap.program;
    state.degraded = true;
    console.error(`[sssF] ${state.lastError} — blocking all operations until the policy is fixed.`);
    return false;
  }
  state.program = program;
  state.degraded = false;
  state.lastError = null;
  resetLimits();
  state.audit = new AuditLog({ directory: electron.app.getPath("userData"), config: program.audit });
  await state.audit.init();
  const verb = initial ? "Loaded" : "Reloaded";
  console.log(
    `[sssF] ${verb} ${program.profile.name} (${program.profile.mode}/${program.profile.failMode}) — ${program.stats.capabilities} capabilities, ${program.stats.rules} rules, ${program.stats.channelBindings} channel and ${program.stats.toolBindings} tool bindings [${program.source.hash}]`
  );
  return true;
}
function startWatching() {
  if (!state.policyPath || state.watcher) return;
  try {
    let timer = null;
    state.watcher = node_fs.watch(state.policyPath, () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await load();
        broadcast("sssf:changed", status());
      }, 150);
    });
    state.watcher.on("error", (error) => {
      console.warn("[sssF] The policy watcher stopped:", error.message);
      state.watcher = null;
    });
  } catch (error) {
    console.warn("[sssF] The policy could not be watched:", error.message);
  }
}
function record(verdict, detail) {
  if (verdict.decision === "deny") {
    state.counters.denied += 1;
    if (verdict.enforced) state.counters.blocked += 1;
  } else {
    state.counters.allowed += 1;
    if (verdict.requiresApproval) state.counters.approvals += 1;
  }
  if (!verdict.shouldAudit || !state.audit) return;
  state.audit.append({
    ...verdict,
    ...detail,
    policyHash: state.program?.source.hash ?? null
  });
}
function check({ channel = null, tool = null, subject = "user", args = [], toolArgs = null }) {
  if (!state.program) return { decision: "allow", enforced: false, capability: null, reason: null };
  const binding = bindingFor(state.program, { channel, tool });
  const values = extractFields(binding.fields, { args, toolArgs });

  const context = buildContext({
    subject,
    channel,
    tool,
    projectRoot: state.projectRoot,
    projectRoots: state.projectRoots,
    openedFiles: state.openedFiles,
    values,
    args
  });
  const verdict = decide(state.program, binding.capability, context);
  record(verdict, {
    channel,
    tool,
    subject,
    target: context.relativePath ?? context.rawPath ?? null,
    values
  });
  return verdict;
}
class PolicyDenied extends Error {
  constructor(verdict) {
    const reason = verdict.reason ? ` — ${verdict.reason}` : "";
    const where = verdict.rule ? ` [sssF.include:${verdict.rule}]` : "";
    super(`sssF denied ${verdict.capability}${reason}${where}`);
    this.name = "PolicyDenied";
    this.verdict = verdict;
  }
}
function install() {
  if (state.installed) return;
  state.installed = true;
  const original = electron.ipcMain.handle.bind(electron.ipcMain);
  electron.ipcMain.handle = (channel, listener) => original(channel, async (event, ...args) => {
    if (channel.startsWith("sssf:")) return listener(event, ...args);
    const verdict = check({ channel, args, subject: "user" });
    if (verdict.decision === "deny" && verdict.enforced) throw new PolicyDenied(verdict);
    const result = await listener(event, ...args);
    if (ROOT_SOURCES.has(channel) && result?.path) {
      state.projectRoot = result.path;

      state.projectRoots = [];
    }
    if (WORKFLOW_SOURCES.has(channel) && Array.isArray(result?.folders) && result.folders.length > 0) {
      const folders = result.folders
        .map((folder) => folder?.path)
        .filter((path) => typeof path === "string" && path.length > 0);
      if (folders.length > 0) {
        state.projectRoots = folders;
        state.projectRoot = folders[0];
      }
    }
    if ((channel === "dialog:openFile" || channel === "workspace:openRecentFile") && result?.path) {

      state.openedFiles.add(normalizePath(node_path.resolve(result.path)).toLowerCase());
    }
    return result;
  });
}
function status() {
  const program = state.program;
  return {
    ok: !state.degraded && state.diagnostics.every((entry) => entry.severity !== "error"),
    degraded: state.degraded,
    policyPath: state.policyPath,
    policyHash: program?.source.hash ?? null,
    compiledAt: program?.source.compiledAt ?? null,
    profile: program?.profile.name ?? null,
    mode: program?.profile.mode ?? null,
    failMode: program?.profile.failMode ?? null,
    stats: program?.stats ?? null,
    diagnostics: state.diagnostics,
    lastError: state.lastError,
    projectRoot: state.projectRoot,
    counters: { ...state.counters },
    capabilities: program ? [...program.capabilities.values()].map((capability) => ({
      name: capability.name,
      describe: capability.describe,
      rules: capability.rules.length,
      limit: capability.limit ? `${capability.limit.count}/${capability.limit.unit}` : null,
      audit: capability.audit
    })) : []
  };
}
async function reload() {
  await load();
  broadcast("sssf:changed", status());
  return status();
}

function registerSssfHandlers() {
  electron.ipcMain.handle("sssf:status", () => ({ ok: true, status: status() }));

  electron.ipcMain.handle("sssf:tail", async (_event, count = 200) => {
    if (!state.audit) return { ok: true, records: [] };
    const wanted = Math.min(Math.max(Number(count) || 200, 1), 2000);
    return { ok: true, records: await state.audit.tail(wanted) };
  });

  electron.ipcMain.handle("sssf:verify", async () => {
    if (!state.audit) return { ok: true, result: { ok: true, chained: false, records: 0, brokenAt: null } };
    return { ok: true, result: await state.audit.verify() };
  });

  electron.ipcMain.handle("sssf:reload", async () => ({ ok: true, status: await reload() }));
}
async function boot() {
  install();
  await load({ initial: true });
  startWatching();
  return status();
}
function dispose() {
  state.watcher?.close();
  state.watcher = null;
}
