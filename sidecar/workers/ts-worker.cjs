'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parentPort } = require('node:worker_threads');
const ts = require('typescript');

const IGNORED = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage']);
const SOURCE_EXTENSIONS = /\.(?:m|c)?[jt]sx?$/;
const MAX_PROJECT_FILES = 3000;

const norm = (p) => String(p).split(path.sep).join('/');

const overlay = new Map();
const versions = new Map();
const bumpVersion = (file) => versions.set(file, (versions.get(file) ?? 0) + 1);

let service = null;
let projectRoot = null;
let projectFiles = [];

const COMPILER_OPTIONS = {
  allowJs: true,

  checkJs: true,
  strict: false,
  noImplicitAny: false,
  jsx: ts.JsxEmit.ReactJSX,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowNonTsExtensions: true,
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  noEmit: true,
};

const COMPLETION_OPTIONS = {
  includeCompletionsForModuleExports: true,
  includeCompletionsWithInsertText: true,
  includeCompletionsWithSnippetText: true,
  includeAutomaticOptionalChainCompletions: true,
  quotePreference: 'single',
};

const FORMAT_OPTIONS = {
  indentSize: 2,
  tabSize: 2,
  convertTabsToSpaces: true,
  newLineCharacter: '\n',
  insertSpaceAfterCommaDelimiter: true,
  insertSpaceAfterKeywordsInControlFlowStatements: true,
  semicolons: ts.SemicolonPreference.Remove,
};

function changesToFiles(changes) {
  const files = [];
  for (const change of changes ?? []) {
    if (change.isNewFile) continue;
    files.push({
      file: change.fileName,
      edits: change.textChanges.map((tc) => ({
        start: tc.span.start,
        length: tc.span.length,
        newText: tc.newText,
      })),
    });
  }
  return files;
}

function collectFiles(dir, out) {
  if (out.length >= MAX_PROJECT_FILES) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_PROJECT_FILES) return;
    if (entry.isDirectory()) {
      if (!IGNORED.has(entry.name)) collectFiles(path.join(dir, entry.name), out);
    } else if (SOURCE_EXTENSIONS.test(entry.name)) {
      out.push(norm(path.join(dir, entry.name)));
    }
  }
}

const snapshots = new Map();

function snapshotFor(file) {
  const version = versions.get(file) ?? 0;
  const cached = snapshots.get(file);
  if (cached && cached.version === version) return cached.snapshot;

  const edited = overlay.get(file);
  let snapshot;
  if (edited !== undefined) {
    snapshot = ts.ScriptSnapshot.fromString(edited);
  } else {
    try {
      snapshot = ts.ScriptSnapshot.fromString(fs.readFileSync(file, 'utf8'));
    } catch {
      snapshots.delete(file);
      return undefined;
    }
  }
  snapshots.set(file, { version, snapshot });
  return snapshot;
}

function resolveCompilerOptions(root) {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json') ||
    ts.findConfigFile(root, ts.sys.fileExists, 'jsconfig.json');
  if (!configPath) return { options: { ...COMPILER_OPTIONS }, configPath: null };
  try {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) return { options: { ...COMPILER_OPTIONS }, configPath: null };
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
    const options = {
      ...COMPILER_OPTIONS,
      ...parsed.options,
      allowNonTsExtensions: true,
      noEmit: true,
      skipLibCheck: true,
    };
    return { options, configPath };
  } catch {
    return { options: { ...COMPILER_OPTIONS }, configPath: null };
  }
}

let compilerOptions = { ...COMPILER_OPTIONS };

