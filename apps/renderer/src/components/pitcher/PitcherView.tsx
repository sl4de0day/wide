import { Code2, ChevronDown, ChevronRight, Cookie, Download, FolderPlus, Globe, Pencil, Play, Plus, Radar, Send, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HttpBodyView } from "@/components/http/HttpBodyView";
import { loadDockSize, saveDockSize } from "@/lib/dockSize";
import { t, useT } from "@/lib/i18n";
import { promptText } from "@/stores/prompt";
import { sendToIntruder, sendToRepeater, sendToScanner } from "@/lib/pitcher/catcherBridge";
import { executeRequest } from "@/lib/pitcher/execute";
import { collectionToMarkdown } from "@/lib/pitcher/docs";
import { exportCollectionHttp, exportCollectionJson, downloadText } from "@/lib/pitcher/export";
import type { TestResult } from "@/lib/pitcher/pm";
import { type PitcherResponse } from "@/lib/pitcher/send";
import { cn } from "@/lib/utils";
import { usePitcher, type Collection, type Node, type Param, type PitcherRequest, type Protocol } from "@/stores/pitcher";
import { usePitcherEnv } from "@/stores/pitcherEnv";
import { usePitcherHistory } from "@/stores/pitcherHistory";

import { CodeGenDialog } from "./CodeGenDialog";
import { CookieManager } from "./CookieManager";
import { EnvManager } from "./EnvManager";
import { GraphqlSchema } from "./GraphqlSchema";
import { GrpcView } from "./GrpcView";
import { ImportDialog } from "./ImportDialog";
import { RunnerDialog } from "./RunnerDialog";
import { SseView } from "./SseView";
import { WsClient } from "./WsClient";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface RunState {
  sending: boolean;
  resp: PitcherResponse | null;
  tests: TestResult[];
  logs: string[];
  scriptError?: string;
}

function methodTone(m: string): string {
  switch (m) {
    case "GET":
      return "text-emerald-400";
    case "POST":
      return "text-amber-400";
    case "PUT":
    case "PATCH":
      return "text-sky-400";
    case "DELETE":
      return "text-status-error";
    default:
      return "text-fg-dim";
  }
}

function TreeNodes({ nodes, depth, activeTab }: { nodes: Node[]; depth: number; activeTab: string | null }) {
  const t = useT();
  return (
    <>
      {nodes.map((n) =>
        n.kind === "folder" ? (
          <div key={n.id}>
            <div className="group flex items-center gap-1 py-0.5 pr-1 text-[11px] hover:bg-hover" style={{ paddingLeft: depth * 12 + 4 }}>
              <button type="button" onClick={() => usePitcher.getState().toggleFolder(n.id)} className="text-fg-faint hover:text-fg">
                {n.open ? <ChevronDown className="size-3" strokeWidth={2} /> : <ChevronRight className="size-3" strokeWidth={2} />}
              </button>
              <span className="min-w-0 flex-1 truncate text-fg-dim">{n.name}</span>
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                <button type="button" onClick={() => rename(n.id, n.name)} title={t("Rename")} className="text-fg-faint hover:text-fg"><Pencil className="size-3" strokeWidth={2} /></button>
                <button type="button" onClick={() => usePitcher.getState().remove(n.id)} title={t("Delete")} className="text-fg-faint hover:text-status-error">
                  <Trash2 className="size-3" strokeWidth={2} />
                </button>
              </span>
            </div>
            {n.open && <TreeNodes nodes={n.nodes} depth={depth + 1} activeTab={activeTab} />}
          </div>
        ) : (
          <div key={n.id} className="group flex items-center gap-1 py-0.5 pr-1 text-[11px] hover:bg-hover" style={{ paddingLeft: depth * 12 + 16 }}>
            <button type="button" onClick={() => usePitcher.getState().openRequest(n.request.id)} className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-left", activeTab === n.request.id ? "text-fg" : "text-fg-dim")}>
              <span className={cn("shrink-0 font-mono text-[9px] font-semibold", methodTone(n.request.method))}>{n.request.method}</span>
              <span className="min-w-0 flex-1 truncate">{n.request.name}</span>
            </button>
            <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
              <button type="button" onClick={() => rename(n.request.id, n.request.name)} title={t("Rename")} className="text-fg-faint hover:text-fg"><Pencil className="size-3" strokeWidth={2} /></button>
              <button type="button" onClick={() => usePitcher.getState().remove(n.id)} title={t("Delete")} className="text-fg-faint hover:text-status-error">
                <Trash2 className="size-3" strokeWidth={2} />
              </button>
            </span>
          </div>
        ),
      )}
    </>
  );
}

