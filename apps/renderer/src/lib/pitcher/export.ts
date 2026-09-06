import type { Collection, Node, PitcherRequest } from "@/stores/pitcher";

export function exportCollectionJson(collection: Collection): string {
  return JSON.stringify({ _wide: "pitcher-collection", version: 1, collection }, null, 2);
}

function requestToHttp(req: PitcherRequest): string {
  const lines: string[] = [];
  if (req.name) lines.push(`### ${req.name}`);
  lines.push(`${req.method.toUpperCase()} ${urlWithParams(req)}`);
  for (const h of req.headers) if (h.enabled && h.key.trim()) lines.push(`${h.key}: ${h.value}`);
  const body = bodyText(req);
  if (body) {
    lines.push("");
    lines.push(body);
  }
  return lines.join("\n");
}

function urlWithParams(req: PitcherRequest): string {
  const qp = req.params.filter((p) => p.enabled && p.key.trim());
  if (qp.length === 0) return req.url;
  const q = qp.map((p) => `${p.key}=${p.value}`).join("&");
  return req.url + (req.url.includes("?") ? "&" : "?") + q;
}

function bodyText(req: PitcherRequest): string {
  const b = req.body;
  if (b.mode === "raw") return b.raw;
  if (b.mode === "form") return b.form.filter((p) => p.enabled).map((p) => `${p.key}=${p.value}`).join("&");
  if (b.mode === "graphql") return JSON.stringify({ query: b.graphql.query, variables: safeParse(b.graphql.variables) });
  return "";
}
function safeParse(s: string): unknown {
  try {
    return s.trim() ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

export function exportCollectionHttp(collection: Collection): string {
  const out: string[] = [];
  if (collection.vars.length) {
    for (const v of collection.vars) if (v.enabled && v.key.trim()) out.push(`@${v.key} = ${v.value}`);
    out.push("");
  }
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.kind === "folder") walk(n.nodes);
      else {
        out.push(requestToHttp(n.request));
        out.push("");
      }
    }
  };
  walk(collection.nodes);
  return out.join("\n");
}

export function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pmAuthOf(req: PitcherRequest): Record<string, unknown> | undefined {
  const a = req.auth;
  if (a.type === "bearer") return { type: "bearer", bearer: [{ key: "token", value: a.bearer, type: "string" }] };
  if (a.type === "basic")
    return { type: "basic", basic: [
      { key: "username", value: a.basic.username, type: "string" },
      { key: "password", value: a.basic.password, type: "string" },
    ] };
  if (a.type === "apikey")
    return { type: "apikey", apikey: [
      { key: "key", value: a.apikey.key, type: "string" },
      { key: "value", value: a.apikey.value, type: "string" },
      { key: "in", value: a.apikey.in, type: "string" },
    ] };
  if (a.type === "digest")
    return { type: "digest", digest: [
      { key: "username", value: a.digest.username, type: "string" },
      { key: "password", value: a.digest.password, type: "string" },
    ] };
  if (a.type === "awssigv4")
    return { type: "awsv4", awsv4: [
      { key: "accessKey", value: a.aws.accessKey, type: "string" },
      { key: "secretKey", value: a.aws.secretKey, type: "string" },
      { key: "region", value: a.aws.region, type: "string" },
      { key: "service", value: a.aws.service, type: "string" },
    ] };
  if (a.type === "oauth2")
    return { type: "oauth2", oauth2: [{ key: "accessToken", value: a.oauth2.token, type: "string" }] };
  return undefined;
}

function pmBodyOf(req: PitcherRequest): Record<string, unknown> | undefined {
  const b = req.body;
  if (b.mode === "raw") {
    const language = b.rawType === "json" || b.rawType === "xml" || b.rawType === "html" ? b.rawType : "text";
    return { mode: "raw", raw: b.raw, options: { raw: { language } } };
  }
  if (b.mode === "form")
    return { mode: "urlencoded", urlencoded: b.form.map((p) => ({ key: p.key, value: p.value, disabled: !p.enabled })) };
  if (b.mode === "multipart")
    return { mode: "formdata", formdata: b.form.map((p) => ({ key: p.key, value: p.value, type: "text", disabled: !p.enabled })) };
  if (b.mode === "graphql")
    return { mode: "graphql", graphql: { query: b.graphql.query, variables: b.graphql.variables } };
  return undefined;
}

function pmEventOf(req: PitcherRequest): Record<string, unknown>[] | undefined {
  const events: Record<string, unknown>[] = [];
  if (req.preScript.trim())
    events.push({ listen: "prerequest", script: { type: "text/javascript", exec: req.preScript.split("\n") } });
  if (req.testScript.trim())
    events.push({ listen: "test", script: { type: "text/javascript", exec: req.testScript.split("\n") } });
  return events.length ? events : undefined;
}

function pmItemOf(req: PitcherRequest): Record<string, unknown> {
  const headers = req.headers
    .filter((h) => h.key.trim())
    .map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled }));
  const query = req.params
    .filter((p) => p.key.trim())
    .map((p) => ({ key: p.key, value: p.value, disabled: !p.enabled }));
  const bare = req.url.split("?")[0];
  const request: Record<string, unknown> = {
    method: req.method.toUpperCase(),
    header: headers,
    url: { raw: urlWithParams(req), query },
  };
  const auth = pmAuthOf(req);
  if (auth) request.auth = auth;
  const body = pmBodyOf(req);
  if (body) request.body = body;
  const item: Record<string, unknown> = { name: req.name || req.url || "Request", request };
  const event = pmEventOf(req);
  if (event) item.event = event;
  void bare;
  return item;
}

export function exportPostmanV21(collection: Collection): string {
  const walk = (nodes: Node[]): Record<string, unknown>[] =>
    nodes.map((n) =>
      n.kind === "folder" ? { name: n.name, item: walk(n.nodes) } : pmItemOf(n.request),
    );
  const doc = {
    info: {
      name: collection.name,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      _postman_id: collection.id,
    },
    item: walk(collection.nodes),
    variable: collection.vars
      .filter((v) => v.key.trim())
      .map((v) => ({ key: v.key, value: v.value, disabled: !v.enabled })),
  };
  return JSON.stringify(doc, null, 2);
}
