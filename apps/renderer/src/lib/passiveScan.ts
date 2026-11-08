import type { ProxyEntry } from "./bridge";
import type { Severity } from "@/stores/findings";

export interface PassiveIssue {
  checkId: string;
  title: string;
  severity: Severity;
  detail: string;
  pocRequest?: string;
  pocResponse?: string;
  remediation?: string;
}

function header(pairs: [string, string][], name: string): string | null {
  const found = pairs.find(([n]) => n.toLowerCase() === name.toLowerCase());
  return found ? found[1] : null;
}

export function passiveChecks(entry: ProxyEntry): PassiveIssue[] {
  const issues: PassiveIssue[] = [];
  if (entry.websocket) return issues;

  const res = entry.resHeaders ?? [];
  const req = entry.reqHeaders ?? [];
  const contentType = (header(res, "content-type") || "").toLowerCase();
  const isHtml = contentType.includes("text/html");
  const isHttps = entry.scheme === "https";
  const ok = entry.status >= 200 && entry.status < 400;
  const at = (extra: string) => `${entry.url}\n${extra}`;

  const rawRequest =
    `${entry.method} ${entry.url} HTTP/1.1\n` +
    req.map(([n, v]) => `${n}: ${v}`).join("\n") +
    (entry.reqBody ? `\n\n${entry.reqBody}` : "");

  const rawResponse =
    `HTTP/1.1 ${entry.status}\n` +
    res.map(([n, v]) => `${n}: ${v}`).join("\n") +
    (entry.resBody ? `\n\n${entry.resBody.slice(0, 4000)}` : "");

  if (ok && isHtml && !header(res, "content-security-policy")) {
    issues.push({
      checkId: "no-csp",
      title: "Missing Content-Security-Policy",
      severity: "medium",
      detail: at("No Content-Security-Policy header on an HTML response."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Define a strict Content-Security-Policy header restricting script sources, object-src, and frame ancestors.",
    });
  }

  if (ok && isHttps && !header(res, "strict-transport-security")) {
    issues.push({
      checkId: "no-hsts",
      title: "Missing Strict-Transport-Security",
      severity: "low",
      detail: at("HTTPS response with no HSTS header."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Add Strict-Transport-Security: max-age=31536000; includeSubDomains to enforce HTTPS.",
    });
  }

  if (ok && !header(res, "x-content-type-options")) {
    issues.push({
      checkId: "no-nosniff",
      title: "Missing X-Content-Type-Options",
      severity: "low",
      detail: at("No X-Content-Type-Options: nosniff."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Add X-Content-Type-Options: nosniff to prevent MIME type sniffing.",
    });
  }

  if (ok && isHtml && !header(res, "x-frame-options") && !/frame-ancestors/i.test(header(res, "content-security-policy") || "")) {
    issues.push({
      checkId: "no-framing",
      title: "Missing clickjacking protection",
      severity: "low",
      detail: at("No X-Frame-Options and no frame-ancestors in CSP."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Add X-Frame-Options: DENY or frame-ancestors 'none' in CSP.",
    });
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
        pocRequest: rawRequest,
        pocResponse: rawResponse,
        remediation: "Configure session and authentication cookies with HttpOnly, Secure, and SameSite=Lax or SameSite=Strict flags.",
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
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Disable banner broadcasting in server configuration or strip Server and X-Powered-By headers.",
    });
  }

  const csp = header(res, "content-security-policy") || "";
  if (ok && isHtml && !header(res, "referrer-policy")) {
    issues.push({
      checkId: "no-referrer-policy",
      title: "Missing Referrer-Policy",
      severity: "low",
      detail: at("No Referrer-Policy header on an HTML response."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Set Referrer-Policy: strict-origin-when-cross-origin to prevent leakage of path and query params.",
    });
  }

  if (ok && isHtml && !header(res, "permissions-policy")) {
    issues.push({
      checkId: "no-permissions-policy",
      title: "Missing Permissions-Policy",
      severity: "info",
      detail: at("No Permissions-Policy header."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Define Permissions-Policy header to disable unused browser capabilities such as geolocation and camera.",
    });
  }

  if (csp && /(unsafe-inline|unsafe-eval|script-src[^;]*\*)/i.test(csp)) {
    issues.push({
      checkId: "weak-csp",
      title: "Weak Content-Security-Policy",
      severity: "medium",
      detail: at(`CSP allows unsafe-inline / unsafe-eval or a wildcard source:\n${csp.slice(0, 300)}`),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Remove unsafe-inline and unsafe-eval from script-src; use cryptographic nonces or hashes.",
    });
  }

  const corsOrigin = header(res, "access-control-allow-origin");
  const corsCreds = (header(res, "access-control-allow-credentials") || "").toLowerCase() === "true";
  if (corsOrigin === "*") {
    issues.push({
      checkId: "cors-wildcard",
      title: "CORS allows any origin (*)",
      severity: "medium",
      detail: at("Access-Control-Allow-Origin: *"),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Restrict Access-Control-Allow-Origin to trusted explicit origins rather than wildcard.",
    });
  } else if ((corsOrigin === "null" || (corsOrigin && header(req, "origin") === corsOrigin)) && corsCreds) {
    issues.push({
      checkId: "cors-reflected-creds",
      title: "CORS arbitrary origin reflection with credentials",
      severity: "high",
      detail: at(`Access-Control-Allow-Origin: ${corsOrigin} with Access-Control-Allow-Credentials: true`),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Validate requested Origin against an explicit whitelist before echoing in Access-Control-Allow-Origin.",
    });
  }

  const body = entry.resBody || "";
  if (isHttps && isHtml && /\b(?:src|href)\s*=\s*["']http:\/\//i.test(body)) {
    issues.push({
      checkId: "mixed-content",
      title: "Mixed content on an HTTPS page",
      severity: "medium",
      detail: at("An HTTPS page references http:// resources."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Migrate all referenced assets to HTTPS schemes.",
    });
  }

  if (ok && /<title>\s*Index of \//i.test(body)) {
    issues.push({
      checkId: "dir-listing",
      title: "Directory listing exposed",
      severity: "medium",
      detail: at("The response looks like an auto-generated directory index."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Disable directory indexing options in web server configuration.",
    });
  }

  if (/(Traceback \(most recent call last\)|\bat [a-zA-Z0-9_.$]+\([A-Za-z0-9_.]+\.java:\d+\)|Warning: [a-z_]+\(\)|Fatal error:|Uncaught \w+Exception|System\.[A-Za-z.]+Exception:|org\.springframework\.)/.test(body)) {
    issues.push({
      checkId: "verbose-error",
      title: "Verbose error / stack trace",
      severity: "low",
      detail: at("A stack trace or framework error is exposed in the response."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Disable detailed error messages and debug mode in production environment.",
    });
  }

  if (/[?&](?:token|api_?key|apikey|password|passwd|secret|sessionid|session_id|access_token|auth)=/i.test(entry.url)) {
    issues.push({
      checkId: "secret-in-url",
      title: "Sensitive data in URL",
      severity: "medium",
      detail: at("A token/secret/credential appears in the query string (logged, cached, sent in Referer)."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Transmit authentication tokens and secrets via HTTP Authorization request headers or request bodies.",
    });
  }

  if (isHtml && /type\s*=\s*["']password["']/i.test(body) && !/autocomplete\s*=\s*["']off["']/i.test(body)) {
    issues.push({
      checkId: "autocomplete-password",
      title: "Password field allows autocomplete",
      severity: "info",
      detail: at("A password input without autocomplete=off."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Add autocomplete='off' attribute to sensitive password fields.",
    });
  }

  if (!isHttps && isHtml && /type\s*=\s*["']password["']/i.test(body)) {
    issues.push({
      checkId: "http-login",
      title: "Password form over plain HTTP",
      severity: "high",
      detail: at("A password field is served over http:// — credentials would go in cleartext."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Serve all login and authentication forms strictly over TLS/HTTPS.",
    });
  }

  if (/AKIA[0-9A-Z]{16}/.test(body)) {
    issues.push({
      checkId: "leaked-aws-key",
      title: "Leaked AWS Access Key ID",
      severity: "critical",
      detail: at("Response body contains an AWS Access Key ID pattern (AKIA...)."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Rotate the compromised AWS credentials immediately and remove credentials from responses.",
    });
  }

  if (/gh[pousr]_[A-Za-z0-9_]{36,}/.test(body)) {
    issues.push({
      checkId: "leaked-github-token",
      title: "Leaked GitHub Personal Access Token",
      severity: "critical",
      detail: at("Response body contains a GitHub token pattern (ghp_...)."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Revoke the exposed GitHub token immediately in GitHub settings.",
    });
  }

  if (/-----BEGIN (?:RSA|EC|DSA|OPENSSH|PRIVATE) KEY-----/.test(body)) {
    issues.push({
      checkId: "leaked-private-key",
      title: "Exposed Private Key",
      severity: "critical",
      detail: at("Response body contains a PEM-formatted private key."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Revoke and replace the private key and prevent server files from being served publicly.",
    });
  }

  if (/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})/.test(body)) {
    issues.push({
      checkId: "internal-ip-disclosure",
      title: "Internal IP address disclosure",
      severity: "low",
      detail: at("Response body exposes private RFC 1918 internal IP addresses."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Sanitize internal networking details and IP addresses before returning responses.",
    });
  }

  const hasCookieOrAuth = header(res, "set-cookie") || header(req, "authorization");
  const cacheControl = (header(res, "cache-control") || "").toLowerCase();
  if (hasCookieOrAuth && !cacheControl.includes("no-store") && !cacheControl.includes("private")) {
    issues.push({
      checkId: "sensitive-cache-control",
      title: "Sensitive response missing Cache-Control: no-store",
      severity: "low",
      detail: at("Response sets cookies or handles authenticated requests without Cache-Control: no-store."),
      pocRequest: rawRequest,
      pocResponse: rawResponse,
      remediation: "Send Cache-Control: no-store, no-cache, must-revalidate on authenticated endpoints.",
    });
  }

  return issues;
}
