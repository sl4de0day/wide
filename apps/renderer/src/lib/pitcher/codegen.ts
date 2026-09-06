import { base64Encode } from "@/lib/codec";
import type { PitcherRequest } from "@/stores/pitcher";

import { resolveVars } from "./vars";

export type CodeLang = "curl" | "powershell" | "fetch" | "axios" | "python" | "go";

export const CODE_LANGS: { id: CodeLang; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "powershell", label: "PowerShell" },
  { id: "fetch", label: "JavaScript · fetch" },
  { id: "axios", label: "JavaScript · axios" },
  { id: "python", label: "Python · requests" },
  { id: "go", label: "Go · net/http" },
];

interface Effective {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
}

const CONTENT_TYPE: Record<string, string> = { json: "application/json", xml: "application/xml", text: "text/plain", html: "text/html" };

export function materialize(req: PitcherRequest, vars: Record<string, string>): Effective {
  const base = resolveVars(req.url, vars);
  const enabled = (arr: { key: string; value: string; enabled: boolean }[]) =>
    arr.filter((p) => p.enabled && p.key.trim()).map((p) => [resolveVars(p.key, vars), resolveVars(p.value, vars)] as [string, string]);

  let url = base;
  const qp = enabled(req.params);
  if (qp.length) {
    try {
      const u = new URL(base);
      for (const [k, v] of qp) u.searchParams.append(k, v);
      url = u.toString();
    } catch {
      url = base + (base.includes("?") ? "&" : "?") + qp.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    }
  }

  const headers = enabled(req.headers);
  let body: string | null = null;
  const b = req.body;
  if (b.mode === "raw") {
    body = resolveVars(b.raw, vars);
    if (!headers.some(([n]) => n.toLowerCase() === "content-type")) headers.push(["Content-Type", CONTENT_TYPE[b.rawType] ?? "text/plain"]);
  } else if (b.mode === "form") {
    body = enabled(b.form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    if (!headers.some(([n]) => n.toLowerCase() === "content-type")) headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
  } else if (b.mode === "graphql") {
    let v: unknown = {};
    try {
      v = b.graphql.variables.trim() ? JSON.parse(resolveVars(b.graphql.variables, vars)) : {};
    } catch {
      v = {};
    }
    body = JSON.stringify({ query: resolveVars(b.graphql.query, vars), variables: v });
    if (!headers.some(([n]) => n.toLowerCase() === "content-type")) headers.push(["Content-Type", "application/json"]);
  }

  const a = req.auth;
  if (a.type === "bearer" && a.bearer.trim()) headers.push(["Authorization", `Bearer ${resolveVars(a.bearer, vars)}`]);
  else if (a.type === "basic") headers.push(["Authorization", `Basic ${base64Encode(`${resolveVars(a.basic.username, vars)}:${resolveVars(a.basic.password, vars)}`)}`]);
  else if (a.type === "apikey" && a.apikey.key.trim() && a.apikey.in === "header") headers.push([resolveVars(a.apikey.key, vars), resolveVars(a.apikey.value, vars)]);
  else if (a.type === "oauth2" && a.oauth2.token.trim()) headers.push(["Authorization", `Bearer ${resolveVars(a.oauth2.token, vars)}`]);

  return { method: req.method.toUpperCase(), url, headers, body };
}

const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const dq = (s: string) => JSON.stringify(s);

function toCurl(e: Effective): string {
  const lines = [`curl -X ${e.method} ${q(e.url)}`];
  for (const [k, v] of e.headers) lines.push(`  -H ${q(`${k}: ${v}`)}`);
  if (e.body) lines.push(`  --data ${q(e.body)}`);
  return lines.join(" \\\n");
}

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

function toPowerShell(e: Effective): string {
  let out = "";
  if (e.headers.length) out += `$headers = @{\n${e.headers.map(([k, v]) => `  ${psq(k)} = ${psq(v)}`).join("\n")}\n}\n`;
  if (e.body) out += `$body = ${psq(e.body)}\n`;
  const headerArg = e.headers.length ? " -Headers $headers" : "";
  const bodyArg = e.body ? " -Body $body" : "";
  out += `$response = Invoke-RestMethod -Method ${e.method} -Uri ${psq(e.url)}${headerArg}${bodyArg}\n$response`;
  return out;
}

export function curlFromParts(method: string, url: string, headers: [string, string][], body: string): string {
  return toCurl({ method: (method || "GET").toUpperCase(), url, headers: headers.filter(([k]) => k), body: body || null });
}

function toFetch(e: Effective): string {
  const headers = e.headers.length ? `\n  headers: ${JSON.stringify(Object.fromEntries(e.headers), null, 2).replace(/\n/g, "\n  ")},` : "";
  const body = e.body ? `\n  body: ${dq(e.body)},` : "";
  return `const res = await fetch(${dq(e.url)}, {\n  method: ${dq(e.method)},${headers}${body}\n});\nconst data = await res.text();\nconsole.log(data);`;
}

function toAxios(e: Effective): string {
  const headers = e.headers.length ? `\n  headers: ${JSON.stringify(Object.fromEntries(e.headers), null, 2).replace(/\n/g, "\n  ")},` : "";
  const body = e.body ? `\n  data: ${dq(e.body)},` : "";
  return `import axios from "axios";\n\nconst res = await axios({\n  method: ${dq(e.method.toLowerCase())},\n  url: ${dq(e.url)},${headers}${body}\n});\nconsole.log(res.data);`;
}

function toPython(e: Effective): string {
  const headers = e.headers.length ? `\nheaders = ${JSON.stringify(Object.fromEntries(e.headers), null, 4)}` : "\nheaders = {}";
  const body = e.body ? `\ndata = ${dq(e.body)}` : "";
  const dataArg = e.body ? ", data=data" : "";
  return `import requests\n${headers}${body}\n\nres = requests.request(${dq(e.method)}, ${dq(e.url)}, headers=headers${dataArg})\nprint(res.status_code)\nprint(res.text)`;
}

function toGo(e: Effective): string {
  const bodyReader = e.body ? `strings.NewReader(${dq(e.body)})` : "nil";
  const setHeaders = e.headers.map(([k, v]) => `\treq.Header.Set(${dq(k)}, ${dq(v)})`).join("\n");
  return `package main\n\nimport (\n\t"fmt"\n\t"io"\n\t"net/http"\n\t"strings"\n)\n\nfunc main() {\n\treq, _ := http.NewRequest(${dq(e.method)}, ${dq(e.url)}, ${bodyReader})\n${setHeaders}\n\tres, err := http.DefaultClient.Do(req)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer res.Body.Close()\n\tb, _ := io.ReadAll(res.Body)\n\tfmt.Println(string(b))\n}`;
}

export function generateCode(req: PitcherRequest, vars: Record<string, string>, lang: CodeLang): string {
  const e = materialize(req, vars);
  switch (lang) {
    case "curl":
      return toCurl(e);
    case "powershell":
      return toPowerShell(e);
    case "fetch":
      return toFetch(e);
    case "axios":
      return toAxios(e);
    case "python":
      return toPython(e);
    case "go":
      return toGo(e);
    default:
      return "";
  }
}
