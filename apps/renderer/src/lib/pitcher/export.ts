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
