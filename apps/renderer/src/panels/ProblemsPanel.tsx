import { CircleAlert, Copy, FileDown, Network, RefreshCw, ShieldCheck, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Diagnostic, ProjectScanFinding } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { bridge } from "@/lib/bridge";
import { cn, basename, copyText } from "@/lib/utils";
import { toast } from "@/stores/toast";
import { useDiagnostics } from "@/stores/diagnostics";
import { useEditor } from "@/stores/editor";
import { SecurityRulesModal } from "@/components/SecurityRulesModal";
import { useProjectScan } from "@/stores/projectScan";
import { useWorkspace } from "@/stores/workspace";

type Tab = "problems" | "vulnerabilities";

function certain(severity: Diagnostic["severity"]): boolean {
  return severity === "error" || severity === "warning";
}

export function ProblemsPanel() {
  const bySource = useDiagnostics((state) => state.bySource);
  const tabs = useEditor((state) => state.tabs);
  const revealAt = useEditor((state) => state.revealAt);
  const root = useWorkspace((state) => state.root);
  const t = useT();
  const [tab, setTab] = useState<Tab>("problems");
  const [showRules, setShowRules] = useState(false);
  const scanFindings = useProjectScan((state) => state.findings);
  const scanning = useProjectScan((state) => state.scanning);
  const projectProblems = useDiagnostics((state) => state.projectProblems);
  const tsScanning = useDiagnostics((state) => state.scanning);

  useEffect(() => {
    if (root) void useDiagnostics.getState().scanProject(root);
  }, [root]);

  const { problems, vulns } = useMemo(() => {
    const problems: Record<string, Diagnostic[]> = {};
    const vulns: Record<string, Diagnostic[]> = {};
    for (const [path, sources] of Object.entries(bySource)) {
      const security = sources.security ?? [];
      const rest = Object.entries(sources)
        .filter(([source]) => source !== "security")
        .flatMap(([, list]) => list ?? [])
        .sort((a, b) => a.from - b.from);
      if (rest.length) problems[path] = rest;
      if (security.length) vulns[path] = security;
    }
    return { problems, vulns };
  }, [bySource]);

  const count = (group: Record<string, Diagnostic[]>) =>
    Object.values(group).reduce((sum, list) => sum + list.length, 0);
  const active = tab === "vulnerabilities" ? vulns : problems;
  const entries = Object.entries(active).filter(([, list]) => list.length > 0);

  const scanByFile = useMemo(() => {
    const groups: Record<string, ProjectScanFinding[]> = {};
    for (const finding of scanFindings) (groups[finding.file] ??= []).push(finding);
    return Object.entries(groups);
  }, [scanFindings]);

  const lineFor = (path: string, from: number): number => {
    const ft = tabs.find((item) => item.path === path);
    if (ft?.kind !== "file") return 1;
    let line = 1;
    for (let i = 0; i < Math.min(from, ft.content.length); i += 1) if (ft.content[i] === "\n") line += 1;
    return line;
  };

  const rowText = (path: string, d: Diagnostic) =>
    `${basename(path)}:${lineFor(path, d.from)}  ${d.message.split("\n")[0]}`;
  const scanRowText = (f: ProjectScanFinding) =>
    `${basename(f.file)}:${f.line}  ${f.message.split("\n")[0]}` +
    (f.relatedFile ? `  <- ${basename(f.relatedFile)}:${f.relatedLine}` : "");
  const copy = (text: string) => void copyText(text);

  const buildCopyRows = () =>
    tab === "vulnerabilities"
      ? [
          ...scanFindings.map(scanRowText),
          ...entries.flatMap(([path, list]) => list.map((d) => rowText(path, d))),
        ]
      : entries.flatMap(([path, list]) => list.map((d) => rowText(path, d)));
  const copyAll = () => copy(buildCopyRows().join("\n"));

  const hasRows = entries.length > 0 || (tab === "vulnerabilities" && scanFindings.length > 0);

  const [busy, setBusy] = useState(false);

  const exportFindings = async () => {
    if (!root || busy) return;
    setBusy(true);
    try {
      const reply = await bridge.securityExport(root, "sarif");
      if (!reply.ok || !reply.text) {
        toast.error(t(reply.error ?? "The findings could not be exported."));
        return;
      }
      const target = `${root}/wide-findings.sarif`;
      const written = await bridge.writeFile(target, reply.text);
      if (written.error) {
        toast.error(t(written.error));
        return;
      }
      toast.success(t("Wrote {count} findings to wide-findings.sarif.").replace("{count}", String(reply.count ?? 0)));
    } finally {
      setBusy(false);
    }
  };

  const setBaseline = async () => {
    if (!root || busy) return;
    setBusy(true);
    try {
      const reply = await bridge.securityBaseline(root, "set");
      if (!reply.ok) {
        toast.error(t(reply.error ?? "The baseline could not be saved."));
        return;
      }
      toast.success(t("Baseline set: {count} findings will stay hidden until they change.").replace("{count}", String(reply.count ?? 0)));
      void useProjectScan.getState().run();
    } finally {
      setBusy(false);
    }
  };

  const TabButton = ({ id, label, n }: { id: Tab; label: string; n: number }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 text-[11px] transition-colors duration-100",
        tab === id ? "border-b-2 border-accent text-fg-bright" : "text-fg-dim hover:text-fg",
      )}
    >
      {label}
      {n > 0 && <span className="rounded-sm bg-panel px-1 text-[10px] tabular-nums text-fg-faint">{n}</span>}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center border-b border-line">
        <TabButton id="problems" label={t("Problems")} n={count(problems)} />
        <TabButton id="vulnerabilities" label={t("Vulnerabilities")} n={count(vulns) + scanFindings.length} />
        <div className="ml-auto mr-2 flex items-center gap-1">
          {tab === "vulnerabilities" && (
            <>
              <button
                type="button"
                onClick={() => void exportFindings()}
                disabled={busy || scanFindings.length === 0}
                title={t("Export the project findings as SARIF")}
                className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                <FileDown className="size-3" strokeWidth={1.75} />
                {t("Export SARIF")}
              </button>
              <button
                type="button"
                onClick={() => void setBaseline()}
                disabled={busy || scanFindings.length === 0}
                title={t("Hide today's findings so only new ones show up from now on")}
                className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                <ShieldCheck className="size-3" strokeWidth={1.75} />
                {t("Set baseline")}
              </button>
              {root && (
                <button
                  type="button"
                  onClick={() => setShowRules(true)}
                  title={t("Write and test your own security rules")}
                  className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
                >
                  <SlidersHorizontal className="size-3" strokeWidth={1.75} />
                  {t("Custom rules")}
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={copyAll}
            disabled={!hasRows}
            title={t("Copy all")}
            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <Copy className="size-3" strokeWidth={1.75} />
            {t("Copy all")}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {tab === "vulnerabilities" && (
          <div className="mb-1 border-b border-line pb-1">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Network className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
              <span className="text-[11px] font-medium text-fg-muted">{t("Project scan (whole project)")}</span>
              <span className="tabular-nums text-[10px] text-fg-faint">{scanFindings.length}</span>
              {scanning && <RefreshCw className="ml-auto size-3 animate-spin text-fg-faint" strokeWidth={1.75} />}
            </div>
            {scanFindings.length === 0 ? (
              <p className="px-3 pb-1 text-[11px] text-fg-faint">
                {scanning ? t("Scanning…") : t("No findings in the project.")}
              </p>
            ) : (
              scanByFile.map(([file, list]) => (
                <div key={file}>
                  <p className="flex items-center gap-2 px-3 text-[12px] text-fg-muted" style={{ height: "var(--h-row)" }} title={file}>
                    <span className="truncate">{basename(file)}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-fg-faint">{list.length}</span>
                  </p>
                  {list.map((finding, index) => {
                    const red = finding.severity !== "info";
                    const Icon = red ? CircleAlert : TriangleAlert;
                    return (
                      <div key={`${file}:${index}`} className="group/row flex items-start hover:bg-hover">
                        <button
                          type="button"
                          onClick={() => void revealAt(finding.file, finding.line)}
                          title={finding.message}
                          className="flex min-w-0 flex-1 items-start gap-2 py-1 pl-7 pr-1 text-left text-[12px]"
                        >
                          <Icon className={cn("mt-0.5 size-3 shrink-0", red ? "text-status-error" : "text-status-warn")} strokeWidth={2} />
                          <span className="min-w-0 flex-1 truncate text-fg-dim">
                            {finding.message.split("\n")[0]}
                            {finding.relatedFile && (
                              <span className="text-fg-faint">
                                {" "}← {basename(finding.relatedFile)}:{finding.relatedLine}
                              </span>
                            )}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => copy(`${finding.file}:${finding.line}\n${finding.message}`)}
                          title={t("Copy")}
                          className="mr-2 mt-1 shrink-0 rounded-sm p-0.5 text-fg-faint opacity-0 transition-opacity duration-100 hover:text-fg group-hover/row:opacity-100"
                        >
                          <Copy className="size-3" strokeWidth={1.75} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
        {tab === "problems" && (
          <div className="mb-1 border-b border-line pb-1">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Network className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
              <span className="text-[11px] font-medium text-fg-muted">{t("TypeScript (whole project)")}</span>
              <span className="tabular-nums text-[10px] text-fg-faint">{projectProblems.length}</span>
              {tsScanning && <RefreshCw className="ml-auto size-3 animate-spin text-fg-faint" strokeWidth={1.75} />}
            </div>
            {projectProblems.length === 0 ? (
              <p className="px-3 pb-1 text-[11px] text-fg-faint">{tsScanning ? t("Scanning…") : t("No type errors in the project.")}</p>
            ) : (
              projectProblems.slice(0, 500).map((problem, index) => (
                <button
                  key={`${problem.file}:${problem.line}:${index}`}
                  type="button"
                  onClick={() => void useEditor.getState().revealAt(problem.file, problem.line, problem.column)}
                  title={`${problem.file}:${problem.line}`}
                  className="flex w-full items-start gap-2 px-3 py-0.5 text-left text-[11px] hover:bg-hover"
                >
                  {problem.severity === "error" ? <CircleAlert className="mt-0.5 size-3 shrink-0 text-status-error" strokeWidth={1.75} /> : <TriangleAlert className="mt-0.5 size-3 shrink-0 text-amber-400" strokeWidth={1.75} />}
                  <span className="min-w-0 flex-1">
                    <span className="text-fg">{problem.message.split("\n")[0]}</span>
                    <span className="text-fg-faint"> — {basename(problem.file)}:{problem.line}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        {entries.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">
            {tab === "vulnerabilities" ? t("No vulnerabilities in the open files.") : t("No problems in the open files.")}
          </p>
        ) : (
          entries.map(([path, list]) => (
            <div key={path}>
              <p
                className="flex items-center gap-2 px-3 text-[12px] text-fg-muted"
                style={{ height: "var(--h-row)" }}
                title={path}
              >
                <span className="truncate">{basename(path)}</span>
                <span className="ml-auto shrink-0 tabular-nums text-fg-faint">{list.length}</span>
              </p>
              {list.map((diagnostic, index) => {
                const red = certain(diagnostic.severity);
                const Icon = red ? CircleAlert : TriangleAlert;
                return (
                  <div key={`${path}:${index}`} className="group/row flex items-start hover:bg-hover">
                    <button
                      type="button"
                      onClick={() => void revealAt(path, lineFor(path, diagnostic.from))}
                      title={diagnostic.message}
                      className="flex min-w-0 flex-1 items-start gap-2 py-1 pl-7 pr-1 text-left text-[12px]"
                    >
                      <Icon
                        className={cn("mt-0.5 size-3 shrink-0", red ? "text-status-error" : "text-status-warn")}
                        strokeWidth={2}
                      />
                      <span className="min-w-0 flex-1 truncate text-fg-dim">{diagnostic.message.split("\n")[0]}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => copy(`${path}:${lineFor(path, diagnostic.from)}\n${diagnostic.message}`)}
                      title={t("Copy")}
                      className="mr-2 mt-1 shrink-0 rounded-sm p-0.5 text-fg-faint opacity-0 transition-opacity duration-100 hover:text-fg group-hover/row:opacity-100"
                    >
                      <Copy className="size-3" strokeWidth={1.75} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      {showRules && root && <SecurityRulesModal root={root} onClose={() => setShowRules(false)} />}
    </div>
  );
}
