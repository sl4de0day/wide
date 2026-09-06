import { Plug, PlugZap, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { resolveVars } from "@/lib/pitcher/vars";
import { cn } from "@/lib/utils";
import { usePitcher, type PitcherRequest } from "@/stores/pitcher";
import { usePitcherEnv } from "@/stores/pitcherEnv";

const EVENT_CAP = 5000;

interface Evt {
  event: string;
  data: string;
  at: number;
}

export function SseView({ req }: { req: PitcherRequest }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [events, setEvents] = useState<Evt[]>([]);
  const append = useCallback((evt: Evt) => {
    setEvents((e) => (e.length >= EVENT_CAP ? [...e.slice(e.length - EVENT_CAP + 1), evt] : [...e, evt]));
  }, []);
  const update = (patch: Partial<PitcherRequest>) => usePitcher.getState().updateRequest(req.id, patch);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = bridge.onSseEvent((ev) => {
      if (ev.id !== req.id) return;
      if (ev.type === "open") {
        setOpen(true);
        setConnecting(false);
      } else if (ev.type === "message") {
        append({ event: ev.event ?? "message", data: ev.data ?? "", at: Date.now() });
      } else if (ev.type === "close") {
        setOpen(false);
        setConnecting(false);
      } else if (ev.type === "error") {
        setConnecting(false);
        append({ event: "error", data: ev.data ?? "", at: Date.now() });
      }
    });
    return off;
  }, [req.id]);

  useEffect(() => () => void bridge.sseClose(req.id), [req.id]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const connect = async () => {
    setConnecting(true);
    const vars = usePitcherEnv.getState().merged(usePitcher.getState().collectionOf(req.id)?.vars ?? []);
    const url = resolveVars(req.url, vars);
    const headers: Record<string, string> = {};
    for (const h of req.headers) if (h.enabled && h.key.trim()) headers[resolveVars(h.key, vars)] = resolveVars(h.value, vars);
    const reply = await bridge.sseOpen(req.id, url, headers);
    if (!reply.ok) {
      setConnecting(false);
      append({ event: "error", data: reply.error ?? "", at: Date.now() });
    }
  };
  const disconnect = () => void bridge.sseClose(req.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <input value={req.url} onChange={(e) => update({ url: e.target.value })} placeholder="https://{{host}}/events" spellCheck={false} className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-accent" />
        {open ? (
          <button type="button" onClick={disconnect} className="flex shrink-0 items-center gap-1.5 rounded-sm border border-status-error px-3 py-1 text-[11px] text-status-error hover:bg-status-error hover:text-bg">
            <PlugZap className="size-3" strokeWidth={1.75} />
            {t("Disconnect")}
          </button>
        ) : (
          <button type="button" onClick={connect} disabled={connecting} className="flex shrink-0 items-center gap-1.5 rounded-sm border border-accent px-3 py-1 text-[11px] text-accent hover:bg-accent hover:text-bg disabled:opacity-40">
            <Plug className="size-3" strokeWidth={1.75} />
            {connecting ? t("Connecting…") : t("Connect")}
          </button>
        )}
        <button type="button" onClick={() => setEvents([])} title={t("Clear")} className="shrink-0 rounded-sm border border-line p-1 text-fg-faint hover:bg-hover hover:text-fg">
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div ref={logRef} className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px]">
        {events.length === 0 ? (
          <p className="text-fg-faint">{t("Connect to receive events.")}</p>
        ) : (
          events.map((e, i) => (
            <div key={i} className="border-b border-line/30 py-1">
              <span className={cn("mr-2 text-[10px] uppercase", e.event === "error" ? "text-status-error" : "text-accent")}>{e.event}</span>
              <span className="whitespace-pre-wrap break-words text-fg-dim">{e.data}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