async function rename(id: string, current: string) {
  const name = await promptText({ title: t("Rename"), label: t("Name"), initial: current, confirmLabel: t("Rename") });
  if (name) usePitcher.getState().rename(id, name);
}

function Sidebar({ collections, activeTab, onRun }: { collections: Collection[]; activeTab: string | null; onRun: (c: Collection) => void }) {
  const t = useT();
  return (
    <div className="flex w-56 shrink-0 flex-col border-r border-line bg-chrome">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="flex-1 text-[11px] uppercase tracking-wide text-fg-faint">{t("Collections")}</span>
        <button type="button" onClick={() => usePitcher.getState().newCollection()} title={t("New collection")} className="rounded-sm p-1 text-fg-faint hover:bg-hover hover:text-fg">
          <Plus className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {collections.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-fg-faint">{t("No collections yet. Create one to start.")}</p>
        ) : (
          collections.map((c) => (
            <div key={c.id}>
              <div className="group flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-fg">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                  <button type="button" onClick={() => usePitcher.getState().addRequest(c.id, null)} title={t("New request")} className="text-fg-faint hover:text-fg">
                    <Plus className="size-3" strokeWidth={2} />
                  </button>
                  <button type="button" onClick={() => usePitcher.getState().addFolder(c.id, null)} title={t("New folder")} className="text-fg-faint hover:text-fg">
                    <FolderPlus className="size-3" strokeWidth={2} />
                  </button>
                  <button type="button" onClick={() => onRun(c)} title={t("Run")} className="text-fg-faint hover:text-accent">
                    <Play className="size-3" strokeWidth={2} />
                  </button>
                  <button type="button" onClick={() => downloadText(`${c.name}.pitcher.json`, exportCollectionJson(c))} title={t("Export JSON")} className="text-fg-faint hover:text-fg">
                    <Download className="size-3" strokeWidth={2} />
                  </button>
                  <button type="button" onClick={() => downloadText(`${c.name}.http`, exportCollectionHttp(c), "text/plain")} title={t("Export .http")} className="text-fg-faint hover:text-fg font-mono text-[8px]">.http</button>
                  <button type="button" onClick={() => downloadText(`${c.name}.md`, collectionToMarkdown(c), "text/markdown")} title={t("Export docs (Markdown)")} className="text-fg-faint hover:text-fg font-mono text-[8px]">.md</button>
                  <button type="button" onClick={() => rename(c.id, c.name)} title={t("Rename")} className="text-fg-faint hover:text-fg"><Pencil className="size-3" strokeWidth={2} /></button>
                  <button type="button" onClick={() => usePitcher.getState().remove(c.id)} title={t("Delete")} className="text-fg-faint hover:text-status-error">
                    <Trash2 className="size-3" strokeWidth={2} />
                  </button>
                </span>
              </div>
              <TreeNodes nodes={c.nodes} depth={1} activeTab={activeTab} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ParamTable({ rows, onChange, keyPlaceholder }: { rows: Param[]; onChange: (rows: Param[]) => void; keyPlaceholder?: string }) {
  const t = useT();
  const set = (i: number, patch: Partial<Param>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { key: "", value: "", enabled: true }]);
  return (
    <div className="text-[11px]">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1 border-b border-line/50 py-0.5">
          <input type="checkbox" checked={r.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} className="shrink-0" />
          <input value={r.key} onChange={(e) => set(i, { key: e.target.value })} placeholder={keyPlaceholder ?? t("key")} className="w-2/5 bg-transparent px-1 font-mono text-syn-property outline-none" />
          <input value={r.value} onChange={(e) => set(i, { value: e.target.value })} placeholder={t("value")} className="min-w-0 flex-1 bg-transparent px-1 font-mono text-syn-string outline-none" />
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="shrink-0 px-1 text-fg-faint hover:text-status-error">
            <X className="size-3" strokeWidth={2} />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="mt-1 flex items-center gap-1 px-1 text-[10px] text-fg-faint hover:text-fg">
        <Plus className="size-3" strokeWidth={2} />
        {t("Add row")}
      </button>
    </div>
  );
}

type BuilderTab = "params" | "headers" | "body" | "auth" | "scripts";

function RequestPane({ req, run, onSend, onCode, onSendTo }: { req: PitcherRequest; run: RunState | undefined; onSend: () => void; onCode: () => void; onSendTo: (tool: "repeater" | "intruder" | "scanner") => void }) {
  const t = useT();
  const [tab, setTab] = useState<BuilderTab>("params");
  const update = (patch: Partial<PitcherRequest>) => usePitcher.getState().updateRequest(req.id, patch);
  const sending = run?.sending ?? false;

  const builderRef = useRef<HTMLDivElement>(null);
  const [builderH, setBuilderH] = useState(() => Math.max(120, loadDockSize("wide.pitcher.builderH", 240)));
  const [dragging, setDragging] = useState(false);
  useEffect(() => saveDockSize("wide.pitcher.builderH", builderH), [builderH]);
  const onMove = useCallback((e: PointerEvent) => {
    const top = builderRef.current?.getBoundingClientRect().top ?? 0;
    setBuilderH(Math.max(80, e.clientY - top));
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    const prev = document.body.style.cursor;
    document.body.style.cursor = "row-resize";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = prev;
    };
  }, [dragging, onMove]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <select value={req.method} onChange={(e) => update({ method: e.target.value })} className={cn("shrink-0 rounded-sm border border-line bg-canvas px-1.5 py-1 font-mono text-[11px] font-semibold outline-none", methodTone(req.method))}>
          {METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input value={req.url} onChange={(e) => update({ url: e.target.value })} placeholder="https://{{baseUrl}}/path" spellCheck={false} className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-accent" />
        <label className="flex shrink-0 items-center gap-1 text-[10px] text-fg-faint" title={t("Send through Catcher's proxy so it is captured")}>
          <input type="checkbox" checked={req.throughProxy} onChange={(e) => update({ throughProxy: e.target.checked })} />
          <Radar className="size-3" strokeWidth={1.75} />
        </label>
        <button type="button" onClick={onCode} title={t("Generate code")} className="flex shrink-0 items-center rounded-sm border border-line px-2 py-1 text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
          <Code2 className="size-3.5" strokeWidth={1.75} />
        </button>
        <select
          value=""
          onChange={(e) => { if (e.target.value) { onSendTo(e.target.value as "repeater" | "intruder" | "scanner"); e.target.value = ""; } }}
          title={t("Send to Catcher")}
          className="shrink-0 rounded-sm border border-line bg-canvas px-1 py-1 text-[10px] text-fg-dim outline-none hover:text-fg"
        >
          <option value="">→ Catcher</option>
          <option value="repeater">{t("Repeater")}</option>
          <option value="intruder">{t("Intruder")}</option>
          <option value="scanner">{t("Scanner")}</option>
        </select>
        <button type="button" onClick={onSend} disabled={sending} className="flex shrink-0 items-center gap-1.5 rounded-sm border border-accent px-3 py-1 text-[11px] text-accent transition-colors duration-100 hover:bg-accent hover:text-bg disabled:opacity-40">
          <Send className="size-3" strokeWidth={1.75} />
          {sending ? t("Sending…") : t("Send")}
        </button>
      </div>

      {}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
        {(["params", "headers", "body", "auth", "scripts"] as BuilderTab[]).map((x) => (
          <button key={x} type="button" onClick={() => setTab(x)} className={cn("rounded-sm px-2 py-0.5 text-[11px]", tab === x ? "bg-selected text-fg" : "text-fg-faint hover:bg-hover hover:text-fg")}>
            {t(x === "params" ? "Params" : x === "headers" ? "Headers" : x === "body" ? "Body" : x === "auth" ? "Auth" : "Scripts")}
          </button>
        ))}
      </div>

      <div ref={builderRef} className="shrink-0 overflow-auto border-b border-line p-2" style={{ height: builderH, maxHeight: "72%" }}>
        {tab === "params" && <ParamTable rows={req.params} onChange={(params) => update({ params })} />}
        {tab === "headers" && <ParamTable rows={req.headers} onChange={(headers) => update({ headers })} />}
        {tab === "body" && <BodyEditor req={req} update={update} />}
        {tab === "auth" && <AuthEditor req={req} update={update} />}
        {tab === "scripts" && <ScriptsEditor req={req} update={update} />}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("Resize")}
        onPointerDown={() => setDragging(true)}
        onDoubleClick={() => setBuilderH(240)}
        className="h-px shrink-0 cursor-row-resize bg-line transition-colors duration-100 hover:bg-line-strong"
      />

      {}
      <ResponsePane run={run} />
    </div>
  );
}

function BodyEditor({ req, update }: { req: PitcherRequest; update: (p: Partial<PitcherRequest>) => void }) {
  const t = useT();
  const b = req.body;
  const setBody = (patch: Partial<typeof b>) => update({ body: { ...b, ...patch } });
  return (
    <div className="flex flex-col gap-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-1">
        {(["none", "form", "multipart", "raw", "graphql", "binary"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setBody({ mode: m })} className={cn("rounded-sm border px-1.5 py-0.5 text-[10px]", b.mode === m ? "border-accent bg-selected text-fg" : "border-line text-fg-faint hover:bg-hover hover:text-fg")}>
            {m}
          </button>
        ))}
        {b.mode === "raw" && (
          <select value={b.rawType} onChange={(e) => setBody({ rawType: e.target.value as typeof b.rawType })} className="ml-1 rounded-sm border border-line bg-canvas px-1 py-0.5 text-[10px] text-fg outline-none">
            <option value="json">JSON</option>
            <option value="xml">XML</option>
            <option value="text">Text</option>
            <option value="html">HTML</option>
          </select>
        )}
      </div>
      {b.mode === "raw" && (
        <textarea value={b.raw} onChange={(e) => setBody({ raw: e.target.value })} rows={6} spellCheck={false} placeholder='{"key": "{{value}}"}' className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent" />
      )}
      {b.mode === "form" && <ParamTable rows={b.form} onChange={(form) => setBody({ form })} />}
      {b.mode === "graphql" && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Query")}</span>
          <textarea value={b.graphql.query} onChange={(e) => setBody({ graphql: { ...b.graphql, query: e.target.value } })} rows={5} spellCheck={false} placeholder="query { __typename }" className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent" />
          <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Variables (JSON)")}</span>
          <textarea value={b.graphql.variables} onChange={(e) => setBody({ graphql: { ...b.graphql, variables: e.target.value } })} rows={2} spellCheck={false} placeholder="{}" className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent" />
          <GraphqlSchema req={req} onInsert={(snippet) => setBody({ graphql: { ...b.graphql, query: b.graphql.query.trim() ? `${b.graphql.query}\n${snippet}` : `query {\n  ${snippet}\n}` } })} />
        </div>
      )}
      {(b.mode === "multipart" || b.mode === "binary") && <p className="text-[10px] text-fg-faint">{t("File bodies arrive in a later update.")}</p>}
    </div>
  );
}

function AuthEditor({ req, update }: { req: PitcherRequest; update: (p: Partial<PitcherRequest>) => void }) {
  const a = req.auth;
  const t = useT();
  const setAuth = (patch: Partial<typeof a>) => update({ auth: { ...a, ...patch } });
  const field = "w-full rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent";
  return (
    <div className="flex flex-col gap-1.5 text-[11px]">
      <select value={a.type} onChange={(e) => setAuth({ type: e.target.value as typeof a.type })} className="w-48 rounded-sm border border-line bg-canvas px-1.5 py-1 text-[11px] text-fg outline-none">
        <option value="none">No Auth</option>
        <option value="bearer">Bearer Token</option>
        <option value="basic">Basic</option>
        <option value="apikey">API Key</option>
        <option value="oauth2">OAuth 2.0</option>
        <option value="digest">Digest</option>
        <option value="awssigv4">AWS SigV4</option>
      </select>
      {a.type === "bearer" && <input value={a.bearer} onChange={(e) => setAuth({ bearer: e.target.value })} placeholder="{{token}}" className={field} />}
      {a.type === "basic" && (
        <>
          <input value={a.basic.username} onChange={(e) => setAuth({ basic: { ...a.basic, username: e.target.value } })} placeholder={t("username")} className={field} />
          <input value={a.basic.password} onChange={(e) => setAuth({ basic: { ...a.basic, password: e.target.value } })} placeholder={t("password")} type="password" className={field} />
        </>
      )}
      {a.type === "apikey" && (
        <>
          <input value={a.apikey.key} onChange={(e) => setAuth({ apikey: { ...a.apikey, key: e.target.value } })} placeholder={t("key")} className={field} />
          <input value={a.apikey.value} onChange={(e) => setAuth({ apikey: { ...a.apikey, value: e.target.value } })} placeholder={t("value")} className={field} />
          <select value={a.apikey.in} onChange={(e) => setAuth({ apikey: { ...a.apikey, in: e.target.value as "header" | "query" } })} className="w-32 rounded-sm border border-line bg-canvas px-1.5 py-1 text-[11px] text-fg outline-none">
            <option value="header">{t("Header")}</option>
            <option value="query">{t("Query param")}</option>
          </select>
        </>
      )}
      {a.type === "oauth2" && (
        <>
          <select value={a.oauth2.grant} onChange={(e) => setAuth({ oauth2: { ...a.oauth2, grant: e.target.value as "client_credentials" | "password" } })} className="w-52 rounded-sm border border-line bg-canvas px-1.5 py-1 text-[11px] text-fg outline-none">
            <option value="client_credentials">Client Credentials</option>
            <option value="password">Password</option>
          </select>
          <input value={a.oauth2.tokenUrl} onChange={(e) => setAuth({ oauth2: { ...a.oauth2, tokenUrl: e.target.value } })} placeholder={t("Access token URL")} className={field} />
          <input value={a.oauth2.clientId} onChange={(e) => setAuth({ oauth2: { ...a.oauth2, clientId: e.target.value } })} placeholder={t("Client ID")} className={field} />
          <input value={a.oauth2.clientSecret} onChange={(e) => setAuth({ oauth2: { ...a.oauth2, clientSecret: e.target.value } })} placeholder={t("Client secret")} type="password" className={field} />
          <input value={a.oauth2.scope} onChange={(e) => setAuth({ oauth2: { ...a.oauth2, scope: e.target.value } })} placeholder={t("Scope (optional)")} className={field} />
          {a.oauth2.grant === "password" && (
            <>
              <input value={a.oauth2.username} onChange={(e) => setAuth({ oauth2: { ...a.oauth2, username: e.target.value } })} placeholder={t("username")} className={field} />
              <input value={a.oauth2.password} onChange={(e) => setAuth({ oauth2: { ...a.oauth2, password: e.target.value } })} placeholder={t("password")} type="password" className={field} />
            </>
          )}
          <input value={a.oauth2.token} onChange={(e) => setAuth({ oauth2: { ...a.oauth2, token: e.target.value } })} placeholder={t("Access token (leave empty to fetch on send)")} className={field} />
        </>
      )}
      {a.type === "digest" && (
        <>
          <input value={a.digest.username} onChange={(e) => setAuth({ digest: { ...a.digest, username: e.target.value } })} placeholder={t("username")} className={field} />
          <input value={a.digest.password} onChange={(e) => setAuth({ digest: { ...a.digest, password: e.target.value } })} placeholder={t("password")} type="password" className={field} />
          <p className="text-[10px] text-fg-faint">{t("Digest completes the challenge automatically on send.")}</p>
        </>
      )}
      {a.type === "awssigv4" && (
        <>
          <input value={a.aws.accessKey} onChange={(e) => setAuth({ aws: { ...a.aws, accessKey: e.target.value } })} placeholder={t("Access key")} className={field} />
          <input value={a.aws.secretKey} onChange={(e) => setAuth({ aws: { ...a.aws, secretKey: e.target.value } })} placeholder={t("Secret key")} type="password" className={field} />
          <div className="flex gap-1.5">
            <input value={a.aws.region} onChange={(e) => setAuth({ aws: { ...a.aws, region: e.target.value } })} placeholder={t("Region")} className={field} />
            <input value={a.aws.service} onChange={(e) => setAuth({ aws: { ...a.aws, service: e.target.value } })} placeholder={t("Service")} className={field} />
          </div>
        </>
      )}
    </div>
  );
}

function ScriptsEditor({ req, update }: { req: PitcherRequest; update: (p: Partial<PitcherRequest>) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Pre-request script")}</span>
      <textarea value={req.preScript} onChange={(e) => update({ preScript: e.target.value })} rows={3} spellCheck={false} placeholder="// pm.environment.set('ts', Date.now())" className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent" />
      <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Tests")}</span>
      <textarea value={req.testScript} onChange={(e) => update({ testScript: e.target.value })} rows={3} spellCheck={false} placeholder="// pm.test('ok', () => pm.expect(pm.response.code).to.equal(200))" className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent" />
      <p className="text-[10px] text-fg-faint">{t("pm.* — environment, variables, request, response, test, expect are available.")}</p>
    </div>
  );
}

type RespTab = "body" | "tests" | "console";

function ResponsePane({ run }: { run: RunState | undefined }) {
  const t = useT();
  const [tab, setTab] = useState<RespTab>("body");
  const resp = run?.resp ?? null;
  const tests = run?.tests ?? [];
  const logs = run?.logs ?? [];

  if (run?.sending) return <div className="flex flex-1 items-center justify-center text-[12px] text-fg-faint">{t("Sending…")}</div>;
  if (!resp) return <div className="flex flex-1 items-center justify-center text-[12px] text-fg-faint">{t("Send the request to see the response.")}</div>;
  if (!resp.ok) return <p className="p-3 text-[12px] text-status-error">{resp.error}</p>;

  const tone = (resp.status ?? 0) >= 500 ? "text-status-error" : (resp.status ?? 0) >= 400 ? "text-amber-400" : "text-emerald-400";
  const passed = tests.filter((x) => x.passed).length;
  const failed = tests.length - passed;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1 text-[11px]">
        <span className={cn("font-mono tabular-nums", tone)}>{resp.status} {resp.statusText}</span>
        <span className="tabular-nums text-fg-faint">{resp.ms} ms</span>
        {resp.bytes != null && <span className="tabular-nums text-fg-faint">{resp.bytes} B</span>}
        <div className="ml-2 flex items-center gap-1">
          <button type="button" onClick={() => setTab("body")} className={cn("rounded-sm px-1.5 py-0.5", tab === "body" ? "bg-selected text-fg" : "text-fg-faint hover:text-fg")}>{t("Body")}</button>
          <button type="button" onClick={() => setTab("tests")} className={cn("flex items-center gap-1 rounded-sm px-1.5 py-0.5", tab === "tests" ? "bg-selected text-fg" : "text-fg-faint hover:text-fg")}>
            {t("Tests")}
            {tests.length > 0 && (
              <span className={cn("rounded px-1 text-[9px]", failed > 0 ? "bg-status-error/20 text-status-error" : "bg-emerald-500/20 text-emerald-400")}>{passed}/{tests.length}</span>
            )}
          </button>
          {logs.length > 0 && (
            <button type="button" onClick={() => setTab("console")} className={cn("rounded-sm px-1.5 py-0.5", tab === "console" ? "bg-selected text-fg" : "text-fg-faint hover:text-fg")}>{t("Console")} ({logs.length})</button>
          )}
        </div>
      </div>
      {run?.scriptError && <div className="shrink-0 border-b border-line bg-status-error/10 px-3 py-1 font-mono text-[10px] text-status-error">⚠ {run.scriptError}</div>}
      {tab === "body" && <HttpBodyView body={resp.body ?? ""} headers={resp.headers ?? []} className="flex-1" />}
      {tab === "tests" && (
        <div className="min-h-0 flex-1 overflow-auto p-2 text-[11px]">
          {tests.length === 0 ? (
            <p className="text-fg-faint">{t("No tests. Add pm.test(…) in the Scripts tab.")}</p>
          ) : (
            tests.map((x, i) => (
              <div key={i} className="flex items-start gap-2 border-b border-line/40 py-1">
                <span className={cn("shrink-0 font-mono text-[10px]", x.passed ? "text-emerald-400" : "text-status-error")}>{x.passed ? "PASS" : "FAIL"}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-fg">{x.name}</span>
                  {x.error && <span className="block font-mono text-[10px] text-status-error">{x.error}</span>}
                </span>
              </div>
            ))
          )}
        </div>
      )}
      {tab === "console" && (
        <pre className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[10px] text-fg-dim">{logs.join("\n")}</pre>
      )}
    </div>
  );
}

