import { Bell, CheckCircle2, CircleAlert, EyeOff, Radio, Server, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { languageLabel } from "@/editor/languages";
import { useT } from "@/lib/i18n";
import { cn, normalisePath } from "@/lib/utils";
import { useDiagnostics } from "@/stores/diagnostics";
import { useActiveTab, useEditor } from "@/stores/editor";
import { useProjectScan } from "@/stores/projectScan";
import { useProxy } from "@/stores/proxy";
import { useRemote } from "@/stores/remote";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";
import { toast, useToast } from "@/stores/toast";

function ProxyChip({ onOpenPanel }: { onOpenPanel: (id: string) => void }) {
  const running = useProxy((state) => state.running);
  const port = useProxy((state) => state.port);
  const intercepting = useProxy((state) => state.intercepting);
  const heldCount = useProxy((state) => state.held.length + state.heldResponses.length);

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      onOpenPanel("proxy");
      return;
    }
    if (!running) {
      void useProxy.getState().start();
    } else {
      void useProxy.getState().setIntercept(!intercepting);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onOpenPanel("proxy");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={
        !running
          ? "Catcher Proxy: Stopped (Click to start · Shift-click for Proxy Panel)"
          : intercepting
            ? `Catcher Proxy: Intercepting on port ${port} (Click to pass through · Shift-click for Panel)`
            : `Catcher Proxy: Listening on port ${port} (Click to intercept · Shift-click for Panel)`
      }
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-sans transition-colors duration-100",
        !running && "text-fg-faint hover:text-fg hover:bg-hover/60",
        running && !intercepting && "bg-emerald-500/10 text-emerald-400 font-medium hover:bg-emerald-500/20",
        running && intercepting && "bg-amber-500/15 text-amber-400 font-medium animate-pulse hover:bg-amber-500/25",
      )}
    >
      {running ? (
        <span className={cn("size-1.5 rounded-full shrink-0", intercepting ? "bg-amber-400" : "bg-emerald-400")} />
      ) : (
        <Radio className="size-3 text-fg-faint shrink-0" strokeWidth={2} />
      )}
      <span>
        {!running
          ? "Proxy"
          : intercepting
            ? `Intercept: ${heldCount ? `(${heldCount})` : "On"}`
            : `Proxy: ${port || 8080}`}
      </span>
    </button>
  );
}

function StreamerChip() {
  const streamerMode = useSettings((state) => state.streamerMode);

  if (!streamerMode) return null;

  return (
    <button
      type="button"
      onClick={() => {
        useSettings.getState().set({ streamerMode: false });
        toast.info("Streamer mode disabled");
      }}
      title="Streamer Mode is ON (Secrets & keys are masked). Click to disable."
      className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30 transition-colors"
    >
      <EyeOff className="size-3" strokeWidth={2} />
      <span>Streamer Mode</span>
    </button>
  );
}

function RemoteChip() {
  const t = useT();
  const active = useRemote((state) => state.profiles.find((p) => p.id === state.activeId) ?? null);

  if (!active) return null;
  return (
    <span
      title={t("The terminal is connected to {host}.", { host: active.host })}
      className="flex shrink-0 items-center gap-1 rounded-sm px-1 text-accent"
    >
      <Server className="size-3" strokeWidth={2} />
      <span className="max-w-40 truncate">{active.name || active.host}</span>
    </span>
  );
}

