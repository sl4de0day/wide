import type { Severity } from "@/stores/findings";

export interface DetectCtx {
  body: string;
  headers: [string, string][];
  status: number;
  baseline: { body: string; status: number; headers: [string, string][] };
}

export interface ScanCase {
  send: string;
  detect: (ctx: DetectCtx) => { snippet: string } | null;
}

export type PointKind = "query" | "cookie" | "header" | "body" | "path" | "json";

export interface Probe {
  id: string;
  name: string;
  severity: Severity;
  cwe?: string;
  points: PointKind[] | "all";
  cases: (baseValue: string) => ScanCase[];
}

let markerSeq = 0;
const marker = (tag: string) => `wiv${tag}${(markerSeq += 1).toString(36)}z`;

const header = (headers: [string, string][], name: string): string => {
  const lower = name.toLowerCase();
  return headers.find(([n]) => n.toLowerCase() === lower)?.[1] ?? "";
};

const SQL_ERRORS =
  /(SQL syntax|mysql_fetch|mysqli?|ORA-\d{4,5}|PostgreSQL.*ERROR|PLS-\d+|SQLite\/JDBC|SQLServer|ODBC.*Driver|Unclosed quotation mark|quoted string not properly terminated|syntax error at or near|SQLSTATE\[|Warning.*\Wpg_|valid MySQL result|supplied argument is not a valid)/i;

export const PROBES: Probe[] = [
  {
    id: "xss-reflected",
    name: "Reflected XSS",
    severity: "high",
    cwe: "CWE-79",
    points: "all",
    cases: (base) => {
      const m = marker("xss");
      const breakout = `${m}"'><svg/onload=1>`;
      return [
        {
          send: base + breakout,
          detect: ({ body }) => (body.includes(breakout) ? { snippet: breakout } : null),
        },
      ];
    },
  },
  {
    id: "sqli-error",
    name: "SQL injection (error-based)",
    severity: "high",
    cwe: "CWE-89",
    points: "all",
    cases: (base) =>
      ["'", '"'].map((q) => ({
        send: base + q,

        detect: ({ body, baseline }) => {
          const hit = body.match(SQL_ERRORS);
          if (hit && !SQL_ERRORS.test(baseline.body)) return { snippet: hit[0] };
          return null;
        },
      })),
  },
  {
    id: "ssti",
    name: "Server-side template injection",
    severity: "high",
    cwe: "CWE-1336",
    points: "all",
    cases: (base) => {
      const a = 7654;
      const b = 3;
      const product = String(a * b);
      return [`{{${a}*${b}}}`, `\${${a}*${b}}`, `#{${a}*${b}}`].map((expr) => ({
        send: base + expr,
        detect: ({ body, baseline }) =>
          body.includes(product) && !baseline.body.includes(product) ? { snippet: `${expr} → ${product}` } : null,
      }));
    },
  },
  {
    id: "path-traversal",
    name: "Path traversal",
    severity: "high",
    cwe: "CWE-22",
    points: "all",
    cases: () =>
      ["../../../../../../etc/passwd", "....//....//....//etc/passwd", "..%2f..%2f..%2f..%2fetc%2fpasswd"].map((p) => ({
        send: p,
        detect: ({ body, baseline }) =>
          /root:.*:0:0:/.test(body) && !/root:.*:0:0:/.test(baseline.body) ? { snippet: "root:…:0:0:" } : null,
      })),
  },
  {
    id: "cmd-injection",
    name: "OS command injection",
    severity: "critical",
    cwe: "CWE-78",
    points: "all",
    cases: (base) =>
      [`${base};id`, `${base}|id`, `${base}$(id)`, `${base}\`id\``].map((send) => ({
        send,
        detect: ({ body, baseline }) =>
          /uid=\d+\([^)]+\)\s+gid=\d+/.test(body) && !/uid=\d+\(/.test(baseline.body) ? { snippet: "uid=…gid=…" } : null,
      })),
  },
  {
    id: "open-redirect",
    name: "Open redirect",
    severity: "medium",
    cwe: "CWE-601",
    points: ["query", "body"],
    cases: () => {
      const evil = "https://wiv-redirect.example/";
      return [evil, `//wiv-redirect.example/`].map((send) => ({
        send,
        detect: ({ status, headers }) => {
          const loc = header(headers, "location");
          if (status >= 300 && status < 400 && /(^https?:)?\/\/wiv-redirect\.example/.test(loc)) return { snippet: `Location: ${loc}` };
          return null;
        },
      }));
    },
  },
  {
    id: "crlf",
    name: "CRLF / header injection",
    severity: "medium",
    cwe: "CWE-113",
    points: ["query", "body"],
    cases: (base) => {
      const m = marker("crlf");
      return [`${base}%0d%0aWiv-Injected:${m}`, `${base}\r\nWiv-Injected:${m}`].map((send) => ({
        send,
        detect: ({ headers }) => (header(headers, "wiv-injected") === m ? { snippet: `Wiv-Injected: ${m}` } : null),
      }));
    },
  },
  {
    id: "ssrf",
    name: "SSRF (response-based)",
    severity: "high",
    cwe: "CWE-918",
    points: "all",
    cases: () =>
      ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:80/", "file:///etc/passwd"].map((send) => ({
        send,
        detect: ({ body, baseline }) => {
          if (/ami-id|instance-id|iam\/security-credentials|meta-data\//i.test(body) && !/ami-id|instance-id|meta-data\//i.test(baseline.body))
            return { snippet: "cloud metadata reflected" };
          if (/root:.*:0:0:/.test(body) && !/root:.*:0:0:/.test(baseline.body)) return { snippet: "file:// read (root:…:0:0:)" };
          return null;
        },
      })),
  },
  {
    id: "ldap-injection",
    name: "LDAP injection",
    severity: "medium",
    cwe: "CWE-90",
    points: "all",
    cases: (base) =>
      [`${base}*`, `${base}*)(uid=*))(|(uid=*`, `${base})(cn=*`].map((send) => ({
        send,
        detect: ({ body, baseline }) => {
          const re = /(javax\.naming|LDAP: error code|Invalid DN syntax|com\.sun\.jndi|OpenLDAP|ldap_search)/i;
          const hit = body.match(re);
          return hit && !re.test(baseline.body) ? { snippet: hit[0] } : null;
        },
      })),
  },
  {
    id: "xpath-injection",
    name: "XPath injection",
    severity: "medium",
    cwe: "CWE-643",
    points: "all",
    cases: (base) =>
      [`${base}'`, `${base}' or '1'='1`, `${base}]`].map((send) => ({
        send,
        detect: ({ body, baseline }) => {
          const re = /(XPathException|xmlXPathEval|SimpleXMLElement::xpath|Invalid expression|unclosed token|XPST0003|MS\.Internal\.Xml)/i;
          const hit = body.match(re);
          return hit && !re.test(baseline.body) ? { snippet: hit[0] } : null;
        },
      })),
  },
  {
    id: "ssi-injection",
    name: "SSI injection",
    severity: "high",
    cwe: "CWE-97",
    points: "all",
    cases: () =>
      ['<!--#exec cmd="id"-->'].map((send) => ({
        send,
        detect: ({ body, baseline }) =>
          /uid=\d+\([^)]+\)\s+gid=\d+/.test(body) && !/uid=\d+\(/.test(baseline.body) ? { snippet: "SSI exec (uid=…gid=…)" } : null,
      })),
  },
];

export const CORS_PROBE = {
  id: "cors",
  name: "Insecure CORS",
  severity: "medium" as Severity,
  cwe: "CWE-942",
  origin: "https://wiv-cors.example",
  detect: (headers: [string, string][]): { snippet: string } | null => {
    const acao = header(headers, "access-control-allow-origin");
    const acac = header(headers, "access-control-allow-credentials").toLowerCase() === "true";
    if (acao === "https://wiv-cors.example" || (acao === "*" && acac)) return { snippet: `ACAO: ${acao}${acac ? " + credentials" : ""}` };
    return null;
  },
};
