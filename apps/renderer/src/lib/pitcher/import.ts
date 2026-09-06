import { parseCurl } from "@/lib/curl";
import { parseHttpFile } from "@/editor/features/httpFile";
import { newRequest, type Collection, type Node, type Param, type PitcherRequest, type RawType } from "@/stores/pitcher";

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}i`;

function param(key: string, value: string, enabled = true): Param {
  return { key, value: String(value ?? ""), enabled };
}

function mkRequest(name: string, method: string, url: string): PitcherRequest {
  const r = newRequest(name);
  r.method = (method || "GET").toUpperCase();
  r.url = url;
  return r;
}
function reqNode(r: PitcherRequest): Node {
  return { id: uid("n"), kind: "request", request: r };
}
function folderNode(name: string, nodes: Node[]): Node {
  return { id: uid("f"), kind: "folder", name, open: true, nodes };
}
function collection(name: string, nodes: Node[], vars: Param[] = []): Collection {
  return { id: uid("c"), name, nodes, vars };
}

const RAW_BY_MIME = (mime: string | undefined): RawType => {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("json")) return "json";
  if (m.includes("xml")) return "xml";
  if (m.includes("html")) return "html";
  return "text";
};

interface PmUrl {
  raw?: string;
  host?: string[];
  path?: string[];
  query?: { key: string; value: string; disabled?: boolean }[];
}
interface PmRequest {
  method?: string;
  header?: { key: string; value: string; disabled?: boolean }[] | string;
  url?: PmUrl | string;
  body?: {
    mode?: string;
    raw?: string;
    urlencoded?: { key: string; value: string; disabled?: boolean }[];
    formdata?: { key: string; value: string; type?: string; disabled?: boolean }[];
    graphql?: { query?: string; variables?: string };
    options?: { raw?: { language?: string } };
  };
  auth?: PmAuth;
}
interface PmAuth {
  type?: string;
  bearer?: { key: string; value: string }[];
  basic?: { key: string; value: string }[];
  apikey?: { key: string; value: string }[];
  oauth2?: { key: string; value: string }[];
  digest?: { key: string; value: string }[];
  awsv4?: { key: string; value: string }[];
}
interface PmEvent {
  listen?: string;
  script?: { exec?: string[] | string };
}
interface PmItem {
  name?: string;
  item?: PmItem[];
  request?: PmRequest;
  event?: PmEvent[];
}

function pmUrlToString(url: PmUrl | string | undefined): { url: string; query: Param[] } {
  if (!url) return { url: "", query: [] };
  if (typeof url === "string") return { url, query: [] };
  const raw = url.raw ?? [(url.host ?? []).join("."), (url.path ?? []).join("/")].filter(Boolean).join("/");
  const query = (url.query ?? []).map((q) => param(q.key, q.value, !q.disabled));
  const base = raw.split("?")[0];
  return { url: base || raw, query };
}

function pmAuth(auth: PmAuth | undefined, r: PitcherRequest): void {
  if (!auth?.type) return;
  const val = (arr: { key: string; value: string }[] | undefined, k: string): string => arr?.find((x) => x.key === k)?.value ?? "";
  if (auth.type === "bearer") {
    r.auth.type = "bearer";
    r.auth.bearer = val(auth.bearer, "token");
  } else if (auth.type === "basic") {
    r.auth.type = "basic";
    r.auth.basic = { username: val(auth.basic, "username"), password: val(auth.basic, "password") };
  } else if (auth.type === "apikey") {
    r.auth.type = "apikey";
    r.auth.apikey = { key: val(auth.apikey, "key"), value: val(auth.apikey, "value"), in: val(auth.apikey, "in") === "query" ? "query" : "header" };
  } else if (auth.type === "oauth2") {
    r.auth.type = "oauth2";
    r.auth.oauth2 = { ...r.auth.oauth2, token: val(auth.oauth2, "accessToken") || val(auth.oauth2, "token") };
  } else if (auth.type === "digest") {
    r.auth.type = "digest";
    r.auth.digest = { username: val(auth.digest, "username"), password: val(auth.digest, "password") };
  } else if (auth.type === "awsv4") {
    r.auth.type = "awssigv4";
    r.auth.aws = {
      accessKey: val(auth.awsv4, "accessKey"),
      secretKey: val(auth.awsv4, "secretKey"),
      region: val(auth.awsv4, "region"),
      service: val(auth.awsv4, "service"),
    };
  }
}

function pmScript(events: PmEvent[] | undefined, listen: string): string {
  const event = (events ?? []).find((e) => e.listen === listen);
  if (!event || !event.script) return "";
  const exec = event.script.exec;
  return Array.isArray(exec) ? exec.join("\n") : String(exec ?? "");
}

function pmItemToNode(item: PmItem): Node | null {
  if (!item || typeof item !== "object") return null;
  if (item.item) return folderNode(item.name ?? "Folder", item.item.map(pmItemToNode).filter((n): n is Node => n !== null));
  const pr = item.request;
  if (!pr) return null;
  const { url, query } = pmUrlToString(pr.url);
  const r = mkRequest(item.name ?? "Request", pr.method ?? "GET", url);
  r.params = query;
  if (Array.isArray(pr.header)) r.headers = pr.header.map((h) => param(h.key, h.value, !h.disabled));
  const b = pr.body;
  if (b) {
    if (b.mode === "raw" && b.raw != null) {
      r.body.mode = "raw";
      r.body.raw = b.raw;
      const lang = b.options?.raw?.language;
      r.body.rawType = lang === "json" || lang === "xml" || lang === "html" ? lang : "text";
    } else if (b.mode === "urlencoded" && b.urlencoded) {
      r.body.mode = "form";
      r.body.form = b.urlencoded.map((x) => param(x.key, x.value, !x.disabled));
    } else if (b.mode === "formdata" && b.formdata) {
      r.body.mode = "multipart";
      r.body.form = b.formdata.filter((x) => (x.type ?? "text") !== "file").map((x) => param(x.key, x.value, !x.disabled));
    } else if (b.mode === "graphql" && b.graphql) {
      r.body.mode = "graphql";
      r.body.graphql = { query: b.graphql.query ?? "", variables: b.graphql.variables ?? "" };
    }
  }
  pmAuth(pr.auth, r);
  r.preScript = pmScript(item.event, "prerequest");
  r.testScript = pmScript(item.event, "test");
  return reqNode(r);
}

function importPostman(doc: { info?: { name?: string }; item?: PmItem[]; variable?: { key: string; value: string }[] }): Collection[] {
  const nodes = (doc.item ?? []).map(pmItemToNode).filter((n): n is Node => n !== null);
  const vars = (doc.variable ?? []).map((v) => param(v.key, v.value));
  return [collection(doc.info?.name ?? "Imported (Postman)", nodes, vars)];
}

interface InsoResource {
  _id: string;
  _type: string;
  parentId?: string;
  name?: string;
  method?: string;
  url?: string;
  headers?: { name: string; value: string; disabled?: boolean }[];
  parameters?: { name: string; value: string; disabled?: boolean }[];
  body?: { mimeType?: string; text?: string };
}

function importInsomnia(doc: { resources?: InsoResource[] }): Collection[] {
  const resources = doc.resources ?? [];
  const children = (parentId: string): Node[] => {
    const out: Node[] = [];
    for (const res of resources) {
      if (res.parentId !== parentId) continue;
      if (res._type === "request_group") {
        out.push(folderNode(res.name ?? "Folder", children(res._id)));
      } else if (res._type === "request") {
        const r = mkRequest(res.name ?? "Request", res.method ?? "GET", res.url ?? "");
        r.params = (res.parameters ?? []).map((p) => param(p.name, p.value, !p.disabled));
        r.headers = (res.headers ?? []).map((h) => param(h.name, h.value, !h.disabled));
        if (res.body?.text) {
          r.body.mode = "raw";
          r.body.raw = res.body.text;
          r.body.rawType = RAW_BY_MIME(res.body.mimeType);
        }
        out.push(reqNode(r));
      }
    }
    return out;
  };
  const workspaces = resources.filter((r) => r && r._type === "workspace");
  if (workspaces.length === 0) {

    const top = resources.filter((r) => r && r._type === "request" && !resources.some((p) => p && p._id === r.parentId));
    const nodes = top.map((res) => {
      const r = mkRequest(res.name ?? "Request", res.method ?? "GET", res.url ?? "");
      r.params = (res.parameters ?? []).map((p) => param(p.name, p.value, !p.disabled));
      r.headers = (res.headers ?? []).map((h) => param(h.name, h.value, !h.disabled));
      if (res.body?.text) {
        r.body.mode = "raw";
        r.body.raw = res.body.text;
        r.body.rawType = RAW_BY_MIME(res.body.mimeType);
      }
      return reqNode(r);
    });
    return [collection("Imported (Insomnia)", nodes)];
  }
  return workspaces.map((ws) => collection(ws.name ?? "Imported (Insomnia)", children(ws._id)));
}

interface OpenApiParam {
  name: string;
  in: string;
  required?: boolean;
  example?: unknown;
  schema?: { example?: unknown; default?: unknown };
}
interface OpenApiOp {
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters?: OpenApiParam[];
  requestBody?: { content?: Record<string, unknown> };
}

function importOpenApi(doc: Record<string, unknown>): Collection[] {
  const isV3 = typeof doc.openapi === "string";
  let baseUrl = "";
  if (isV3) {
    const servers = doc.servers as { url?: string }[] | undefined;
    baseUrl = servers?.[0]?.url ?? "";
  } else {
    const scheme = (doc.schemes as string[] | undefined)?.[0] ?? "https";
    const host = (doc.host as string | undefined) ?? "";
    const basePath = (doc.basePath as string | undefined) ?? "";
    baseUrl = host ? `${scheme}://${host}${basePath}` : basePath;
  }
  const info = doc.info as { title?: string } | undefined;
  const paths = (doc.paths as Record<string, Record<string, OpenApiOp>>) ?? {};
  const byTag = new Map<string, Node[]>();
  const untagged: Node[] = [];
  const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

  for (const [path, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== "object") continue;
    for (const method of METHODS) {
      const op = ops[method];
      if (!op) continue;
      const name = op.summary || op.operationId || `${method.toUpperCase()} ${path}`;
      const r = mkRequest(name, method, `{{baseUrl}}${path}`);
      const params = op.parameters ?? [];
      r.params = params
        .filter((p) => p.in === "query")
        .map((p) => param(p.name, String(p.example ?? p.schema?.example ?? p.schema?.default ?? ""), Boolean(p.required)));
      r.headers = params
        .filter((p) => p.in === "header")
        .map((p) => param(p.name, String(p.example ?? p.schema?.example ?? ""), Boolean(p.required)));
      if (op.requestBody?.content) {
        const types = Object.keys(op.requestBody.content);
        if (types.some((t) => t.includes("json"))) {
          r.body.mode = "raw";
          r.body.rawType = "json";
          r.body.raw = "{}";
        }
      }
      const tag = op.tags?.[0];
      if (tag) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag)!.push(reqNode(r));
      } else {
        untagged.push(reqNode(r));
      }
    }
  }
  const nodes: Node[] = [...[...byTag.entries()].map(([tag, ns]) => folderNode(tag, ns)), ...untagged];
  const vars = baseUrl ? [param("baseUrl", baseUrl)] : [];
  return [collection(info?.title ?? "Imported (OpenAPI)", nodes, vars)];
}

