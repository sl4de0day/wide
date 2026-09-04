import { bridge } from "@/lib/bridge";

import { resolveVars } from "./vars";

const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args { name type { ...TypeRef } }
        type { ...TypeRef }
      }
    }
  }
}
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name } } }
}`;

export interface GqlField {
  name: string;
  description?: string;
  type: string;
  args: { name: string; type: string }[];
}
export interface GqlType {
  name: string;
  kind: string;
  description?: string;
  fields: GqlField[];
}
export interface GqlSchema {
  queryType?: string;
  mutationType?: string;
  subscriptionType?: string;
  types: GqlType[];
}

interface RawTypeRef {
  kind: string;
  name: string | null;
  ofType?: RawTypeRef | null;
}

function typeRefName(ref: RawTypeRef | null | undefined): string {
  if (!ref) return "";
  if (ref.kind === "NON_NULL") return `${typeRefName(ref.ofType)}!`;
  if (ref.kind === "LIST") return `[${typeRefName(ref.ofType)}]`;
  return ref.name ?? "";
}

export async function introspect(url: string, headers: [string, string][], vars: Record<string, string>): Promise<{ ok: boolean; schema?: GqlSchema; error?: string }> {
  const resolvedUrl = resolveVars(url, vars);
  const hdrs: [string, string][] = [["Content-Type", "application/json"], ...headers.map(([k, v]) => [resolveVars(k, vars), resolveVars(v, vars)] as [string, string])];
  const reply = await bridge.httpSend(resolvedUrl, "POST", hdrs, JSON.stringify({ query: INTROSPECTION_QUERY }));
  if (!reply.ok) return { ok: false, error: reply.error };
  try {
    const json = JSON.parse(reply.body);
    const s = json?.data?.__schema;
    if (!s) return { ok: false, error: json?.errors ? JSON.stringify(json.errors) : "No __schema in response." };
    const types: GqlType[] = (s.types as RawTypeRef[] & { fields?: unknown }[])
      .filter((tp) => (tp.name ?? "").length > 0 && !(tp.name as string).startsWith("__"))
      .map((tp) => {
        const raw = tp as unknown as { name: string; kind: string; description?: string; fields?: { name: string; description?: string; type: RawTypeRef; args?: { name: string; type: RawTypeRef }[] }[] };
        return {
          name: raw.name,
          kind: raw.kind,
          description: raw.description ?? undefined,
          fields: (raw.fields ?? []).map((f) => ({
            name: f.name,
            description: f.description ?? undefined,
            type: typeRefName(f.type),
            args: (f.args ?? []).map((a) => ({ name: a.name, type: typeRefName(a.type) })),
          })),
        };
      });
    return {
      ok: true,
      schema: {
        queryType: s.queryType?.name,
        mutationType: s.mutationType?.name,
        subscriptionType: s.subscriptionType?.name,
        types,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
