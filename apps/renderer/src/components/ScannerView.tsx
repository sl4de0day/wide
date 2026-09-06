import { KeyRound, Network, Play, Repeat2, Square, Trash2 } from "lucide-react";
import { useState } from "react";

import { parseHttpMessage } from "@/lib/httpMessage";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCatcher } from "@/stores/catcher";
import type { Severity } from "@/stores/findings";
import { useScanner } from "@/stores/scanner";

const SEV_TONE: Record<Severity, string> = {
  critical: "text-status-error",
  high: "text-amber-400",
  medium: "text-yellow-300",
  low: "text-sky-400",
  info: "text-fg-faint",
};
const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function ScannerView() {
  const t = useT();
  const tasks = useScanner((s) => s.tasks);
  const issues = useScanner((s) => s.issues);
  const selected = useScanner((s) => s.selected);
  const [draft, setDraft] = useState("");
  const [crawlSeed, setCrawlSeed] = useState("");
  const session = useScanner((s) => s.session);
  const [showSession, setShowSession] = useState(false);
  const chosen = issues.find((i) => i.id === selected) ?? null;

  const sortedIssues = [...issues].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const launch = () => {
    if (!parseHttpMessage(draft)) return;
    useScanner.getState().scan(draft);
  };
  const sendToRepeater = (requestText: string) => {
    const parsed = parseHttpMessage(requestText);
    if (parsed) useCatcher.getState().addRepeater(parsed);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex-1 text-[12px] font-medium text-fg">{t("Scanner")}</span>
        <span className="text-[11px] text-fg-faint">{t("{n} issues", { n: issues.length })}</span>
        {(tasks.length > 0 || issues.length > 0) && (
          <button type="button" onClick={() => useScanner.getState().clear()} title={t("Clear scans")} className="rounded-sm p-1 text-fg-faint hover:bg-hover hover:text-fg">
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {}
      <div className="shrink-0 border-b border-line p-2">
        <div className="flex items-center gap-1 pb-1">
          <span className="flex-1 text-[10px] uppercase tracking-wide text-fg-faint">{t("Paste a request with parameters, then scan")}</span>
          <button type="button" onClick={launch} disabled={!draft.trim()} className="flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-hover disabled:opacity-40">
            <Play className="size-3" strokeWidth={2} fill="currentColor" />
            {t("Scan")}
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"GET https://host/path?q=1\nHost: host\n\n"}
          spellCheck={false}
          rows={3}
          className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
        />
        <div className="mt-2 flex items-center gap-1">
          <Network className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <input
            value={crawlSeed}
            onChange={(e) => setCrawlSeed(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && crawlSeed.trim()) useScanner.getState().crawlScan(crawlSeed.trim());
            }}
            placeholder={t("Crawl & scan a whole site from a URL…")}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-0.5 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
          />
          <button type="button" onClick={() => crawlSeed.trim() && useScanner.getState().crawlScan(crawlSeed.trim())} disabled={!crawlSeed.trim()} className="flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-[11px] text-sky-300 hover:bg-hover disabled:opacity-40">
            <Network className="size-3" strokeWidth={2} />
            {t("Crawl")}
          </button>
        </div>
        <div className="mt-2">
          <button type="button" onClick={() => setShowSession((v) => !v)} className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-fg-faint transition-colors duration-100 hover:text-fg">
            <KeyRound className="size-3" strokeWidth={1.75} />
            {t("Authenticated session")}
            {session.trim() && <span className="text-emerald-400">•</span>}
          </button>
          {showSession && (
            <textarea
              value={session}
              onChange={(e) => useScanner.getState().setSession(e.target.value)}
              placeholder={"Authorization: Bearer …\nCookie: session=…"}
              spellCheck={false}
              rows={2}
              className="mt-1 w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
            />
          )}
        </div>
      </div>

      {}
      {tasks.length > 0 && (
        <div className="max-h-32 shrink-0 overflow-auto border-b border-line">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 px-3 py-1 text-[11px]">
              <span className="min-w-0 flex-1 truncate font-mono text-fg-dim" title={task.requestText}>
                {task.target}
              </span>
              <span className="tabular-nums text-fg-faint">
                {task.done}/{task.total || "…"}
              </span>
              {task.issueCount > 0 && <span className="tabular-nums text-amber-400">{task.issueCount} ⚑</span>}
              {task.status === "running" ? (
                <button type="button" onClick={() => useScanner.getState().cancel(task.id)} className="rounded-sm p-0.5 text-status-error hover:bg-hover" title={t("Cancel")}>
                  <Square className="size-3" strokeWidth={2} fill="currentColor" />
                </button>
              ) : (
                <span className="text-[10px] text-fg-faint">{task.status === "cancelled" ? t("cancelled") : t("done")}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {}
      <div className="min-h-0 flex-1 overflow-auto">
        {sortedIssues.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-fg-faint">{t("No issues yet. Scan a request to begin.")}</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-[10px] uppercase tracking-wide text-fg-faint">
                <th className="border-b border-line px-2 py-1 font-normal">{t("severity")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("issue")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("point")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedIssues.map((issue) => (
                <tr
                  key={issue.id}
                  onClick={() => useScanner.getState().select(issue.id)}
                  className={cn("cursor-pointer border-b border-line text-[11px] hover:bg-hover", selected === issue.id && "bg-selected")}
                >
                  <td className={cn("px-2 py-0.5 font-medium uppercase", SEV_TONE[issue.severity])}>{issue.severity}</td>
                  <td className="px-2 py-0.5 text-fg">{issue.name}</td>
                  <td className="max-w-32 truncate px-2 py-0.5 font-mono text-fg-dim" title={issue.point}>
                    {issue.point}
                  </td>
                  <td className="px-2 py-0.5 font-mono tabular-nums text-fg-faint">{issue.status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {chosen && (
        <div className="max-h-[32vh] shrink-0 overflow-auto border-t border-line p-2">
          <div className="flex items-center gap-2 pb-1">
            <span className={cn("text-[11px] font-medium uppercase", SEV_TONE[chosen.severity])}>{chosen.severity}</span>
            <span className="flex-1 truncate text-[11px] text-fg">
              {chosen.name} — <span className="font-mono text-fg-dim">{chosen.point}</span>
              {chosen.cwe ? ` [${chosen.cwe}]` : ""}
            </span>
            <button type="button" onClick={() => sendToRepeater(chosen.request)} className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim hover:bg-hover hover:text-fg">
              <Repeat2 className="size-3" strokeWidth={1.75} />
              {t("Repeater")}
            </button>
          </div>
          <div className="pb-1 text-[10px] uppercase tracking-wide text-fg-faint">{t("Evidence")}</div>
          <pre className="whitespace-pre-wrap break-all rounded-sm bg-canvas px-2 py-1 font-mono text-[11px] text-amber-300">{chosen.evidence}</pre>
          <div className="py-1 text-[10px] uppercase tracking-wide text-fg-faint">{t("Request")}</div>
          <pre className="whitespace-pre-wrap break-all rounded-sm bg-canvas px-2 py-1 font-mono text-[11px] text-fg-dim">{chosen.request}</pre>
        </div>
      )}
    </div>
  );
}
