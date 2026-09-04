import type { Collection, Node, PitcherRequest } from "@/stores/pitcher";

function authLine(req: PitcherRequest): string | null {
  const a = req.auth;
  switch (a.type) {
    case "bearer":
      return `Bearer \`${a.bearer || "{{token}}"}\``;
    case "basic":
      return `Basic — user \`${a.basic.username}\``;
    case "apikey":
      return `API key \`${a.apikey.key}\` in ${a.apikey.in}`;
    case "oauth2":
      return `OAuth 2.0 (${a.oauth2.grant})`;
    case "digest":
      return "Digest";
    case "awssigv4":
      return `AWS SigV4 (${a.aws.service}/${a.aws.region})`;
    default:
      return null;
  }
}

function bodyBlock(req: PitcherRequest): string | null {
  const b = req.body;
  if (b.mode === "raw" && b.raw.trim()) return "```" + b.rawType + "\n" + b.raw + "\n```";
  if (b.mode === "form" && b.form.length) return "```\n" + b.form.filter((p) => p.enabled).map((p) => `${p.key}=${p.value}`).join("\n") + "\n```";
  if (b.mode === "graphql" && b.graphql.query.trim()) return "```graphql\n" + b.graphql.query + "\n```";
  return null;
}

function requestSection(req: PitcherRequest, depth: number): string {
  const out: string[] = [];
  const heading = "#".repeat(Math.min(depth, 6));
  out.push(`${heading} ${req.name}`);
  out.push("");
  out.push(`\`${req.method.toUpperCase()}\` \`${req.url}\``);
  out.push("");

  const params = req.params.filter((p) => p.enabled && p.key.trim());
  if (params.length) {
    out.push("**Query parameters**");
    out.push("");
    out.push("| Name | Value |");
    out.push("| --- | --- |");
    for (const p of params) out.push(`| \`${p.key}\` | \`${p.value}\` |`);
    out.push("");
  }

  const headers = req.headers.filter((h) => h.enabled && h.key.trim());
  if (headers.length) {
    out.push("**Headers**");
    out.push("");
    out.push("| Header | Value |");
    out.push("| --- | --- |");
    for (const h of headers) out.push(`| \`${h.key}\` | \`${h.value}\` |`);
    out.push("");
  }

  const auth = authLine(req);
  if (auth) {
    out.push(`**Auth:** ${auth}`);
    out.push("");
  }

  const body = bodyBlock(req);
  if (body) {
    out.push("**Body**");
    out.push("");
    out.push(body);
    out.push("");
  }
  return out.join("\n");
}

function walk(nodes: Node[], depth: number, out: string[]): void {
  for (const n of nodes) {
    if (n.kind === "folder") {
      out.push(`${"#".repeat(Math.min(depth, 6))} ${n.name}`);
      out.push("");
      walk(n.nodes, depth + 1, out);
    } else {
      out.push(requestSection(n.request, depth));
    }
  }
}

export function collectionToMarkdown(collection: Collection): string {
  const out: string[] = [`# ${collection.name}`, ""];
  const vars = collection.vars.filter((v) => v.key.trim());
  if (vars.length) {
    out.push("## Variables");
    out.push("");
    out.push("| Variable | Value |");
    out.push("| --- | --- |");
    for (const v of vars) out.push(`| \`{{${v.key}}}\` | \`${v.value}\` |`);
    out.push("");
  }
  walk(collection.nodes, 2, out);
  return out.join("\n");
}
