import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";

import { useT } from "@/lib/i18n";
import { introspect, type GqlSchema, type GqlType } from "@/lib/pitcher/graphql";
import { cn } from "@/lib/utils";
import { usePitcher, type PitcherRequest } from "@/stores/pitcher";
import { usePitcherEnv } from "@/stores/pitcherEnv";

export function GraphqlSchema({ req, onInsert }: { req: PitcherRequest; onInsert: (snippet: string) => void }) {
  const t = useT();
  const [schema, setSchema] = useState<GqlSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const fetchSchema = async () => {
    setLoading(true);
    setError("");
    const vars = usePitcherEnv.getState().merged(usePitcher.getState().collectionOf(req.id)?.vars ?? []);
    const enabledHeaders = req.headers.filter((h) => h.enabled && h.key.trim()).map((h) => [h.key, h.value] as [string, string]);
    const out = await introspect(req.url, enabledHeaders, vars);
    setLoading(false);
    if (out.ok && out.schema) setSchema(out.schema);
    else setError(out.error ?? "Introspection failed.");
  };

  const toggle = (name: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const rootField = (typeName: string | undefined, kind: string) => {
    if (!typeName || !schema) return null;
    const tp = schema.types.find((x) => x.name === typeName);
    if (!tp) return null;
    return (
      <div className="mb-1">
        <div className="text-[10px] uppercase tracking-wide text-accent">{kind}</div>
        {tp.fields.map((f) => (
          <button
            key={f.name}
            type="button"
            onClick={() => onInsert(`${f.name}${f.args.length ? `(${f.args.map((a) => `${a.name}: `).join(", ")})` : ""} {\n  \n}`)}
            title={`${f.name}: ${f.type}`}
            className="block w-full truncate px-1 py-0.5 text-left font-mono text-[10px] text-fg-dim hover:bg-hover hover:text-fg"
          >
            <span className="text-syn-property">{f.name}</span>
            <span className="text-fg-faint">: {f.type}</span>
          </button>
        ))}
      </div>
    );
  };

  const shown = (schema?.types ?? []).filter((tp) => !filter || tp.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="mt-1 rounded-sm border border-line">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1">
        <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Schema")}</span>
        <button type="button" onClick={() => void fetchSchema()} disabled={loading} className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim hover:bg-hover hover:text-fg disabled:opacity-40">
          <RefreshCw className={cn("size-3", loading && "animate-spin")} strokeWidth={2} />
          {schema ? t("Refresh") : t("Fetch schema")}
        </button>
        {schema && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Filter types…")} className="ml-auto w-32 rounded-sm border border-line bg-canvas px-1.5 py-0.5 text-[10px] text-fg outline-none focus:border-accent" />}
      </div>
      {error && <p className="px-2 py-1 font-mono text-[10px] text-status-error">{t(error)}</p>}
      {schema && (
        <div className="max-h-56 overflow-auto p-1">
          {rootField(schema.queryType, t("Query"))}
          {rootField(schema.mutationType, "Mutation")}
          {rootField(schema.subscriptionType, "Subscription")}
          <div className="mt-1 border-t border-line/50 pt-1">
            {shown.map((tp) => (
              <TypeRow key={tp.name} type={tp} open={open.has(tp.name)} onToggle={() => toggle(tp.name)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TypeRow({ type, open, onToggle }: { type: GqlType; open: boolean; onToggle: () => void }) {
  return (
    <div>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-1 px-1 py-0.5 text-left text-[10px] hover:bg-hover">
        {open ? <ChevronDown className="size-3 text-fg-faint" strokeWidth={2} /> : <ChevronRight className="size-3 text-fg-faint" strokeWidth={2} />}
        <span className="font-mono text-syn-type">{type.name}</span>
        <span className="text-fg-faint">{type.kind.toLowerCase()}</span>
      </button>
      {open && (
        <div className="ml-4 border-l border-line/50 pl-2">
          {type.fields.length === 0 ? (
            <span className="px-1 text-[10px] text-fg-faint">—</span>
          ) : (
            type.fields.map((f) => (
              <div key={f.name} className="truncate px-1 py-0.5 font-mono text-[10px]" title={f.description ?? ""}>
                <span className="text-syn-property">{f.name}</span>
                <span className="text-fg-faint">: {f.type}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
