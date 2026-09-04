import { ArrowUpRight, Crosshair, Radar, Send, ShieldPlus } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProxyEntry } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCatcher } from "@/stores/catcher";
import { useFindings } from "@/stores/findings";
import { useIntruder } from "@/stores/intruder";
import { usePitcher } from "@/stores/pitcher";
import { useProxy } from "@/stores/proxy";
import { useScanner } from "@/stores/scanner";
import { useEditor } from "@/stores/editor";

const rawOf = (entry: ProxyEntry): string =>
  `${entry.method} ${entry.url}\n` + entry.reqHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") + `\n\n${entry.reqBody}`;

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname + u.search) || "/";
  } catch {
    return url;
  }
}

function statusTone(status: number): string {
  if (status >= 500 || status === 0) return "text-status-error";
  if (status >= 400) return "text-amber-400";
  if (status >= 300) return "text-fg-faint";
  return "text-emerald-400";
}

export function BrowserRequestsPanel({ host }: { host: string | null }) {
  const t = useT();
  const entries = useProxy((s) => s.entries);
  const [selected, setSelected] = useState<number | null>(null);

  const shown = useMemo(() => {
    const list = host ? entries.filter((e) => e.host === host) : entries;
    return [...list].reverse();
  }, [entries, host]);

  const chosen = shown.find((e) => e.id === selected) ?? null;

  const toRepeater = (e: ProxyEntry) =>
    useCatcher.getState().addRepeater({ method: e.method, url: e.url, headers: e.reqHeaders, body: e.reqBody });
  const toIntruder = (e: ProxyEntry) => useIntruder.getState().openIntruder(rawOf(e));
  const toScanner = (e: ProxyEntry) => {
    useScanner.getState().scan(rawOf(e));
    useCatcher.getState().show("scanner");
  };
  const toPitcher = (e: ProxyEntry) => {
    usePitcher.getState().captureRequest({ method: e.method, url: e.url, headers: e.reqHeaders, body: e.reqBody });
    useEditor.getState().openPitcher();
  };
  const toFindings = (e: ProxyEntry) =>
    useFindings.getState().add({
      title: `${e.method} ${e.host}`,
      severity: "info",
      location: e.url,
      detail: rawOf(e) + (e.resBody ? `\n\n---\n${e.status}\n${e.resBody.slice(0, 2000)}` : ""),
    });

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-fg-faint">{t("This page's requests")}</span>
        <span className="flex-1" />
        <span className="text-[10px] tabular-nums text-fg-faint">{shown.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-fg-faint">
            {host ? t("No captured requests for this host yet — start the proxy and scope this host.") : t("No captured requests yet.")}
          </p>
        ) : (
          shown.map((entry) => (
            <div
              key={entry.id}
              onClick={() => setSelected(entry.id === selected ? null : entry.id)}
              className={cn(
                "group flex cursor-pointer items-center gap-2 border-b border-line/60 px-3 py-1 text-[11px] hover:bg-hover",
                selected === entry.id && "bg-selected",
              )}
            >
              <span className="w-10 shrink-0 font-mono text-fg-dim">{entry.method}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-fg" title={entry.url}>
                {pathOf(entry.url)}
              </span>
              <span className={cn("shrink-0 font-mono tabular-nums", statusTone(entry.status))}>{entry.status || "—"}</span>
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button type="button" onClick={(ev) => { ev.stopPropagation(); toRepeater(entry); }} title={t("Send to Repeater")} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg">
                  <ArrowUpRight className="size-3.5" strokeWidth={2} />
                </button>
                <button type="button" onClick={(ev) => { ev.stopPropagation(); toIntruder(entry); }} title={t("Send to Intruder")} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg">
                  <Crosshair className="size-3.5" strokeWidth={2} />
                </button>
                <button type="button" onClick={(ev) => { ev.stopPropagation(); toScanner(entry); }} title={t("Active scan")} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg">
                  <Radar className="size-3.5" strokeWidth={2} />
                </button>
                <button type="button" onClick={(ev) => { ev.stopPropagation(); toPitcher(entry); }} title={t("Save to Pitcher")} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg">
                  <Send className="size-3.5" strokeWidth={2} />
                </button>
                <button type="button" onClick={(ev) => { ev.stopPropagation(); toFindings(entry); }} title={t("Add to Findings")} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg">
                  <ShieldPlus className="size-3.5" strokeWidth={2} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>
      {chosen && (
        <div className="max-h-40 shrink-0 overflow-auto border-t border-line p-2">
          <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-fg-dim">{rawOf(chosen)}</pre>
        </div>
      )}
    </div>
  );
}
