

export interface HttpRequest {

  line: number;
  name: string | null;
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
}

export interface HttpFile {
  variables: Record<string, string>;
  requests: HttpRequest[];
}

const SEPARATOR = /^\s*###\s*(.*)$/;
const VARIABLE = /^\s*@([A-Za-z0-9_-]+)\s*=\s*(.*)$/;
const REQUEST_LINE = /^\s*([A-Z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?\s*$/;
const HEADER = /^\s*([A-Za-z0-9-]+)\s*:\s*(.*)$/;

const METHODS = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE",
]);

function substitute(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? variables[name]! : whole,
  );
}

export function parseHttpFile(source: string): HttpFile {
  const lines = source.split("\n");
  const variables: Record<string, string> = {};
  const requests: HttpRequest[] = [];

  let pendingName: string | null = null;
  let current: HttpRequest | null = null;
  let inBody = false;
  let body: string[] = [];

  const finish = () => {
    if (!current) return;
    const text = body.join("\n").trim();
    current.body = text.length > 0 ? text : null;
    requests.push(current);
    current = null;
    body = [];
    inBody = false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;

    const separator = SEPARATOR.exec(raw);
    if (separator) {
      finish();
      pendingName = separator[1]!.trim() || null;
      continue;
    }

    if (!current) {
      const variable = VARIABLE.exec(raw);
      if (variable) {
        variables[variable[1]!] = substitute(variable[2]!.trim(), variables);
        continue;
      }
      if (!raw.trim() || raw.trim().startsWith("#") || raw.trim().startsWith("//")) continue;

      const request = REQUEST_LINE.exec(raw);
      if (request && METHODS.has(request[1]!)) {
        current = {
          line: i + 1,
          name: pendingName,
          method: request[1]!,
          url: substitute(request[2]!, variables),
          headers: [],
          body: null,
        };
        pendingName = null;
        continue;
      }

      if (/^\s*https?:\/\/\S+\s*$/.test(raw)) {
        current = {
          line: i + 1,
          name: pendingName,
          method: "GET",
          url: substitute(raw.trim(), variables),
          headers: [],
          body: null,
        };
        pendingName = null;
      }
      continue;
    }

    if (!inBody) {
      if (!raw.trim()) {
        inBody = true;
        continue;
      }
      const header = HEADER.exec(raw);
      if (header) {
        current.headers.push([header[1]!, substitute(header[2]!.trim(), variables)]);
        continue;
      }

      inBody = true;
    }
    body.push(substitute(raw, variables));
  }

  finish();
  return { variables, requests };
}

export function requestAtLine(file: HttpFile, line: number): HttpRequest | null {
  let found: HttpRequest | null = null;
  for (const request of file.requests) {
    if (request.line <= line) found = request;
    else break;
  }
  return found;
}
