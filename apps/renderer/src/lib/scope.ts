/**
 * Mirrors `inScope` in apps/backend/src/59-proxy.js. A bare entry covers the
 * host AND its subdomains; `*.host` means the same thing. Keep the two in step —
 * if they drift, the scope badges lie about what the proxy actually captures.
 */
export function hostInScope(host: string, scope: string[]): boolean {
  const name = String(host || "")
    .toLowerCase()
    .trim()
    .replace(/:\d+$/, "");
  if (!name) return false;

  return scope.some((raw) => {
    const rule = String(raw || "")
      .toLowerCase()
      .trim()
      .replace(/:\d+$/, "");
    if (!rule) return false;
    const base = rule.startsWith("*.") ? rule.slice(2) : rule;
    if (!base) return false;
    return name === base || name.endsWith(`.${base}`);
  });
}
