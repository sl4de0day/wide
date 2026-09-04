import type { Text } from "@codemirror/state";

import type { Diagnostic } from "@/lib/bridge";

export const TAINT_LANGUAGES = new Set([
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "html", "htm", "xhtml", "vue", "svelte",
]);

const SOURCE_RE =
  /\breq\.(?:query|params|body|headers|cookies)\b|\blocation\.(?:search|hash)\b|\bdocument\.(?:referrer|URL|documentURI)\b|\bnew\s+URLSearchParams\b|\.searchParams\b|searchParams\.get\s*\(|\bevent\.data\b|\bprocess\.argv\b|\bwindow\.name\b/;

const SANITISER_RE =
  /\b(?:sanitiz|sanitis|escape|encodeURI|encodeURIComponent|DOMPurify|purify|htmlspecialchars|escapeHtml|validator|isURL|allowlist|whitelist|Number|parseInt|parseFloat)/i;

const DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^=].*)$/;
const DESTRUCTURE_RE = /\b(?:const|let|var)\s*\{\s*([^}]+)\}\s*=\s*([^=].*)$/;
const ASSIGN_RE = /^\s*([A-Za-z_$][\w$]*)\s*=\s*([^=].*)$/;

interface Sink {
  id: string;
  re: RegExp;
  message: string;
  why: string;
  fix: string;
  cwe: string;
}