function NotificationBell() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const history = useToast((state) => state.history);
  const clear = useToast((state) => state.clearHistory);

  return (
    <div className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("Notifications ({count})", { count: history.length })}
        aria-label={t("Notifications")}
        className={cn(
          "flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] transition-colors duration-100 hover:bg-hover",
          open ? "text-fg bg-hover" : "text-fg-dim hover:text-fg"
        )}
      >
        <Bell className="size-3" strokeWidth={1.75} />
        {history.length > 0 && (
          <span className="flex size-3.5 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-bg">
            {history.length > 9 ? "9+" : history.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="wide-pop-up absolute bottom-full right-0 z-50 mb-1 flex max-h-80 w-80 flex-col overflow-hidden rounded-md border border-line bg-panel shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-dim">
                {t("Notifications")}
              </span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clear}
                  className="text-[10px] text-fg-faint transition-colors hover:text-fg"
                >
                  {t("Clear all")}
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto divide-y divide-line/40">
              {history.length === 0 ? (
                <p className="px-3 py-6 text-center text-[11px] text-fg-faint">
                  {t("No notifications")}
                </p>
              ) : (
                history.map((item) => {
                  const when = new Date(item.timestamp);
                  const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
                  return (
                    <div key={item.id} className="flex items-start gap-2 px-3 py-2 text-left">
                      <span
                        className={cn(
                          "mt-1 size-1.5 shrink-0 rounded-full",
                          item.kind === "error"
                            ? "bg-status-error"
                            : item.kind === "success"
                            ? "bg-status-ok"
                            : "bg-accent"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] leading-snug text-fg break-words">{item.message}</p>
                        <span className="text-[9px] text-fg-faint">{time}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Breadcrumbs({
  path,
  root,
  rootName,
  onOpenPanel,
}: {
  path: string;
  root: string | null;
  rootName: string;
  onOpenPanel: (id: string) => void;
}) {
  const relative = root ? normalisePath(path).slice(normalisePath(root).length + 1) : normalisePath(path);
  const parts = [rootName, ...relative.split("/")].filter(Boolean);

  const sep = path.includes("\\") ? "\\" : "/";
  const dirs: string[] = [];
  if (root) {
    let acc = normalisePath(root).replace(/\/+$/, "").split("/").join(sep);
    dirs.push(acc);
    for (const seg of relative.split("/").filter(Boolean).slice(0, -1)) {
      acc = acc + sep + seg;
      dirs.push(acc);
    }
  }

  const revealDir = (index: number) => {
    const target = dirs.slice(0, index + 1);
    if (target.length === 0) return;
    void useWorkspace.getState().expandTo(target);
    onOpenPanel("project");
  };

  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      {parts.map((part, index) => {
        const isFile = index === parts.length - 1;
        return (
          <span key={`${part}-${index}`} className="flex items-center gap-1">
            {index > 0 && <span className="text-fg-faint">›</span>}
            {isFile || !root ? (
              <span className={isFile ? "text-fg" : "text-fg-dim"}>{part}</span>
            ) : (
              <button
                type="button"
                onClick={() => revealDir(index)}
                className="text-fg-dim transition-colors duration-100 hover:text-fg"
              >
                {part}
              </button>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function StatusBar({ onOpenPanel }: { onOpenPanel: (id: string) => void }) {
  const tab = useActiveTab();
  const cursor = useEditor((state) => state.cursor);
  const root = useWorkspace((state) => state.root);
  const rootName = useWorkspace((state) => state.rootName);

  const errors = useDiagnostics((state) => state.problemTotals.errors);
  const warnings = useDiagnostics((state) => state.problemTotals.warnings);
  const securityCount = useDiagnostics((state) => state.securityCount);
  const scanCount = useProjectScan((state) => state.findings.length);
  const vulnCount = securityCount + scanCount;
  const tabSize = useSettings((state) => state.tabSize);
  const t = useT();
  const file = tab?.kind === "file" ? tab : null;

  return (
    <footer
      className="flex shrink-0 items-center gap-2 border-t border-line/40 bg-chrome px-3 text-[11px] font-sans text-fg-dim select-none"
      style={{ height: "var(--h-statusbar)" }}
    >
      <button
        type="button"
        title={t("Problems: {errors} errors, {warnings} warnings (Click to open Problems)", {
          errors,
          warnings,
        })}
        onClick={() => onOpenPanel("problems")}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 tabular-nums text-[11px] font-sans transition-colors duration-100 hover:bg-hover",
          errors === 0 && warnings === 0 ? "text-fg-faint" : "text-fg",
        )}
      >
        {errors === 0 && warnings === 0 ? (
          <span className="flex items-center gap-1 text-fg-faint hover:text-fg">
            <CheckCircle2 className="size-3 text-emerald-400/80" strokeWidth={2} />
            <span>0</span>
          </span>
        ) : (
          <>
            <span className={cn("flex items-center gap-1", errors > 0 ? "text-status-error font-medium" : "text-fg-faint")}>
              <CircleAlert className="size-3" strokeWidth={2} />
              {errors}
            </span>
            <span className={cn("flex items-center gap-1", warnings > 0 ? "text-status-warn font-medium" : "text-fg-faint")}>
              <TriangleAlert className="size-3" strokeWidth={2} />
              {warnings}
            </span>
          </>
        )}
      </button>

      <button
        type="button"
        title={t("Security Findings & Vulnerabilities: {vulns} detected (Click to open Findings panel)", {
          vulns: vulnCount,
        })}
        onClick={() => onOpenPanel("findings")}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 tabular-nums text-[11px] font-sans transition-all duration-100",
          vulnCount > 0
            ? "bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 font-medium"
            : "text-fg-faint hover:text-fg hover:bg-hover/60",
        )}
      >
        {vulnCount > 0 ? (
          <ShieldAlert className="size-3 shrink-0" strokeWidth={2} />
        ) : (
          <ShieldCheck className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
        )}
        <span>{vulnCount > 0 ? `Vulns: ${vulnCount}` : "Vulns"}</span>
      </button>

      {file ? (
        <Breadcrumbs path={file.path} root={root} rootName={rootName} onOpenPanel={onOpenPanel} />
      ) : (
        <span className="text-fg-faint">{tab ? (tab.kind === "file" ? tab.name : t(tab.name)) : t("Ready")}</span>
      )}

      <div className="flex-1" />

      <StreamerChip />
      <ProxyChip onOpenPanel={onOpenPanel} />
      <RemoteChip />
      <NotificationBell />

      {file && (
        <div className="flex shrink-0 items-center divide-x divide-line/30 text-[11px] font-sans text-fg-faint">
          <span className="px-2 tabular-nums text-fg-dim hover:text-fg">
            {cursor.line}:{cursor.column}
          </span>
          <span className="px-2 text-fg-dim hover:text-fg">{t("{n} spaces", { n: tabSize })}</span>
          <span className="px-2 text-fg-dim hover:text-fg">{t(languageLabel(file.path))}</span>
          <span className="px-2 text-fg-dim hover:text-fg">UTF-8</span>
        </div>
      )}
    </footer>
  );
}
