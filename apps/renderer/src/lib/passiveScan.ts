import type { ProxyEntry } from "./bridge";
import type { Severity } from "@/stores/findings";

export interface PassiveIssue {
  checkId: string;
  title: string;
  severity: Severity;
  detail: string;
}

function header(pairs: [string, string][], name: string): string | null {
  const found = pairs.find(([n]) => n.toLowerCase() === name.toLowerCase());
  return found ? found[1] : null;
}

export function passiveChecks(entry: ProxyEntry): PassiveIssue[] {
  const issues: PassiveIssue[] = [];
  if (entry.websocket) return issues;

  const res = entry.resHeaders ?? [];
  const contentType = (header(res, "content-type") || "").toLowerCase();
  const isHtml = contentType.includes("text/html");
  const isHttps = entry.scheme === "https";
  const ok = entry.status >= 200 && entry.status < 400;
  const at = (extra: string) => `${entry.url}\n${extra}`;

  if (ok && isHtml && !header(res, "content-security-policy")) {
    issues.push({ checkId: "no-csp", title: "Missing Content-Security-Policy", severity: "medium", detail: at("No Content-Security-Policy header on an HTML response.") });
  }
  if (ok && isHttps && !header(res, "strict-transport-security")) {
    issues.push({ checkId: "no-hsts", title: "Missing Strict-Transport-Security", severity: "low", detail: at("HTTPS response with no HSTS header.") });
  }
  if (ok && !header(res, "x-content-type-options")) {
    issues.push({ checkId: "no-nosniff", title: "Missing X-Content-Type-Options", severity: "low", detail: at("No X-Content-Type-Options: nosniff.") });
  }
  if (ok && isHtml && !header(res, "x-frame-options") && !/frame-ancestors/i.test(header(res, "content-security-policy") || "")) {
    issues.push({ checkId: "no-framing", title: "Missing clickjacking protection", severity: "low", detail: at("No X-Frame-Options and no frame-ancestors in CSP.") });
  }

  for (const [name, value] of res) {
    if (name.toLowerCase() !== "set-cookie") continue;
    const lower = value.toLowerCase();
    const missing: string[] = [];
    if (!lower.includes("httponly")) missing.push("HttpOnly");
    if (isHttps && !lower.includes("secure")) missing.push("Secure");
    if (!lower.includes("samesite")) missing.push("SameSite");
    if (missing.length) {
      const cookieName = value.split("=")[0].trim();
      issues.push({
        checkId: `cookie:${cookieName}:${missing.join(",")}`,
        title: `Cookie ${cookieName} missing ${missing.join(", ")}`,
        severity: "medium",
        detail: at(`Set-Cookie: ${value}`),
      });
    }
  }

  const server = header(res, "server");
  const powered = header(res, "x-powered-by");
  if (server || powered) {
    issues.push({
      checkId: "disclosure",
      title: "Server software disclosed",
      severity: "info",
      detail: at([server && `Server: ${server}`, powered && `X-Powered-By: ${powered}`].filter(Boolean).join("\n")),
    });
  }

  const csp = header(res, "content-security-policy") || "";
  if (ok && isHtml && !header(res, "referrer-policy")) {
    issues.push({ checkId: "no-referrer-policy", title: "Missing Referrer-Policy", severity: "low", detail: at("No Referrer-Policy header on an HTML response.") });
  }
  if (ok && isHtml && !header(res, "permissions-policy")) {
    issues.push({ checkId: "no-permissions-policy", title: "Missing Permissions-Policy", severity: "info", detail: at("No Permissions-Policy header.") });
  }
  if (csp && /(unsafe-inline|unsafe-eval|script-src[^;]*\*)/i.test(csp)) {
    issues.push({ checkId: "weak-csp", title: "Weak Content-Security-Policy", severity: "medium", detail: at(`CSP allows unsafe-inline / unsafe-eval or a wildcard source:\n${csp.slice(0, 300)}`) });
  }
  if (header(res, "access-control-allow-origin") === "*") {
    issues.push({ checkId: "cors-wildcard", title: "CORS allows any origin (*)", severity: "medium", detail: at("Access-Control-Allow-Origin: *") });
  }

  const body = entry.resBody || "";
  if (isHttps && isHtml && /\b(?:src|href)\s*=\s*["']http:\/\//i.test(body)) {
    issues.push({ checkId: "mixed-content", title: "Mixed content on an HTTPS page", severity: "medium", detail: at("An HTTPS page references http:// resources.") });
  }
  if (ok && /<title>\s*Index of \//i.test(body)) {
    issues.push({ checkId: "dir-listing", title: "Directory listing exposed", severity: "medium", detail: at("The response looks like an auto-generated directory index.") });
  }
  if (/(Traceback \(most recent call last\)|\bat [a-zA-Z0-9_.$]+\([A-Za-z0-9_.]+\.java:\d+\)|Warning: [a-z_]+\(\)|Fatal error:|Uncaught \w+Exception|System\.[A-Za-z.]+Exception:|org\.springframework\.)/.test(body)) {
    issues.push({ checkId: "verbose-error", title: "Verbose error / stack trace", severity: "low", detail: at("A stack trace or framework error is exposed in the response.") });
  }
  if (/[?&](?:token|api_?key|apikey|password|passwd|secret|sessionid|session_id|access_token|auth)=/i.test(entry.url)) {
    issues.push({ checkId: "secret-in-url", title: "Sensitive data in URL", severity: "medium", detail: at("A token/secret/credential appears in the query string (logged, cached, sent in Referer).") });
  }
  if (isHtml && /type\s*=\s*["']password["']/i.test(body) && !/autocomplete\s*=\s*["']off["']/i.test(body)) {
    issues.push({ checkId: "autocomplete-password", title: "Password field allows autocomplete", severity: "info", detail: at("A password input without autocomplete=off.") });
  }
  if (!isHttps && isHtml && /type\s*=\s*["']password["']/i.test(body)) {
    issues.push({ checkId: "http-login", title: "Password form over plain HTTP", severity: "high", detail: at("A password field is served over http:// — credentials would go in cleartext.") });
  }

  return issues;
}