function Toolbar({ onManageEnv, onCookies, onImport }: { onManageEnv: () => void; onCookies: () => void; onImport: () => void }) {
  const t = useT();
  const environments = usePitcherEnv((s) => s.environments);
  const activeId = usePitcherEnv((s) => s.activeId);
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-chrome px-2 py-1">
      <Globe className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
      <select
        value={activeId ?? ""}
        onChange={(e) => usePitcherEnv.getState().setActive(e.target.value || null)}
        className="rounded-sm border border-line bg-canvas px-1.5 py-0.5 text-[11px] text-fg outline-none"
      >
        <option value="">{t("No environment")}</option>
        {environments.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <button type="button" onClick={onManageEnv} className="rounded-sm px-1.5 py-0.5 text-[11px] text-fg-faint hover:bg-hover hover:text-fg">{t("Manage")}</button>
      <div className="flex-1" />
      <button type="button" onClick={onCookies} className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-fg-faint hover:bg-hover hover:text-fg">
        <Cookie className="size-3.5" strokeWidth={1.75} />
        {t("Cookies")}
      </button>
      <button type="button" onClick={onImport} className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-fg-faint hover:bg-hover hover:text-fg">
        <Upload className="size-3.5" strokeWidth={1.75} />
        {t("Import")}
      </button>
    </div>
  );
}