function createService(rootPath) {
  const root = norm(rootPath);
  projectRoot = root;
  projectFiles = [];
  snapshots.clear();
  collectFiles(root, projectFiles);
  compilerOptions = resolveCompilerOptions(root).options;

  const host = {
    getScriptFileNames: () => [...new Set([...projectFiles, ...overlay.keys()])],
    getScriptVersion: (file) => String(versions.get(file) ?? 0),
    getScriptSnapshot: snapshotFor,
    getCurrentDirectory: () => root,
    getCompilationSettings: () => compilerOptions,

    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function ensureService(root) {
  if (!root) return null;
  if (!service || projectRoot !== root) service = createService(root);
  return service;
}

const displayPartsToString = (parts) => ts.displayPartsToString(parts ?? []);

const severityOf = (category) =>
  category === ts.DiagnosticCategory.Error
    ? 'error'
    : category === ts.DiagnosticCategory.Warning
      ? 'warning'
      : 'info';

const OPS = {
  sync(root, filePath, content) {
    const file = norm(filePath);
    if (!ensureService(norm(root))) return { ok: false };
    if (overlay.get(file) === content) return { ok: true };
    overlay.set(file, content);
    bumpVersion(file);
    if (!projectFiles.includes(file)) projectFiles.push(file);
    return { ok: true };
  },

  close(filePath) {
    const file = norm(filePath);
    overlay.delete(file);
    bumpVersion(file);
    return { ok: true };
  },

  navigationTree(root, filePath) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return { tree: null };
    let tree;
    try {
      tree = languageService.getNavigationTree(file);
    } catch (error) {
      return { tree: null, error: error.message };
    }
    const convert = (node) => ({
      name: node.text,
      kind: node.kind,
      kindModifiers: node.kindModifiers || '',
      offset: (node.nameSpan || (node.spans && node.spans[0]) || { start: 0 }).start,
      children: (node.childItems || []).map(convert),
    });
    return { tree: tree ? convert(tree) : null };
  },

  navigateTo(root, query) {
    const languageService = ensureService(norm(root));
    if (!languageService || !query) return { items: [] };
    let items;
    try {
      items = languageService.getNavigateToItems(query, 128, undefined, true);
    } catch (error) {
      return { items: [], error: error.message };
    }
    const program = languageService.getProgram();
    const out = (items || []).map((item) => {
      let line = 0;
      const sourceFile = program && program.getSourceFile(item.fileName);
      if (sourceFile) {
        try {
          line = sourceFile.getLineAndCharacterOfPosition(item.textSpan.start).line;
        } catch {
          line = 0;
        }
      }
      return {
        name: item.name,
        kind: item.kind,
        file: item.fileName,
        line,
        container: item.containerName || '',
      };
    });
    return { items: out };
  },

  completions(root, filePath, position) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return { entries: [] };
    let info;
    try {
      info = languageService.getCompletionsAtPosition(file, position, COMPLETION_OPTIONS);
    } catch (error) {
      return { entries: [], error: error.message };
    }
    if (!info) return { entries: [] };
    return {
      isMemberCompletion: Boolean(info.isMemberCompletion),
      optionalReplacementSpan: info.optionalReplacementSpan ?? null,
      entries: info.entries.slice(0, 200).map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        kindModifiers: entry.kindModifiers ?? '',
        sortText: entry.sortText,
        insertText: entry.insertText ?? null,
        isSnippet: Boolean(entry.isSnippet),
        replacementSpan: entry.replacementSpan ?? null,

        source: entry.source ?? null,
        data: entry.data ?? null,
        hasAction: Boolean(entry.hasAction),
        labelDetails: entry.labelDetails ?? null,
      })),
    };
  },

  details(root, filePath, position, name, source, data) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return null;
    let details;
    try {
      details = languageService.getCompletionEntryDetails(
        file,
        position,
        name,
        { semicolons: ts.SemicolonPreference.Remove },
        source ?? undefined,
        COMPLETION_OPTIONS,

        data ?? undefined,
      );
    } catch {
      return null;
    }
    if (!details) return null;
    const importEdits = [];
    for (const action of details.codeActions ?? []) {
      for (const change of action.changes ?? []) {
        if (change.fileName !== file) continue;
        for (const textChange of change.textChanges) {
          importEdits.push({ span: textChange.span, newText: textChange.newText });
        }
      }
    }
    return {
      signature: displayPartsToString(details.displayParts),
      documentation: displayPartsToString(details.documentation),
      tags: (details.tags ?? []).map((tag) => ({
        name: tag.name,
        text: displayPartsToString(tag.text),
      })),
      importEdits,
      importDescription: details.codeActions?.[0]?.description ?? null,
    };
  },

  diagnostics(root, filePath) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return { diagnostics: [] };
    let raw;
    try {
      const syntactic = languageService.getSyntacticDiagnostics(file);
      raw = syntactic.length > 0 ? syntactic : languageService.getSemanticDiagnostics(file);
    } catch (error) {
      return { diagnostics: [], error: error.message };
    }
    const diagnostics = raw
      .filter((entry) => typeof entry.start === 'number')
      .slice(0, 500)
      .map((entry) => ({
        from: entry.start,
        to: entry.start + Math.max(1, entry.length ?? 1),
        severity: severityOf(entry.category),
        message: ts.flattenDiagnosticMessageText(entry.messageText, ' '),
        code: entry.code,
      }));
    return { diagnostics };
  },

  projectDiagnostics(root) {
    const languageService = ensureService(norm(root));
    if (!languageService) return { counts: {} };
    const rootPrefix = norm(root);
    const counts = {};
    const problems = [];
    let scanned = 0;
    try {
      for (const file of languageService.getProgram()?.getSourceFiles() ?? []) {
        if (scanned >= MAX_PROJECT_FILES) break;
        const name = file.fileName;
        if (name.endsWith('.d.ts') || !name.startsWith(rootPrefix)) continue;
        scanned += 1;
        const syntactic = languageService.getSyntacticDiagnostics(name);
        const list = syntactic.length > 0 ? syntactic : languageService.getSemanticDiagnostics(name);
        if (list.length === 0) continue;
        let errors = 0;
        let warnings = 0;
        for (const entry of list) {
          if (entry.category === ts.DiagnosticCategory.Error) errors += 1;
          else if (entry.category === ts.DiagnosticCategory.Warning) warnings += 1;
        }
        if (errors || warnings) counts[name] = { errors, warnings };
        for (const entry of list) {
          if (entry.category !== ts.DiagnosticCategory.Error && entry.category !== ts.DiagnosticCategory.Warning) continue;
          if (problems.length >= 2000) break;
          const start = entry.start ?? 0;
          const pos = entry.file ? entry.file.getLineAndCharacterOfPosition(start) : { line: 0, character: 0 };
          problems.push({
            file: name,
            line: pos.line + 1,
            column: pos.character + 1,
            severity: entry.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
            message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
            code: entry.code,
          });
        }
      }
    } catch (error) {
      return { counts, problems, error: error.message };
    }
    return { counts, problems, scanned };
  },

  quickInfo(root, filePath, position) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return null;
    try {
      const info = languageService.getQuickInfoAtPosition(file, position);
      if (!info) return null;
      return {
        signature: displayPartsToString(info.displayParts),
        documentation: displayPartsToString(info.documentation),
      };
    } catch {
      return null;
    }
  },

  definition(root, filePath, position) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return { locations: [] };
    try {
      const info = languageService.getDefinitionAndBoundSpan(file, position);
      if (!info || !info.definitions) return { locations: [] };
      return {
        span: info.textSpan ? { start: info.textSpan.start, length: info.textSpan.length } : null,
        locations: info.definitions.map((entry) => ({
          file: entry.fileName,
          start: entry.textSpan.start,
          length: entry.textSpan.length,
        })),
      };
    } catch (error) {
      return { locations: [], error: error.message };
    }
  },

  references(root, filePath, position) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return { locations: [] };
    try {
      const found = languageService.getReferencesAtPosition(file, position);
      if (!found) return { locations: [] };
      return {
        locations: found.slice(0, 2000).map((entry) => ({
          file: entry.fileName,
          start: entry.textSpan.start,
          length: entry.textSpan.length,
          write: Boolean(entry.isWriteAccess),
        })),
      };
    } catch (error) {
      return { locations: [], error: error.message };
    }
  },

  securityScan(root) {
    const ls = ensureService(norm(root));
    if (!ls) return { findings: [] };
    const program = ls.getProgram();
    if (!program) return { findings: [] };
    const checker = program.getTypeChecker();

    const SOURCE_RE = /\breq\.(?:query|params|body|headers|cookies)\b|\blocation\.(?:search|hash)\b|\bdocument\.(?:referrer|URL|documentURI)\b|\bnew\s+URLSearchParams\b|\.searchParams\b|searchParams\.get\s*\(|\bevent\.data\b|\bprocess\.argv\b|\bwindow\.name\b/;
    const SANITISER_RE = /\b(?:sanitiz|sanitis|escape|encodeURI|encodeURIComponent|DOMPurify|purify|htmlspecialchars|escapeHtml|validator|isURL|allowlist|whitelist|Number|parseInt|parseFloat)/i;
    const AUTH_MARKER = /req\.(?:user|session|auth|userId|currentUser)\b|authenticat|requireAuth|requireLogin|isAuthenticated|verifyToken|verifyJwt|jwt\.verify|passport|authMiddleware|ensureAuth|checkAuth|authoriz|getSession|headers\.authorization|headers\[["']authorization|bearer|withAuth|\bprotect\b|\bguard\b/i;
    const SKIP_AUTH_PATH = /login|signin|sign-in|register|signup|sign-up|forgot|reset|recover|health|ping|status|metrics|public|docs|swagger|well-known|refresh|logout|csrf|captcha/i;
    const READS_INPUT = /req\.(?:params|query|body)\b/;

    const findings = [];
    const seen = new Set();
    const MAX_FINDINGS = 400;
    const osPath = (f) => String(f).split('/').join(path.sep);

    const push = (rule, sinkNode, sinkSf, srcNode, srcSf) => {
      if (findings.length >= MAX_FINDINGS) return;
      const p = sinkNode.getStart();
      const key = `${rule.ruleId}:${sinkSf.fileName}:${p}`;
      if (seen.has(key)) return;
      seen.add(key);
      const lc = sinkSf.getLineAndCharacterOfPosition(p);
      const entry = {
        ruleId: rule.ruleId,
        cwe: rule.cwe,
        severity: rule.severity || 'warning',
        message: rule.message,
        file: osPath(sinkSf.fileName),
        line: lc.line + 1,
        col: lc.character + 1,
      };
      if (srcNode && srcSf) {
        const slc = srcSf.getLineAndCharacterOfPosition(srcNode.getStart());
        entry.relatedFile = osPath(srcSf.fileName);
        entry.relatedLine = slc.line + 1;
      }
      findings.push(entry);
    };

    const rootIdentifier = (node) => {
      let n = node;
      while (n && (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n))) {
        n = n.expression;
      }
      return n && ts.isIdentifier(n) ? n : null;
    };

    const functionNodeOf = (decl) => {
      if (!decl) return null;
      if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl) || ts.isArrowFunction(decl) || ts.isMethodDeclaration(decl)) return decl;
      if (ts.isVariableDeclaration(decl) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) return decl.initializer;
      return null;
    };
    const fnKey = (node) => `${node.getSourceFile().fileName}:${node.getStart()}`;

    const resolveDecl = (idNode) => {
      let sym;
      try { sym = checker.getSymbolAtLocation(idNode); } catch { return null; }
      if (!sym) return null;
      if (sym.flags & ts.SymbolFlags.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch {  } }
      return sym.valueDeclaration || (sym.declarations && sym.declarations[0]) || null;
    };

    const callSitesByFn = new Map();

    const findNodeAtPos = (sf, pos) => {
      let found = null;
      const f = (n) => {
        if (pos >= n.getStart(sf) && pos < n.getEnd()) { found = n; ts.forEachChild(n, f); }
      };
      f(sf);
      return found;
    };
    const enclosingCallAsCallee = (node) => {
      let n = node;
      while (n && n.parent) {
        const p = n.parent;
        if (ts.isCallExpression(p) && (n === p.expression || (p.expression && p.expression.getStart() <= n.getStart() && n.getEnd() <= p.expression.getEnd()))) {
          return p;
        }
        if (ts.isCallExpression(p) && p.arguments.some((a) => a === n)) return null;
        n = p;
      }
      return null;
    };

    const taintSource = (expr, depth, visited) => {
      if (!expr || depth > 4) return null;
      let text;
      try { text = expr.getText(expr.getSourceFile()); } catch { return null; }
      if (!text || text.length > 400) return null;
      if (SANITISER_RE.test(text)) return null;
      if (SOURCE_RE.test(text)) return { node: expr, sf: expr.getSourceFile() };
      const rootId = rootIdentifier(expr);
      if (rootId) return traceIdentifier(rootId, depth, visited);
      return null;
    };

    const traceIdentifier = (idNode, depth, visited) => {
      if (depth > 4) return null;
      let sym;
      try { sym = checker.getSymbolAtLocation(idNode); } catch { return null; }
      if (!sym) return null;
      const decl = sym.valueDeclaration || (sym.declarations && sym.declarations[0]);
      if (!decl) return null;
      const declSf = decl.getSourceFile();
      const key = `${declSf.fileName}:${decl.getStart()}`;
      if (visited.has(key)) return null;
      visited.add(key);
      if (visited.size > 60) return null;

      if (ts.isParameter(decl)) {
        const fn = decl.parent;
        if (!fn || !fn.parameters) return null;
        const paramIndex = fn.parameters.indexOf(decl);
        if (paramIndex < 0) return null;
        const sites = callSitesByFn.get(fnKey(fn)) || [];
        for (const site of sites.slice(0, 200)) {
          const arg = site.call.arguments[paramIndex];
          if (!arg) continue;
          const s = taintSource(arg, depth + 1, visited);
          if (s) return s;
        }
        return null;
      }

      if (ts.isVariableDeclaration(decl) && decl.initializer) {
        return taintSource(decl.initializer, depth + 1, visited);
      }

      if (ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl) || ts.isBindingElement(decl)) {
        try {
          const aliased = checker.getAliasedSymbol(sym);
          const ad = aliased && (aliased.valueDeclaration || (aliased.declarations && aliased.declarations[0]));
          if (ad && ts.isVariableDeclaration(ad) && ad.initializer) return taintSource(ad.initializer, depth + 1, visited);
        } catch {  }
        return null;
      }
      return null;
    };

    const SINK_CALL = [
      { test: (o, n) => n === 'eval', arg: 0, cwe: 'CWE-95', ruleId: 'xf/eval', msg: 'code execution' },
      { test: (o, n) => n === 'exec' || n === 'execSync', arg: 0, cwe: 'CWE-78', ruleId: 'xf/command', msg: 'a shell command' },
      { test: (o, n) => o === 'fs' && /^(readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|unlinkSync|open|openSync)$/.test(n), arg: 0, cwe: 'CWE-22', ruleId: 'xf/path', msg: 'a filesystem path' },
      { test: (o, n) => /^(res|reply|response|ctx)$/i.test(o) && /^(sendFile|download)$/.test(n), arg: 0, cwe: 'CWE-22', ruleId: 'xf/sendfile', msg: 'a served file path' },
      { test: (o, n) => /^(res|reply|response|ctx)$/i.test(o) && n === 'redirect', arg: 0, cwe: 'CWE-601', ruleId: 'xf/redirect', msg: 'a redirect target' },
      { test: (o, n) => n === 'query' || n === 'execute', arg: 0, cwe: 'CWE-89', ruleId: 'xf/sql', msg: 'a database query' },
      { test: (o, n) => n === 'fetch' || (/^(axios|got|ky|superagent|needle)$/.test(o)) || (/^https?$/.test(o) && /^(get|request)$/.test(n)) || (o === 'axios'), arg: 0, cwe: 'CWE-918', ruleId: 'xf/ssrf', msg: 'a request URL' },
      { test: (o, n) => o === 'Object' && n === 'assign', arg: 1, cwe: 'CWE-915', ruleId: 'xf/mass-assign', msg: 'an object (mass assignment)' },
      { test: (o, n) => /^(create|save|update|build|insertMany)$/.test(n), arg: 0, cwe: 'CWE-915', ruleId: 'xf/orm-assign', msg: 'an ORM write (mass assignment)' },
    ];
    const matchCallSink = (callee) => {
      let obj = '', name = '';
      if (ts.isIdentifier(callee)) name = callee.text;
      else if (ts.isPropertyAccessExpression(callee)) {
        name = callee.name.text;
        obj = ts.isIdentifier(callee.expression) ? callee.expression.text : (ts.isPropertyAccessExpression(callee.expression) ? callee.expression.name.text : '');
      } else return null;
      return SINK_CALL.find((s) => s.test(obj, name)) || null;
    };
    const isRouteCallee = (callee) => {
      if (!ts.isPropertyAccessExpression(callee)) return null;
      const method = callee.name.text.toLowerCase();
      if (!['get', 'post', 'put', 'delete', 'patch', 'all'].includes(method)) return null;
      const obj = ts.isIdentifier(callee.expression) ? callee.expression.text : '';
      if (!/^(app|router|api|server|route|routes)$/i.test(obj)) return null;
      return { method };
    };
    const resolveFn = (decl) => {
      if (!decl) return null;
      if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl) || ts.isArrowFunction(decl) || ts.isMethodDeclaration(decl)) return decl;
      if (ts.isVariableDeclaration(decl) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) return decl.initializer;
      return null;
    };

    const rootLower = norm(root).toLowerCase();
    const files = program.getSourceFiles().filter((sf) => {
      const f = sf.fileName;

      return !sf.isDeclarationFile && !/node_modules/.test(f) && norm(f).toLowerCase().startsWith(rootLower);
    });

    for (const sf of files) {
      try {
        const collect = (node) => {
          if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const idNode = ts.isIdentifier(callee) ? callee : (ts.isPropertyAccessExpression(callee) ? callee.name : null);
            if (idNode) {
              const fn = functionNodeOf(resolveDecl(idNode));
              if (fn) {
                const k = fnKey(fn);
                const arr = callSitesByFn.get(k);
                if (arr) arr.push({ call: node, sf });
                else callSitesByFn.set(k, [{ call: node, sf }]);
              }
            }
          }
          ts.forEachChild(node, collect);
        };
        collect(sf);
      } catch (error) {

      }
    }

    for (const sf of files) {
      if (findings.length >= MAX_FINDINGS) break;
      try {
        const visit = (node) => {

          if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
            const prop = node.left.name.text;
            if (prop === 'innerHTML' || prop === 'outerHTML') {
              const s = taintSource(node.right, 0, new Set());
              if (s && s.sf !== sf) push({ ruleId: 'xf/xss-innerhtml', cwe: 'CWE-79', severity: 'error', message: `Tainted input from ${osPath(s.sf.fileName)} reaches ${prop} here (cross-file XSS flow).` }, node.left.name, sf, s.node, s.sf);
            }
          }
          if (ts.isCallExpression(node)) {
            const sink = matchCallSink(node.expression);
            if (sink) {
              const arg = node.arguments[sink.arg];
              if (arg) {
                const s = taintSource(arg, 0, new Set());
                if (s && s.sf !== sf) {
                  push({ ruleId: sink.ruleId, cwe: sink.cwe, severity: 'error', message: `Tainted input from ${osPath(s.sf.fileName)} reaches ${sink.msg} here (cross-file flow).` }, ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression, sf, s.node, s.sf);
                }
              }
            }
            const route = isRouteCallee(node.expression);
            if (route && node.arguments.length >= 2 && ts.isStringLiteralLike(node.arguments[0])) {
              const routePath = node.arguments[0].text;
              if (!SKIP_AUTH_PATH.test(routePath)) {
                const handler = node.arguments[node.arguments.length - 1];
                let middlewareAuthed = false;
                for (let i = 1; i < node.arguments.length - 1; i += 1) {
                  try { if (AUTH_MARKER.test(node.arguments[i].getText())) middlewareAuthed = true; } catch {  }
                }

                if (!middlewareAuthed && ts.isIdentifier(handler)) {
                  let hsym;
                  try { hsym = checker.getSymbolAtLocation(handler); } catch { hsym = null; }
                  const hdecl = hsym && (hsym.valueDeclaration || (hsym.declarations && hsym.declarations[0]));
                  let fn = resolveFn(hdecl);
                  if (!fn && hdecl && (ts.isImportSpecifier(hdecl) || ts.isImportClause(hdecl))) {
                    try { const a = checker.getAliasedSymbol(hsym); fn = resolveFn(a && (a.valueDeclaration || (a.declarations && a.declarations[0]))); } catch {  }
                  }
                  if (fn && fn.body) {
                    const fnSf = fn.getSourceFile();
                    if (fnSf !== sf) {
                      let body = '';
                      try { body = fn.body.getText(fnSf); } catch { body = ''; }
                      if (!AUTH_MARKER.test(body) && READS_INPUT.test(body)) {
                        const nameNode = fn.name || fn;
                        push({ ruleId: 'xf/route-missing-auth', cwe: 'CWE-306', severity: 'warning', message: `This handler for a ${route.method.toUpperCase()} ${routePath} route (declared in ${osPath(sf.fileName)}) has no authentication check and reads request input — broken access control / IDOR.` }, nameNode, fnSf, node.arguments[0], sf);
                      }
                    }
                  }
                }
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);
      } catch (error) {

      }
    }

    return { findings };
  },

  rename(root, filePath, position) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return { canRename: false, error: 'No project.' };
    try {
      const info = languageService.getRenameInfo(file, position, {
        allowRenameOfImportPath: false,
      });
      if (!info.canRename) {
        return { canRename: false, error: info.localizedErrorMessage || 'This cannot be renamed.' };
      }
      const found = languageService.findRenameLocations(file, position, false, false, {
        providePrefixAndSuffixTextForRename: true,
      }) || [];
      return {
        canRename: true,
        displayName: info.displayName,

        triggerSpan: info.triggerSpan
          ? { start: info.triggerSpan.start, length: info.triggerSpan.length }
          : null,
        locations: found.map((entry) => ({
          file: entry.fileName,
          start: entry.textSpan.start,
          length: entry.textSpan.length,

          prefix: entry.prefixText ?? '',
          suffix: entry.suffixText ?? '',
        })),
      };
    } catch (error) {
      return { canRename: false, error: error.message };
    }
  },

  codeActions(root, filePath, start, end, codes) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return { actions: [] };
    const actions = [];
    try {
      const errorCodes = Array.isArray(codes) && codes.length ? codes : [];
      if (errorCodes.length) {
        const fixes = languageService.getCodeFixesAtPosition(file, start, end, errorCodes, FORMAT_OPTIONS, COMPLETION_OPTIONS);
        for (const fix of fixes) {
          const files = changesToFiles(fix.changes);
          if (files.length) actions.push({ kind: 'fix', title: fix.description, files });
        }
      }
    } catch {

    }
    try {
      const refactors = languageService.getApplicableRefactors(file, { pos: start, end }, COMPLETION_OPTIONS);
      for (const group of refactors) {
        for (const action of group.actions) {
          if (action.notApplicableReason) continue;
          actions.push({ kind: 'refactor', title: action.description, refactor: group.name, action: action.name });
        }
      }
    } catch {

    }
    return { actions };
  },

  refactorEdits(root, filePath, start, end, refactor, action) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return { files: [] };
    try {
      const info = languageService.getEditsForRefactor(
        file,
        FORMAT_OPTIONS,
        { pos: start, end },
        refactor,
        action,
        COMPLETION_OPTIONS,
      );
      if (!info) return { files: [] };
      return { files: changesToFiles(info.edits) };
    } catch (error) {
      return { files: [], error: error.message };
    }
  },

  documentHighlights(root, filePath, position) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return { spans: [] };
    try {
      const found = languageService.getDocumentHighlights(file, position, [file]);
      if (!found) return { spans: [] };
      const spans = [];
      for (const doc of found) {
        if (norm(doc.fileName) !== file) continue;
        for (const item of doc.highlightSpans) {
          spans.push({
            start: item.textSpan.start,
            length: item.textSpan.length,
            write: item.kind === 'writtenReference',
          });
        }
      }
      return { spans };
    } catch (error) {
      return { spans: [], error: error.message };
    }
  },

  signatureHelp(root, filePath, position) {
    const file = norm(filePath);
    const languageService = ensureService(norm(root));
    if (!languageService) return { signatures: null };
    try {
      const help = languageService.getSignatureHelpItems(file, position, {});
      if (!help || !help.items || help.items.length === 0) return { signatures: null };
      const text = (parts) => (parts || []).map((part) => part.text).join('');
      const signatures = help.items.map((item) => {
        const params = (item.parameters || []).map((param) => ({
          label: text(param.displayParts),
          documentation: text(param.documentation),
        }));
        const separator = text(item.separatorDisplayParts) || ', ';
        const label =
          text(item.prefixDisplayParts) +
          params.map((param) => param.label).join(separator) +
          text(item.suffixDisplayParts);
        return { label, parameters: params, documentation: text(item.documentation) };
      });
      return {
        signatures,
        activeSignature: help.selectedItemIndex || 0,
        activeParameter: help.argumentIndex || 0,
      };
    } catch (error) {
      return { signatures: null, error: error.message };
    }
  },
};

parentPort.on('message', (msg) => {
  const handler = OPS[msg.op];
  if (!handler) {
    parentPort.postMessage({ id: msg.id, error: `unknown ts op: ${msg.op}` });
    return;
  }
  try {
    parentPort.postMessage({ id: msg.id, result: handler(...(msg.args ?? [])) });
  } catch (error) {
    parentPort.postMessage({ id: msg.id, error: String(error?.message ?? error) });
  }
});
