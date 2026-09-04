

export interface HttpMessage {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}

export function parseHttpMessage(text: string): HttpMessage | null {
  const normalised = text.replace(/\r\n/g, "\n");
  const blank = normalised.indexOf("\n\n");
  const head = blank === -1 ? normalised : normalised.slice(0, blank);
  const body = blank === -1 ? "" : normalised.slice(blank + 2);
  const lines = head.split("\n");
  const first = lines.shift()?.trim() ?? "";
  const match = first.match(/^([A-Z]+)\s+(\S+)/);
  if (!match) return null;
  const headers: [string, string][] = [];
  for (const line of lines) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  return { method: match[1], url: match[2], headers, body };
}

export function serializeHttpMessage(message: {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}): string {
  const lines = [`${message.method} ${message.url}`, ...message.headers.map(([name, value]) => `${name}: ${value}`)];
  return `${lines.join("\n")}\n\n${message.body ?? ""}`;
}

export function hasHeader(headers: [string, string][], name: string): boolean {
  const lower = name.toLowerCase();
  return headers.some(([n]) => n.toLowerCase() === lower);
}

export function setHeader(headers: [string, string][], name: string, value: string): [string, string][] {
  const lower = name.toLowerCase();
  let found = false;
  const next = headers.map(([n, v]): [string, string] => {
    if (n.toLowerCase() === lower && !found) {
      found = true;
      return [n, value];
    }
    return [n, v];
  });
  if (!found) next.push([name, value]);
  return next;
}
