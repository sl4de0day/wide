import { bridge } from "@/lib/bridge";

export interface RouteEntry {
  method: string;
  path: string;
  file: string;
  relativePath: string;
  line: number;
  column: number;
  framework: string;
}

interface Extractor {
  framework: string;
  re: RegExp;
  method: (match: RegExpExecArray) => string;
  path: (match: RegExpExecArray) => string;
  fileHint?: RegExp;
}

const ANY = "";

const EXTRACTORS: Extractor[] = [
  {
    framework: "Express/Node",
    re: /\b(?:app|router|api|server|route|_?router)\s*\.\s*(get|post|put|delete|patch|options|head|all)\s*\(\s*(['"`])([^'"`]+)\2/i,
    method: (m) => (m[1].toLowerCase() === "all" ? ANY : m[1].toUpperCase()),
    path: (m) => m[3],
  },
  {
    framework: "FastAPI/Flask",
    re: /@\s*[\w.]+\.\s*(get|post|put|delete|patch|route|websocket)\s*\(\s*(['"])([^'"]+)\2/i,
    method: (m) => (m[1].toLowerCase() === "route" || m[1].toLowerCase() === "websocket" ? ANY : m[1].toUpperCase()),
    path: (m) => m[3],
  },
  {
    framework: "Django",
    re: /\b(?:path|re_path|url)\s*\(\s*(['"])([^'"]+)\1/,
    method: () => ANY,
    path: (m) => m[2],
    fileHint: /urls?\.py$/i,
  },
  {
    framework: "Laravel",
    re: /Route::\s*(get|post|put|delete|patch|any|match|options)\s*\(\s*(['"])([^'"]+)\2/i,
    method: (m) => (["any", "match"].includes(m[1].toLowerCase()) ? ANY : m[1].toUpperCase()),
    path: (m) => m[3],
  },
  {
    framework: "Spring",
    re: /@\s*(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?(['"])([^'"]+)\2/,
    method: (m) => (m[1] === "Request" ? ANY : m[1].toUpperCase()),
    path: (m) => m[3],
  },
  {
    framework: "Rails",
    re: /\b(get|post|put|patch|delete)\s+(['"])([^'"]+)\2/,
    method: (m) => m[1].toUpperCase(),
    path: (m) => m[3],
    fileHint: /routes\.rb$/,
  },
  {
    framework: "Go",
    re: /\.\s*(GET|POST|PUT|DELETE|PATCH|Handle|HandleFunc)\s*\(\s*(['"`])([^'"`]+)\2/,
    method: (m) => (m[1] === "Handle" || m[1] === "HandleFunc" ? ANY : m[1].toUpperCase()),
    path: (m) => m[3],
  },
];

const SEARCH_QUERY =
  "(\\.(get|post|put|delete|patch|options|head|all|GET|POST|PUT|DELETE|PATCH|Handle|HandleFunc)\\s*\\()" +
  "|(@[\\w.]+\\.(get|post|put|delete|patch|route|websocket)\\s*\\()" +
  "|(\\b(path|re_path|url)\\s*\\()" +
  "|(Route::\\s*(get|post|put|delete|patch|any|match|options))" +
  "|(@(Get|Post|Put|Delete|Patch|Request)Mapping)";

function normalizePath(path: string): string {
  let out = path.trim();
  const q = out.search(/[?#]/);
  if (q >= 0) out = out.slice(0, q);
  if (!out.startsWith("/")) out = `/${out}`;
  out = out.replace(/\/+$/, "");
  return out || "/";
}

function segments(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

function isParam(segment: string): boolean {
  return (
    segment.startsWith(":") ||
    (segment.startsWith("{") && segment.endsWith("}")) ||
    (segment.startsWith("<") && segment.endsWith(">")) ||
    segment === "*" ||
    segment.startsWith("*") ||
    segment.includes("(") ||
    segment.includes("%")
  );
}

const cache = new Map<string, RouteEntry[]>();

export async function buildRouteIndex(root: string, force = false): Promise<RouteEntry[]> {
  if (!force && cache.has(root)) return cache.get(root)!;
  const routes: RouteEntry[] = [];
  try {
    const result = await bridge.searchInFiles(root, {
      query: SEARCH_QUERY,
      regexp: true,
      caseSensitive: false,
      wholeWord: false,
    });
    for (const file of result.files ?? []) {
      for (const hit of file.matches) {
        const line = hit.preview ?? "";
        for (const extractor of EXTRACTORS) {
          if (extractor.fileHint && !extractor.fileHint.test(file.path)) continue;
          const match = extractor.re.exec(line);
          if (!match) continue;
          const path = extractor.path(match);
          if (!path || (!path.startsWith("/") && !/^\w/.test(path))) continue;
          routes.push({
            method: extractor.method(match),
            path: normalizePath(path),
            file: file.path,
            relativePath: file.relativePath,
            line: hit.line,
            column: hit.column,
            framework: extractor.framework,
          });
          break;
        }
      }
    }
  } catch {

  }
  cache.set(root, routes);
  return routes;
}

export function clearRouteIndex(root?: string): void {
  if (root) cache.delete(root);
  else cache.clear();
}

export function matchRoute(index: RouteEntry[], method: string, requestPath: string): RouteEntry | null {
  const wanted = segments(requestPath);
  const wantedMethod = method.toUpperCase();
  let best: RouteEntry | null = null;
  let bestScore = -1;
  for (const entry of index) {
    const route = segments(entry.path);
    if (route.length !== wanted.length && !route.some((s) => s === "*" || s.startsWith("*"))) continue;
    let ok = true;
    let statics = 0;
    for (let i = 0; i < route.length; i += 1) {
      const rs = route[i];
      if (rs === "*" || rs.startsWith("*")) {
        break;
      }
      const ws = wanted[i];
      if (ws === undefined) {
        ok = false;
        break;
      }
      if (isParam(rs)) continue;
      if (rs.toLowerCase() !== ws.toLowerCase()) {
        ok = false;
        break;
      }
      statics += 1;
    }
    if (!ok) continue;
    const methodOk = entry.method === ANY || entry.method === wantedMethod;
    const score = statics * 10 + (entry.method === wantedMethod ? 5 : 0) + (route.length === wanted.length ? 1 : 0);
    if (!methodOk && entry.method !== ANY) continue;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}
