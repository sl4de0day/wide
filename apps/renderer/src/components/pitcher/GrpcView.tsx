import { FileCode, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge, type GrpcService } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { resolveVars } from "@/lib/pitcher/vars";
import { cn } from "@/lib/utils";
import { usePitcher, type PitcherRequest } from "@/stores/pitcher";
import { usePitcherEnv } from "@/stores/pitcherEnv";

interface LogEntry {
  kind: "sys" | "data" | "error";
  text: string;
}

function scopeVars(req: PitcherRequest): Record<string, string> {
  return usePitcherEnv.getState().merged(usePitcher.getState().collectionOf(req.id)?.vars ?? []);
}

export function GrpcView({ req }: { req: PitcherRequest }) {
  const t = useT();
  const update = (patch: Partial<PitcherRequest>) => usePitcher.getState().updateRequest(req.id, patch);
  const setBody = (patch: Partial<PitcherRequest["body"]>) => update({ body: { ...req.body, ...patch } });

  const [services, setServices] = useState<GrpcService[]>([]);
  const [service, setService] = useState("");
  const [method, setMethod] = useState("");
  const [tls, setTls] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [streaming, setStreaming] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const protoSource = req.body.raw;
  const message = req.body.graphql.query;
  const selectedMethod = services.find((s) => s.name === service)?.methods.find((m) => m.name === method) ?? null;

  useEffect(() => {
    const off = bridge.onGrpcEvent((ev) => {
      if (ev.id !== req.id) return;
      if (ev.type === "data") setLog((l) => [...l, { kind: "data", text: JSON.stringify(ev.data, null, 2) }]);
      else if (ev.type === "end") {
        setLog((l) => [...l, { kind: "sys", text: "stream ended" }]);
        setStreaming(false);
      } else if (ev.type === "error") {
        setLog((l) => [...l, { kind: "error", text: ev.error ?? "error" }]);
        setStreaming(false);
      }
    });
    return off;
  }, [req.id]);

  useEffect(() => () => void bridge.grpcCancel(req.id), [req.id]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const loadProto = async () => {
    setLoadError("");
    const reply = await bridge.grpcLoad(req.id, undefined, protoSource);
    if (reply.ok && reply.services) {
      const svcs = reply.services;
      setServices(svcs);
      if (svcs[0]) {
        setService(svcs[0].name);
        setMethod(svcs[0].methods[0]?.name ?? "");
      }
    } else {
      setLoadError(reply.error ?? "Load failed.");
      setServices([]);
    }
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setBody({ raw: String(reader.result ?? "") });
    reader.readAsText(file);
  };

  const call = async () => {
    if (!selectedMethod) return;
    const vars = scopeVars(req);
    const target = resolveVars(req.url, vars);
    let msg: unknown = {};
    try {
      msg = message.trim() ? JSON.parse(resolveVars(message, vars)) : {};
    } catch (e) {
      setLog((l) => [...l, { kind: "error", text: `Invalid JSON message: ${e instanceof Error ? e.message : String(e)}` }]);
      return;
    }
    const metadata: Record<string, string> = {};
    for (const h of req.headers) if (h.enabled && h.key.trim()) metadata[resolveVars(h.key, vars)] = resolveVars(h.value, vars);
    const args = { loadId: req.id, target, service, method, message: msg, metadata, tls };

    if (selectedMethod.responseStream) {
      setLog((l) => [...l, { kind: "sys", text: `streaming ${service}/${method}…` }]);
      setStreaming(true);
      const reply = await bridge.grpcServerStream({ ...args, id: req.id });
      if (!reply.ok) {
        setLog((l) => [...l, { kind: "error", text: reply.error ?? "" }]);
        setStreaming(false);
      }
    } else {
      setLog((l) => [...l, { kind: "sys", text: `calling ${service}/${method}…` }]);
      const reply = await bridge.grpcUnary(args);
      if (reply.ok) setLog((l) => [...l, { kind: "data", text: JSON.stringify(reply.response, null, 2) }]);
      else setLog((l) => [...l, { kind: "error", text: reply.error ?? "" }]);
    }
  };

  const field = "rounded-sm border border-line bg-canvas px-2 py-1 text-[11px] text-fg outline-none focus:border-accent";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <input value={req.url} onChange={(e) => update({ url: e.target.value })} placeholder="localhost:50051" spellCheck={false} className={cn(field, "min-w-0 flex-1 font-mono")} />
        <label className="flex shrink-0 items-center gap-1 text-[10px] text-fg-faint">
          <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
          TLS
        </label>
      </div>

      <div className="flex min-h-0 flex-1">
        {}
        <div className="flex w-1/2 shrink-0 flex-col border-r border-line p-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Proto")}</span>
            <label className="flex cursor-pointer items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim hover:bg-hover hover:text-fg">
              <FileCode className="size-3" strokeWidth={1.75} />
              {t("Open file…")}
              <input type="file" accept=".proto" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            </label>
            <button type="button" onClick={() => void loadProto()} className="rounded-sm border border-accent px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent hover:text-bg">{t("Load")}</button>
          </div>
          <textarea value={protoSource} onChange={(e) => setBody({ raw: e.target.value })} spellCheck={false} placeholder={'syntax = "proto3";\nservice Greeter { rpc SayHello (HelloRequest) returns (HelloReply); }'} className={cn(field, "min-h-0 flex-1 resize-none font-mono text-[10px]")} />
          {loadError && <p className="mt-1 font-mono text-[10px] text-status-error">{loadError}</p>}
          {services.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              <select value={service} onChange={(e) => { setService(e.target.value); setMethod(services.find((s) => s.name === e.target.value)?.methods[0]?.name ?? ""); }} className={field}>
                {services.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
                {(services.find((s) => s.name === service)?.methods ?? []).map((m) => (
                  <option key={m.name} value={m.name}>{m.name}{m.responseStream ? " (stream)" : ""}</option>
                ))}
              </select>
              {selectedMethod && (
                <span className="text-[10px] text-fg-faint">{selectedMethod.requestType} → {selectedMethod.responseType}</span>
              )}
            </div>
          )}
        </div>

        {}
        <div className="flex min-w-0 flex-1 flex-col p-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Message (JSON)")}</span>
            {streaming ? (
              <button type="button" onClick={() => { bridge.grpcCancel(req.id); setStreaming(false); }} className="ml-auto flex items-center gap-1 rounded-sm border border-status-error px-2 py-0.5 text-[10px] text-status-error hover:bg-status-error hover:text-bg">
                <Square className="size-3" strokeWidth={2} />
                {t("Stop")}
              </button>
            ) : (
              <button type="button" onClick={() => void call()} disabled={!selectedMethod} className="ml-auto flex items-center gap-1 rounded-sm border border-accent px-2 py-0.5 text-[10px] text-accent hover:bg-accent hover:text-bg disabled:opacity-40">
                <Play className="size-3" strokeWidth={2} />
                {t("Call")}
              </button>
            )}
          </div>
          <textarea value={message} onChange={(e) => setBody({ graphql: { ...req.body.graphql, query: e.target.value } })} spellCheck={false} placeholder='{ "name": "world" }' className={cn(field, "h-24 shrink-0 resize-none font-mono text-[10px]")} />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Response")}</span>
            {log.length > 0 && <button type="button" onClick={() => setLog([])} className="text-[10px] text-fg-faint hover:text-fg">{t("Clear")}</button>}
          </div>
          <div ref={logRef} className="mt-1 min-h-0 flex-1 overflow-auto rounded-sm border border-line p-2 font-mono text-[10px]">
            {log.length === 0 ? (
              <p className="text-fg-faint">{t("Load a proto, pick a method, and call.")}</p>
            ) : (
              log.map((e, i) => (
                <pre key={i} className={cn("whitespace-pre-wrap break-words border-b border-line/30 py-1", e.kind === "error" ? "text-status-error" : e.kind === "sys" ? "text-fg-faint" : "text-fg-dim")}>{e.text}</pre>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
