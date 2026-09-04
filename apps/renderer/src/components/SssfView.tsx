import { CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { bridge, type SssfRecord, type SssfStatus, type SssfVerdict } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function Record({ record }: { record: SssfRecord }) {
  const t = useT();
  if (record.malformed) {
    return (
      <div className="border-b border-line px-3 py-1.5 text-[11px] text-status-error">
        {t("A line of the log could not be read.")}
      </div>
    );
  }

  const denied = record.decision === "deny";
  const blocked = denied && record.enforced;
  const at = record.at ? new Date(record.at) : null;
  const clock = at
    ? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}:${String(at.getSeconds()).padStart(2, "0")}`
    : "";

  return (
    <div className="flex items-baseline gap-2 border-b border-line px-3 py-1.5 text-[12px]">
      <span className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-fg-faint">{clock}</span>
      {}
      <span
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          blocked ? "bg-status-error" : denied ? "bg-amber-400" : "bg-emerald-400",
        )}
        title={blocked ? t("Blocked") : denied ? t("Denied, but only logged") : t("Allowed")}
      />
      {}
      <span
        className={cn(
          "w-8 shrink-0 text-[10px] uppercase tracking-wide",
          record.subject === "ai" ? "text-accent" : "text-fg-faint",
        )}
      >
        {record.subject === "ai" ? t("AI") : record.subject === "system" ? t("Sys") : t("You")}
      </span>
      <span className="w-28 shrink-0 truncate font-mono text-[11px] text-fg-dim" title={record.capability}>
        {record.capability}
      </span>
      <span className="min-w-0 flex-1 truncate text-fg" title={record.channel || record.tool || ""}>
        {record.channel || record.tool || ""}
        {record.target ? <span className="text-fg-faint"> · {record.target}</span> : null}
      </span>
      {record.limited && (
        <span className="shrink-0 text-[10px] text-amber-400">{t("rate limited")}</span>
      )}
      {denied && record.reason && (
        <span className="shrink-0 truncate text-[11px] text-status-error" title={record.reason}>
          {record.reason}
        </span>
      )}
    </div>
  );
}

export function SssfView() {
  const t = useT();
  const [status, setStatus] = useState<SssfStatus | null>(null);
  const [records, setRecords] = useState<SssfRecord[]>([]);
  const [verdict, setVerdict] = useState<SssfVerdict | null>(null);
  const [busy, setBusy] = useState(false);

  const [filter, setFilter] = useState<"all" | "deny" | "ai">("all");

  const refresh = useCallback(async () => {
    setBusy(true);
    const [s, tail, v] = await Promise.all([
      bridge.sssfStatus(),
      bridge.sssfTail(500),
      bridge.sssfVerify(),
    ]);
    if (s.ok) setStatus(s.status ?? null);
    if (tail.ok) setRecords(tail.records ?? []);
    if (v.ok) setVerdict(v.result ?? null);
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reload = async () => {
    setBusy(true);
    const reply = await bridge.sssfReload();
    if (reply.ok) setStatus(reply.status ?? null);
    await refresh();
  };

  const shown = useMemo(() => {
    if (filter === "deny") return records.filter((record) => record.decision === "deny");
    if (filter === "ai") return records.filter((record) => record.subject === "ai");
    return records;
  }, [records, filter]);

  const denies = useMemo(
    () => records.filter((record) => record.decision === "deny").length,
    [records],
  );

  return (
    <div className="wide-enter-fade flex h-full flex-col bg-canvas">
      <div className="shrink-0 overflow-auto px-6 py-5">
        <div className="mx-auto w-full max-w-[820px]">
          <div className="flex items-center gap-2">
            <h1 className="text-[16px] font-semibold text-fg-bright">{t("Security")}</h1>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              title={t("Refresh")}
              aria-label={t("Refresh")}
              className="rounded-sm p-1.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} strokeWidth={1.75} />
            </button>
          </div>

          {}
          {status && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line bg-panel px-3 py-2.5 text-[12px]">
              {status.degraded ? (
                <span className="flex items-center gap-1.5 text-status-error">
                  <ShieldAlert className="size-4" strokeWidth={1.75} />
                  {t("The policy did not compile.")}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <ShieldCheck className="size-4" strokeWidth={1.75} />
                  {status.mode === "enforce"
                    ? t("Enforcing")
                    : status.mode === "audit"
                      ? t("Logging only")
                      : t("Off")}
                </span>
              )}
              <span className="text-fg-faint">
                {t("Fails {mode}", { mode: status.failMode === "open" ? t("open") : t("closed") })}
              </span>
              <span className="text-fg-faint">
                {t("{count} capabilities", { count: status.stats?.capabilities ?? status.capabilities.length })}
              </span>
              {status.lastError && (
                <span className="w-full truncate text-[11px] text-status-error" title={status.lastError}>
                  {status.lastError}
                </span>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => void reload()}
                disabled={busy}
                className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {t("Reload policy")}
              </button>
            </div>
          )}

          {}
          {verdict && (
            <div className="mt-2 flex items-center gap-1.5 text-[12px]">
              {verdict.ok ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-400" strokeWidth={1.75} />
                  <span className="text-fg-dim">
                    {verdict.chained
                      ? t("The audit chain is intact across {count} records.", { count: verdict.records })
                      : t("The audit log is not chained.")}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="size-4 text-status-error" strokeWidth={1.75} />
                  <span className="text-status-error">
                    {t("The chain breaks at record {n} — the log was altered.", {
                      n: verdict.brokenAt ?? 0,
                    })}
                  </span>
                </>
              )}
            </div>
          )}

          {}
          <div className="mt-5 flex items-center gap-2">
            <h2 className="text-[11px] uppercase tracking-wide text-fg-faint">{t("Recent decisions")}</h2>
            <span className="flex-1" />
            {(["all", "deny", "ai"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-[11px] transition-colors duration-100",
                  filter === key ? "bg-selected text-fg-bright" : "text-fg-faint hover:bg-hover hover:text-fg",
                )}
              >
                {key === "all"
                  ? t("All")
                  : key === "deny"
                    ? `${t("Refused")}${denies ? ` (${denies})` : ""}`
                    : t("Assistant")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[820px] px-3 pb-6">
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-fg-faint">
              {records.length === 0
                ? t("Nothing has been decided yet.")
                : t("Nothing matches that filter.")}
            </p>
          ) : (
            shown.map((record, index) => <Record key={record.seq ?? index} record={record} />)
          )}
        </div>
      </div>
    </div>
  );
}
