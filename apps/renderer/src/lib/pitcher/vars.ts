

function fallbackGuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function dynamicVar(name: string): string | null {
  switch (name) {
    case "$guid":
    case "$randomUUID":
      return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : fallbackGuid();
    case "$timestamp":
      return String(Math.floor(Date.now() / 1000));
    case "$isoTimestamp":
      return new Date().toISOString();
    case "$randomInt":
      return String(Math.floor(Math.random() * 1000));
    default:
      return null;
  }
}

export function resolveVars(text: string, vars: Record<string, string>): string {
  if (!text) return text;
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, name: string) => {
    if (name.startsWith("$")) {
      const d = dynamicVar(name);
      return d ?? whole;
    }
    return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole;
  });
}
