import { Copy, Play, Radio, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { OastInteraction } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn, copyText } from "@/lib/utils";
import { useExtensions } from "@/stores/extensions";
import { useOast } from "@/stores/oast";

function protoTone(p: string): string {
  const proto = p.toLowerCase();
  if (proto.startsWith("http")) return "text-emerald-400";
  if (proto === "dns") return "text-sky-400";
  if (proto === "smtp") return "text-amber-400";
  return "text-fg-dim";
}

export function CollaboratorView() {
  const t = useT();
  const installed = useOast((s) => s.installed);
  const running = useOast((s) => s.running);
  const domain = useOast((s) => s.domain);
  const server = useOast((s) => s.server);
  const token = useOast((s) => s.token);
  const interactions = useOast((s) => s.interactions);
  const hasInteractsh = useExtensions((s) => s.installed.has("interactsh"));
  const [chosen, setChosen] = useState<OastInteraction | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    void useOast.getState().refresh();
  }, []);

  const ready = installed || hasInteractsh;

  const generate = () => {
    const { host } = useOast.getState().newPayload();
    if (!host) return;
    void copyText(host);
    setCopied(host);
    setTimeout(() => setCopied(""), 2500);
  };

  const detail = useMemo(() => {
    if (!chosen) return "";
    return (chosen["raw-request"] as string) || (chosen["raw-response"] as string) || JSON.stringify(chosen, null, 2);
  }, [chosen]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Radio className={cn("size-4 shrink-0", running ? "text-emerald-400" : "text-fg-faint")} strokeWidth={1.75} />
        <span className="flex-1 text-[12px] font-medium text-fg">{t("Collaborator")}</span>
        <span className="text-[11px] text-fg-faint">{running ? t("listening") : t("stopped")}</span>
        {interactions.length > 0 && (
          <button type="button" onClick={() => useOast.getState().clear()} title={t("Clear")} className="rounded-sm p-1 text-fg-faint hover:bg-hover hover:text-fg">
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>

      <div className="shrink-0 border-b border-line p-2">
        {!ready && (
          <p className="mb-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
            {t("Install interactsh-client from Extensions to use the Collaborator.")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={server}
            onChange={(e) => useOast.getState().setServer(e.target.value)}
            placeholder={t("your interactsh server (e.g. oast.yourdomain.com)")}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
          />
          <input
            value={token}
            onChange={(e) => useOast.getState().setToken(e.target.value)}
            placeholder={t("token (optional)")}
            spellCheck={false}
            type="password"
            className="w-40 rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
          />
          {running ? (
            <button type="button" onClick={() => void useOast.getState().stop()} className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 text-[11px] text-status-error hover:bg-hover">
              <Square className="size-3" strokeWidth={2} fill="currentColor" />
              {t("Stop")}
            </button>
          ) : (
            <button type="button" onClick={() => void useOast.getState().start()} disabled={!ready || !server.trim()} className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 text-[11px] text-emerald-300 hover:bg-hover disabled:opacity-40">
              <Play className="size-3" strokeWidth={2} fill="currentColor" />
              {t("Start")}
            </button>
          )}
        </div>
        {running && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Payload domain")}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-syn-string" title={domain}>
              {domain || "…"}
            </span>
            <button type="button" onClick={generate} disabled={!domain} className="flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-[10px] text-fg-dim hover:bg-hover hover:text-fg disabled:opacity-40">
              <Copy className="size-3" strokeWidth={1.75} />
              {t("Generate payload")}
            </button>
          </div>
        )}
        {copied && <p className="mt-1 truncate text-[10px] text-emerald-400" title={copied}>{t("Copied")}: {copied}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {interactions.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-fg-faint">
            {running ? t("Waiting for interactions — place a payload where a target might reach it.") : t("Start the listener to catch out-of-band interactions.")}
          </p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-[10px] uppercase tracking-wide text-fg-faint">
                <th className="border-b border-line px-2 py-1 font-normal">{t("type")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("host")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("source")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("time")}</th>
              </tr>
            </thead>
            <tbody>
              {interactions.map((i, idx) => (
                <tr key={idx} onClick={() => setChosen(i === chosen ? null : i)} className={cn("cursor-pointer border-b border-line/60 text-[11px] hover:bg-hover", chosen === i && "bg-selected")}>
                  <td className={cn("px-2 py-0.5 font-mono uppercase", protoTone(String(i.protocol ?? "")))}>{String(i.protocol ?? "?")}</td>
                  <td className="max-w-40 truncate px-2 py-0.5 font-mono text-fg" title={String(i["full-id"] ?? "")}>
                    {String(i["full-id"] ?? "")}
                  </td>
                  <td className="px-2 py-0.5 font-mono text-fg-dim">{String(i["remote-address"] ?? "")}</td>
                  <td className="px-2 py-0.5 font-mono text-fg-faint">{String(i.timestamp ?? "").replace("T", " ").slice(0, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {chosen && (
        <div className="max-h-[30vh] shrink-0 overflow-auto border-t border-line p-2">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-fg-dim">{detail}</pre>
        </div>
      )}
    </div>
  );
}
