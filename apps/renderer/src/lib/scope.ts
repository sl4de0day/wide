

export function hostInScope(host: string, scope: string[]): boolean {
  const h = host.toLowerCase();
  return scope.some((raw) => {
    const rule = raw.toLowerCase().trim();
    if (!rule) return false;
    if (rule.startsWith("*.")) {
      const bare = rule.slice(2);
      return h === bare || h.endsWith(`.${bare}`);
    }
    return h === rule;
  });
}