interface HarEntry {
  request?: {
    method?: string;
    url?: string;
    headers?: { name: string; value: string }[];
    postData?: { text?: string; mimeType?: string };
  };
}
function importHar(doc: { log?: { entries?: HarEntry[] } }): Collection[] {
  const entries = doc.log?.entries ?? [];
  const nodes = entries.map((e) => {
    const rq = e?.request ?? {};
    let name = rq.url ?? "Request";
    try {
      name = `${rq.method ?? "GET"} ${new URL(rq.url ?? "").pathname}`;
    } catch {

    }
    const r = mkRequest(name, rq.method ?? "GET", (rq.url ?? "").split("?")[0]);
    try {
      const u = new URL(rq.url ?? "");
      r.params = [...u.searchParams.entries()].map(([k, v]) => param(k, v));
    } catch {

    }
    r.headers = (rq.headers ?? []).filter((h) => !h.name.startsWith(":")).map((h) => param(h.name, h.value));
    if (rq.postData?.text) {
      r.body.mode = "raw";
      r.body.raw = rq.postData.text;
      r.body.rawType = RAW_BY_MIME(rq.postData.mimeType);
    }
    return reqNode(r);
  });
  return [collection("Imported (HAR)", nodes)];
}

function importCurl(text: string): Collection[] {
  const parsed = parseCurl(text);
  if (!parsed) return [];
  const r = mkRequest("curl request", parsed.method, parsed.url);
  r.headers = parsed.headers.map(([k, v]) => param(k, v));
  if (parsed.body) {
    r.body.mode = "raw";
    r.body.raw = parsed.body;
    const ct = parsed.headers.find(([n]) => n.toLowerCase() === "content-type")?.[1] ?? "";
    r.body.rawType = RAW_BY_MIME(ct);
  }
  return [collection("Imported (curl)", [reqNode(r)])];
}