const SINKS: Sink[] = [
  {
    id: "wide/taint-xss-innerhtml",
    re: /\.(?:inner|outer)HTML\s*=\s*([A-Za-z_$][\w$]*)\b/,
    message: "Tainted input reaches innerHTML/outerHTML (stored XSS flow).",
    why: "A value that came from the request/URL is assigned as HTML, so markup in it becomes live elements.",
    fix: "Use textContent, or sanitise the value (DOMPurify) before assigning.",
    cwe: "CWE-79",
  },
  {
    id: "wide/taint-xss-insertadjacent",
    re: /insertAdjacentHTML\s*\(\s*[^,]+,\s*([A-Za-z_$][\w$]*)(?:\.[\w$]+|\[[^\]\n]*\])*\s*\)/,
    message: "Tainted input reaches insertAdjacentHTML (XSS flow).",
    why: "The tainted value is parsed as HTML and inserted into the document.",
    fix: "Build nodes with the DOM API, or sanitise before inserting.",
    cwe: "CWE-79",
  },
  {
    id: "wide/taint-xss-write",
    re: /\bdocument\.write(?:ln)?\s*\(\s*([A-Za-z_$][\w$]*)/,
    message: "Tainted input reaches document.write (XSS flow).",
    why: "document.write parses the tainted value as HTML.",
    fix: "Build and append nodes instead of writing a string.",
    cwe: "CWE-79",
  },
  {
    id: "wide/taint-eval",
    re: /\beval\s*\(\s*([A-Za-z_$][\w$]*)(?:\.[\w$]+|\[[^\]\n]*\])*\s*\)/,
    message: "Tainted input reaches eval (code injection flow).",
    why: "A value from the request/URL is executed as code with full authority.",
    fix: "Never eval input; parse it (JSON.parse) or dispatch on known values.",
    cwe: "CWE-95",
  },
  {
    id: "wide/taint-command",
    re: /\bexec(?:Sync)?\s*\(\s*([A-Za-z_$][\w$]*)(?:\.[\w$]+|\[[^\]\n]*\])*\s*[,)]/,
    message: "Tainted input reaches a shell command (command-injection flow).",
    why: "The tainted value is run through a shell, so it can inject further commands.",
    fix: "Use execFile/spawn with an argument array, never a shell string.",
    cwe: "CWE-78",
  },
  {
    id: "wide/taint-path",
    re: /\bfs\.(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|unlinkSync|open|openSync)\s*\(\s*([A-Za-z_$][\w$]*)/,
    message: "Tainted input reaches a filesystem path (path-traversal flow).",
    why: "A request-derived path lets '../' escape the intended directory.",
    fix: "Resolve against a fixed base and reject anything outside it, or reduce to path.basename().",
    cwe: "CWE-22",
  },
  {
    id: "wide/taint-sendfile",
    re: /\bres\.(?:sendFile|download)\s*\(\s*([A-Za-z_$][\w$]*)/,
    message: "Tainted input is served as a file path (path-traversal flow).",
    why: "A user-controlled path with '../' can serve files outside the web root.",
    fix: "Validate to a basename and set the { root } option.",
    cwe: "CWE-22",
  },
  {
    id: "wide/taint-redirect",
    re: /\bres\.redirect\s*\(\s*([A-Za-z_$][\w$]*)/,
    message: "Tainted input is used as a redirect target (open-redirect flow).",
    why: "A fully user-controlled Location turns the endpoint into an open redirect.",
    fix: "Redirect only to a relative path or an allowlisted destination.",
    cwe: "CWE-601",
  },
  {
    id: "wide/taint-location",
    re: /\blocation(?:\.href)?\s*=\s*([A-Za-z_$][\w$]*)\b/,
    message: "Tainted input navigates the browser (DOM open-redirect flow).",
    why: "Assigning a request-derived URL to location can redirect off-site or run a javascript: URL.",
    fix: "Allowlist the destination or force a same-origin relative path.",
    cwe: "CWE-601",
  },
  {
    id: "wide/taint-sql",
    re: /\.(?:query|execute)\s*\(\s*([A-Za-z_$][\w$]*)(?:\.[\w$]+|\[[^\]\n]*\])*\s*[,)]/,
    message: "Tainted input reaches a database query (SQL-injection flow).",
    why: "A request-derived string passed as a query can change the query's meaning.",
    fix: "Use a parameterised query with placeholders and bound values.",
    cwe: "CWE-89",
  },
  {
    id: "wide/taint-setattr",
    re: /\.setAttribute\s*\(\s*['"](?:href|src|action|formaction)['"]\s*,\s*([A-Za-z_$][\w$]*)/,
    message: "Tainted input sets a URL attribute (XSS / open-redirect flow).",
    why: "A request-derived href/src can be a javascript: URL or an off-site destination.",
    fix: "Validate the URL's scheme and host before setting the attribute.",
    cwe: "CWE-79",
  },
  {
    id: "wide/taint-mass-assign",
    re: /Object\.assign\s*\(\s*[^,]+,\s*([A-Za-z_$][\w$]*)(?:\.[\w$]+|\[[^\]\n]*\])*\s*\)/,
    message: "Tainted input is spread onto an object (mass-assignment flow).",
    why: "Every attacker-supplied key overwrites the target, so a request can set protected fields like role or isAdmin.",
    fix: "Copy only an explicit allowlist of fields, or merge into a fresh {} with just the validated values.",
    cwe: "CWE-915",
  },
  {
    id: "wide/taint-orm-assign",
    re: /\.(?:create|save|update|build|insertMany|register)\s*\(\s*([A-Za-z_$][\w$]*)(?:\.[\w$]+|\[[^\]\n]*\])*\s*[,)]/,
    message: "Tainted input is persisted through an ORM (mass-assignment flow).",
    why: "The ORM writes every field present in the request object, letting an attacker inject columns the form never exposed.",
    fix: "Build the record from an explicit set of permitted fields, not the raw request object.",
    cwe: "CWE-915",
  },
  {
    id: "wide/taint-ssrf",
    re: /\b(?:fetch|axios(?:\.\w+)?|got|ky|superagent|needle|http\.get|https\.get|request)\s*\(\s*([A-Za-z_$][\w$]*)(?:\.[\w$]+|\[[^\]\n]*\])*\s*[,)]/,
    message: "Tainted input is used as a request URL (SSRF flow).",
    why: "A user-controlled URL lets the request reach internal services or cloud metadata.",
    fix: "Validate the host/scheme against an allowlist before requesting it.",
    cwe: "CWE-918",
  },
];

