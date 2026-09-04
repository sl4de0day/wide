import { Plug, PlugZap, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { resolveVars } from "@/lib/pitcher/vars";
import { cn } from "@/lib/utils";
import { usePitcher, type PitcherRequest } from "@/stores/pitcher";
import { usePitcherEnv } from "@/stores/pitcherEnv";

interface Frame {
  dir: "up" | "down" | "sys";
  text: string;
  at: number;
}

function scopeVars(req: PitcherRequest): Record<string, string> {
  return usePitcherEnv.getState().merged(usePitcher.getState().collectionOf(req.id)?.vars ?? []);
}

export function WsClient({ req }: { req: PitcherRequest }) {
  const t = useT();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [input, setInput] = useState("");
  const update = (patch: Partial<PitcherRequest>) => usePitcher.getState().updateRequest(req.id, patch);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = bridge.onWsEvent((ev) => {
      if (ev.id !== req.id) return;
      if (ev.type === "open") {
        setConnected(true);
        setConnecting(false);
        setFrames((f) => [...f, { dir: "sys", text: "connected", at: Date.now() }]);
      } else if (ev.type === "message") {
        setFrames((f) => [...f, { dir: "down", text: ev.data ?? "", at: Date.now() }]);
      } else if (ev.type === "close") {
        setConnected(false);
        setConnecting(false);
        setFrames((f) => [...f, { dir: "sys", text: `closed${ev.code ? ` (${ev.code})` : ""}${ev.reason ? ` ${ev.reason}` : ""}`, at: Date.now() }]);
      } else if (ev.type === "error") {
        setConnecting(false);
        setFrames((f) => [...f, { dir: "sys", text: `error: ${ev.reason ?? ""}`, at: Date.now() }]);
      }
    });
    return off;
  }, [req.id]);

  useEffect(() => {

    return () => void bridge.wsClose(req.id);
  }, [req.id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [frames]);

  const connect = async () => {
    setConnecting(true);
    const url = resolveVars(req.url, scopeVars(req));
    const reply = await bridge.wsConnect(req.id, url);
    if (!reply.ok) {
      setConnecting(false);
      setFrames((f) => [...f, { dir: "sys", text: `error: ${reply.error}`, at: Date.now() }]);
    }
  };
  const disconnect = () => void bridge.wsClose(req.id);
  const send = async () => {
    if (!input.trim()) return;
    const text = resolveVars(input, scopeVars(req));
    const reply = await bridge.wsSend(req.id, text);
    if (reply.ok) {
      setFrames((f) => [...f, { dir: "up", text, at: Date.now() }]);
      setInput("");
    } else {
      setFrames((f) => [...f, { dir: "sys", text: `error: ${reply.error}`, at: Date.now() }]);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <input value={req.url} onChange={(e) => update({ url: e.target.value })} placeholder="wss://{{host}}/socket" spellCheck={false} className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-accent" />
        {connected ? (
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
      </div>

      <div ref={logRef} className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px]">
        {frames.length === 0 ? (
          <p className="text-fg-faint">{t("Connect to start the conversation.")}</p>
        ) : (
          frames.map((f, i) => (
            <div key={i} className={cn("flex gap-2 border-b border-line/30 py-0.5", f.dir === "sys" && "text-fg-faint")}>
              <span className={cn("shrink-0", f.dir === "up" ? "text-sky-400" : f.dir === "down" ? "text-emerald-400" : "text-fg-faint")}>{f.dir === "up" ? "▲" : f.dir === "down" ? "▼" : "•"}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-fg-dim">{f.text}</span>
            </div>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-line px-2 py-1.5">
        <button type="button" onClick={() => setFrames([])} title={t("Clear")} className="shrink-0 rounded-sm border border-line p-1 text-fg-faint hover:bg-hover hover:text-fg">
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={t("Message to send…")}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent"
        />
        <button type="button" onClick={send} disabled={!connected} className="flex shrink-0 items-center gap-1.5 rounded-sm border border-accent px-3 py-1 text-[11px] text-accent hover:bg-accent hover:text-bg disabled:opacity-40">
          <Send className="size-3" strokeWidth={1.75} />
          {t("Send")}
        </button>
      </div>
    </div>
  );
}