function importHttpFile(text: string): Collection[] {
  const file = parseHttpFile(text);
  const nodes = file.requests.map((req) => {
    const r = mkRequest(req.name ?? `${req.method} ${req.url}`, req.method, req.url);
    r.headers = req.headers.map(([k, v]) => param(k, v));
    if (req.body) {
      r.body.mode = "raw";
      r.body.raw = req.body;
      const ct = req.headers.find(([n]) => n.toLowerCase() === "content-type")?.[1] ?? "";
      r.body.rawType = RAW_BY_MIME(ct);
    }
    return reqNode(r);
  });
  const vars = Object.entries(file.variables).map(([k, v]) => param(k, v));
  return [collection("Imported (.http)", nodes, vars)];
}

export function importAny(text: string): { collections: Collection[]; format: string } {

  try {
    const trimmed = text.trim();

    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
      if (/^curl\b/i.test(trimmed)) return { collections: importCurl(trimmed), format: "curl" };
      return { collections: importHttpFile(text), format: "http" };
    }
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(trimmed);
    } catch {
      return { collections: [], format: "unknown" };
    }
    if (!doc || typeof doc !== "object") return { collections: [], format: "unknown" };
    if (doc._wide === "pitcher-collection" && doc.collection && typeof doc.collection === "object") {
      return { collections: [doc.collection as Collection], format: "wide" };
    }
    if (doc.info && doc.item) return { collections: importPostman(doc as Parameters<typeof importPostman>[0]), format: "postman" };
    if (doc._type === "export" || Array.isArray(doc.resources)) return { collections: importInsomnia(doc as { resources?: InsoResource[] }), format: "insomnia" };
    if (doc.openapi || doc.swagger) return { collections: importOpenApi(doc), format: "openapi" };
    if ((doc.log as { entries?: unknown } | undefined)?.entries) return { collections: importHar(doc as { log?: { entries?: HarEntry[] } }), format: "har" };
    return { collections: [], format: "unknown" };
  } catch {
    return { collections: [], format: "unknown" };
  }
}