function compose(sink: Sink): string {
  return `${sink.message}\n\n${sink.why}\n\nFix: ${sink.fix}\n\n${sink.cwe} · (${sink.id})`;
}

function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

function collectTainted(doc: Text): Set<string> {
  const tainted = new Set<string>();
  const mark = (rhs: string, add: () => void) => {
    if (SOURCE_RE.test(rhs) && !SANITISER_RE.test(rhs)) add();
  };
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n).text;
    if (isCommentLine(line)) continue;
    let m = DESTRUCTURE_RE.exec(line);
    if (m) {
      const rhs = m[2];
      mark(rhs, () => {
        for (const raw of m![1].split(",")) {
          const name = raw.split(":").pop()!.trim().replace(/\s.*$/, "");
          if (/^[A-Za-z_$][\w$]*$/.test(name)) tainted.add(name);
        }
      });
      continue;
    }
    m = DECL_RE.exec(line);
    if (m) {
      mark(m[2], () => tainted.add(m![1]));
      continue;
    }
    m = ASSIGN_RE.exec(line);
    if (m) mark(m[2], () => tainted.add(m![1]));
  }
  return tainted;
}

const FINANCIAL_RE = /\b\w*(?:balance|amount|funds|credit|wallet|stock|quota|inventory|points|coins)\w*\b/i;

const FINANCIAL_DECL_RE = /\b(?:const|let|var)\s+\w*(?:balance|amount|funds|credit|wallet|stock|quota|inventory|points|coins)/i;

const FINANCIAL_MUTATION_RE =
  /[-+]=|=(?!=)|\b(?:decrement|increment|deduct|withdraw|charge|debit)\b|\.(?:save|update)\s*\(/i;

export function runToctou(doc: Text): Diagnostic[] {
  const checks: number[] = [];
  const awaits: number[] = [];
  const uses: { line: number; from: number; to: number }[] = [];
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    if (isCommentLine(line.text)) continue;
    if (/\bawait\b/.test(line.text)) awaits.push(n);
    const m = FINANCIAL_RE.exec(line.text);
    if (!m) continue;

    if (!FINANCIAL_DECL_RE.test(line.text) && FINANCIAL_MUTATION_RE.test(line.text)) {
      uses.push({ line: n, from: line.from + m.index, to: line.from + m.index + m[0].length });
    } else {
      checks.push(n);
    }
  }

  const found: Diagnostic[] = [];
  const seen = new Set<number>();
  for (const use of uses) {
    if (seen.has(use.line)) continue;

    const raced = checks.some(
      (c) => c < use.line && use.line - c <= 40 && awaits.some((a) => a > c && a < use.line),
    );
    if (!raced) continue;
    seen.add(use.line);
    found.push({
      from: use.from,
      to: use.to,
      severity: "info",
      message:
        `A balance is checked, then written after an await — a possible check-then-act race (double spend).` +
        `\n\nConcurrent requests can all pass the check before any writes back, so the balance is overspent.` +
        `\n\nFix: make the read-modify-write atomic — a transaction, a conditional/compare-and-set update, or a lock.` +
        `\n\nCWE-362 · (wide/toctou-race)`,
    });
  }
  return found;
}

export function runTaint(doc: Text): Diagnostic[] {
  const tainted = collectTainted(doc);
  if (tainted.size === 0) return [];

  const found: Diagnostic[] = [];
  const seen = new Set<string>();
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    if (isCommentLine(line.text)) continue;
    for (const sink of SINKS) {
      const re = new RegExp(sink.re.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(line.text)) !== null) {
        if (!tainted.has(m[1])) {
          if (m.index === re.lastIndex) re.lastIndex += 1;
          continue;
        }
        const from = line.from + m.index;
        const key = `${sink.id}:${from}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ from, to: from + m[0].length, severity: "warning", message: compose(sink) });
        }
        if (m.index === re.lastIndex) re.lastIndex += 1;
      }
    }
  }
  return found;
}
