import type { Text } from "@codemirror/state";

import type { Diagnostic } from "@/lib/bridge";

const ROUTE_DEF = /\b(?:app|router|api|server)\s*\.\s*(get|post|put|delete|patch|all)\s*\(\s*(['"`])([^'"`]+)\2([^\n]*)/;

const AUTH_MARKER =
  /req\.(?:user|session|auth|userId|currentUser)\b|authenticat|requireAuth|requireLogin|isAuthenticated|verifyToken|verifyJwt|jwt\.verify|passport|authMiddleware|ensureAuth|checkAuth|authoriz|getSession|headers\.authorization|headers\[["']authorization|bearer|withAuth|\bprotect\b|\bguard\b/i;

const RATELIMIT_MARKER = /rate[_-]?limit|slowDown|slow-down|\bthrottl|\blimiter\b|RateLimit|express-rate-limit/i;

const SENSITIVE_PATH = /login|signin|sign-in|otp|verify|reset|recover|password|forgot|2fa|mfa/i;

const SKIP_AUTH_PATH =
  /login|signin|sign-in|register|signup|sign-up|forgot|reset|recover|health|ping|status|metrics|public|docs|swagger|well-known|refresh|logout|csrf|captcha/i;

function isComment(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

export function runRouteAudit(doc: Text): Diagnostic[] {
  const full = doc.toString();
  if (!ROUTE_DEF.test(full)) return [];
  const fileHasRateLimit = RATELIMIT_MARKER.test(full);

  type Route = { line: number; method: string; path: string; rest: string; from: number; to: number };
  const routes: Route[] = [];
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    if (isComment(line.text)) continue;
    const m = ROUTE_DEF.exec(line.text);
    if (!m) continue;
    const open = m[0].indexOf(m[2]);
    const close = m[0].indexOf(m[2], open + 1);
    const from = line.from + m.index;
    routes.push({
      line: n,
      method: m[1].toLowerCase(),
      path: m[3],
      rest: m[4] ?? "",
      from,
      to: line.from + m.index + (close >= 0 ? close + 1 : m[0].length),
    });
  }
  if (routes.length === 0) return [];

  const found: Diagnostic[] = [];
  routes.forEach((route, index) => {
    const endLine = index + 1 < routes.length ? routes[index + 1].line : Math.min(route.line + 40, doc.lines);
    let body = route.rest;
    for (let k = route.line + 1; k < endLine; k += 1) body += `\n${doc.line(k).text}`;

    const authNearby = AUTH_MARKER.test(route.rest) || AUTH_MARKER.test(body);
    const readsInput = /req\.(?:params|query|body)\b/.test(body);
    const skipAuth = SKIP_AUTH_PATH.test(route.path) || route.path === "/";

    if (!authNearby && !skipAuth && (readsInput || route.method !== "get")) {
      found.push({
        from: route.from,
        to: route.to,
        severity: "info",
        message:
          `This ${route.method.toUpperCase()} ${route.path} route has no visible authentication check.` +
          `\n\nA handler that reads request parameters and returns data with no session/token check lets an ` +
          `anonymous caller change an id and read another user's data (broken access control / IDOR).` +
          `\n\nFix: put an auth middleware on the route (requireAuth) or verify req.user/session before using an id.` +
          `\n\nCWE-306 · (wide/route-missing-auth)`,
      });
    }
    if (SENSITIVE_PATH.test(route.path) && !fileHasRateLimit) {
      found.push({
        from: route.from,
        to: route.to,
        severity: "info",
        message:
          `This ${route.method.toUpperCase()} ${route.path} route has no visible rate limiter.` +
          `\n\nA login/OTP/reset endpoint with no per-IP/per-account limit can be brute-forced — a 4-digit OTP ` +
          `falls in seconds.` +
          `\n\nFix: add a rate limiter (express-rate-limit / a throttle) to the auth routes.` +
          `\n\nCWE-307 · (wide/route-missing-rate-limit)`,
      });
    }
  });
  return found;
}
