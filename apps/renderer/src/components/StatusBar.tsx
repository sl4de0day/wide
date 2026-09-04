import { ArrowUpCircle, CircleAlert, Server, ShieldAlert, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { languageLabel } from "@/editor/languages";
import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn, normalisePath } from "@/lib/utils";
import { useDiagnostics } from "@/stores/diagnostics";
import { useActiveTab, useEditor } from "@/stores/editor";
import { useProjectScan } from "@/stores/projectScan";
import { useSettings } from "@/stores/settings";
import { useUpdate } from "@/stores/update";
import { useWorkspace } from "@/stores/workspace";

function UpdateChip() {
  const t = useT();
  const available = useUpdate((state) => state.available);
  const dismissed = useUpdate((state) => state.dismissed);
  const latest = useUpdate((state) => state.latest);
  const installing = useUpdate((state) => state.installing);

  if (!available || dismissed) return null;
  const label =
    installing === "download"
      ? t("Downloading…")
      : installing === "install"
        ? t("Installing…")
        : t("Update {version}", { version: latest });
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-sm bg-accent/15 px-1.5 text-accent">
      <button
        type="button"
        disabled={installing !== "idle"}
        onClick={() => void useUpdate.getState().install()}
        title={t("Wide {version} is available — download and install it now.", { version: latest })}
        className="flex items-center gap-1 disabled:opacity-70"
      >
        <ArrowUpCircle className={cn("size-3", installing !== "idle" && "wide-pulse")} strokeWidth={2} />
        <span>{label}</span>
      </button>
      {installing === "idle" && (
        <button
          type="button"
          onClick={() => useUpdate.getState().dismiss()}
          title={t("Dismiss")}
          className="text-accent/70 transition-colors duration-100 hover:text-accent"
        >
          ×
        </button>
      )}
    </span>
  );
}

function RemoteChip() {
  const t = useT();
  const [host, setHost] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void bridge
      .remoteGet()
      .then((reply) => {
        if (!alive || !reply.ok) return;
        const config = reply.config;
        setHost(config?.currentlyRemote ? config.host ?? t("remote") : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [t]);

  if (!host) return null;
  return (
    <button
      type="button"
      title={t("The backend is running on {host}. Open Settings → Remote.", { host })}
      onClick={() => useEditor.getState().openSettings()}
      className="flex shrink-0 items-center gap-1 rounded-sm px-1 text-accent transition-colors duration-100 hover:bg-hover"
    >
      <Server className="size-3" strokeWidth={2} />
      <span className="max-w-40 truncate">{host}</span>
    </button>
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
      className="flex shrink-0 items-center gap-3 border-t border-line bg-chrome px-3 text-[12px] text-fg-dim"
      style={{ height: "var(--h-statusbar)" }}
    >
      <button
        type="button"
        title={t("Problems: {errors} errors, {warnings} warnings · Vulnerabilities: {vulns}", {
          errors,
          warnings,
          vulns: vulnCount,
        })}
        onClick={() => onOpenPanel("problems")}
        className={cn(
          "flex shrink-0 items-center gap-2 rounded-sm px-1 tabular-nums",
          "transition-colors duration-100 hover:bg-hover",
        )}
      >
        <span className={cn("flex items-center gap-1", errors > 0 && "text-status-error")}>
          <CircleAlert className="size-3" strokeWidth={2} />
          {errors}
        </span>
        <span className={cn("flex items-center gap-1", warnings > 0 && "text-status-warn")}>
          <TriangleAlert className="size-3" strokeWidth={2} />
          {warnings}
        </span>
        <span
          className={cn("flex items-center gap-1 border-l border-line pl-2", vulnCount > 0 && "text-status-error")}
          title={t("Vulnerabilities (open files and whole-project scan)")}
        >
          <ShieldAlert className="size-3" strokeWidth={2} />
          {vulnCount}
        </span>
      </button>

      {file ? (
        <Breadcrumbs path={file.path} root={root} rootName={rootName} onOpenPanel={onOpenPanel} />
      ) : (
        <span className="text-fg-faint">{tab ? tab.name : t("Ready")}</span>
      )}

      <div className="flex-1" />

      <UpdateChip />
      <RemoteChip />

      {file && (
        <>
          <span className="shrink-0 tabular-nums">
            {cursor.line}:{cursor.column}
          </span>
          <span className="shrink-0">{t("{n} spaces", { n: tabSize })}</span>
          <span className="shrink-0">{t(languageLabel(file.path))}</span>
          <span className="shrink-0">UTF-8</span>
        </>
      )}
    </footer>
  );
}