const PROTO_OPTIONS: { id: Protocol | "graphql"; label: string }[] = [
  { id: "http", label: "HTTP" },
  { id: "graphql", label: "GraphQL" },
  { id: "websocket", label: "WebSocket" },
  { id: "sse", label: "SSE" },
  { id: "grpc", label: "gRPC" },
];

function ProtocolBar({ req }: { req: PitcherRequest }) {
  const current: Protocol | "graphql" = (req.protocol ?? "http") === "http" && req.body.mode === "graphql" ? "graphql" : (req.protocol ?? "http");
  const pick = (id: Protocol | "graphql") => {
    const u = usePitcher.getState().updateRequest;
    if (id === "graphql") u(req.id, { protocol: "http", method: "POST", body: { ...req.body, mode: "graphql" } });
    else if (id === "http") u(req.id, { protocol: "http", body: req.body.mode === "graphql" ? { ...req.body, mode: "none" } : req.body });
    else u(req.id, { protocol: id });
  };
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line bg-chrome/60 px-2 py-1">
      {PROTO_OPTIONS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => pick(p.id)}
          className={cn("rounded-sm px-2 py-0.5 text-[10px]", current === p.id ? "bg-selected text-fg" : "text-fg-faint hover:bg-hover hover:text-fg")}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function PitcherView() {
  const t = useT();
  const collections = usePitcher((s) => s.collections);
  const openTabs = usePitcher((s) => s.openTabs);
  const activeTab = usePitcher((s) => s.activeTab);
  const [responses, setResponses] = useState<Record<string, RunState>>({});
  const [modal, setModal] = useState<null | "env" | "cookies" | "import">(null);
  const [codeReq, setCodeReq] = useState<PitcherRequest | null>(null);
  const [runnerColl, setRunnerColl] = useState<Collection | null>(null);

  const openRequests = useMemo(
    () => openTabs.map((id) => usePitcher.getState().getRequest(id)).filter((r): r is PitcherRequest => Boolean(r)),

    [openTabs, collections],
  );
  const active = openRequests.find((r) => r.id === activeTab) ?? null;

  const varsFor = (req: PitcherRequest): Record<string, string> => {
    const coll = usePitcher.getState().collectionOf(req.id);
    return usePitcherEnv.getState().merged(coll?.vars ?? []);
  };

  const send = async (req: PitcherRequest) => {
    setResponses((s) => ({ ...s, [req.id]: { sending: true, resp: null, tests: [], logs: [] } }));
    const out = await executeRequest(req);
    setResponses((s) => ({ ...s, [req.id]: { sending: false, resp: out.resp, tests: out.tests, logs: out.logs, scriptError: out.scriptError } }));
    if (out.resp.ok) usePitcherHistory.getState().add({ method: req.method, url: out.resp.url ?? req.url, status: out.resp.status ?? 0, ms: out.resp.ms ?? 0 });
  };

  const sendToCatcher = (req: PitcherRequest, tool: "repeater" | "intruder" | "scanner") => {
    const vars = varsFor(req);
    if (tool === "repeater") sendToRepeater(req, vars);
    else if (tool === "intruder") sendToIntruder(req, vars);
    else sendToScanner(req, vars);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <Toolbar onManageEnv={() => setModal("env")} onCookies={() => setModal("cookies")} onImport={() => setModal("import")} />
      <div className="flex min-h-0 flex-1">
        <Sidebar collections={collections} activeTab={activeTab} onRun={setRunnerColl} />
        <div className="flex min-h-0 flex-1 flex-col">
          {openTabs.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-chrome px-1.5 py-1">
              {openRequests.map((r) => (
                <div key={r.id} className={cn("group flex shrink-0 items-center rounded-sm border text-[11px]", activeTab === r.id ? "border-accent bg-selected text-fg" : "border-line text-fg-faint hover:bg-hover")}>
                  <button type="button" onClick={() => usePitcher.getState().selectTab(r.id)} className="flex items-center gap-1 px-2 py-0.5">
                    <span className={cn("font-mono text-[9px] font-semibold", methodTone(r.method))}>{r.method}</span>
                    <span className="max-w-32 truncate">{r.name}</span>
                  </button>
                  <button type="button" onClick={() => usePitcher.getState().closeTab(r.id)} className="px-1 opacity-0 group-hover:opacity-100 hover:text-fg">
                    <X className="size-3" strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {active ? (
            <>
              <ProtocolBar req={active} />
              {(active.protocol ?? "http") === "websocket" ? (
                <WsClient key={active.id} req={active} />
              ) : (active.protocol ?? "http") === "sse" ? (
                <SseView key={active.id} req={active} />
              ) : (active.protocol ?? "http") === "grpc" ? (
                <GrpcView key={active.id} req={active} />
              ) : (
                <RequestPane
                  req={active}
                  run={responses[active.id]}
                  onSend={() => void send(active)}
                  onCode={() => setCodeReq(active)}
                  onSendTo={(tool) => sendToCatcher(active, tool)}
                />
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-faint">
              <Send className="size-6" strokeWidth={1.25} />
              <span className="text-[12px]">{t("Open or create a request to begin.")}</span>
            </div>
          )}
        </div>
      </div>

      {modal === "env" && <EnvManager onClose={() => setModal(null)} />}
      {modal === "cookies" && <CookieManager onClose={() => setModal(null)} />}
      {modal === "import" && <ImportDialog onClose={() => setModal(null)} />}
      {codeReq && <CodeGenDialog req={codeReq} vars={varsFor(codeReq)} onClose={() => setCodeReq(null)} />}
      {runnerColl && <RunnerDialog collection={runnerColl} onClose={() => setRunnerColl(null)} />}
    </div>
  );
}
