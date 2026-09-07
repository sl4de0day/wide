import { ClipboardCopy, DatabaseZap, FileDown, Filter, GitCompareArrows, Plus, Printer, Radar, RotateCw, ScrollText, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import { Modal } from "@/components/ui/Modal";
import { bridge, type ProjectScanFinding } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { canVerifyLive, verifyFindingLive } from "@/lib/liveVerify";
import { emptyReportMeta, pentestReportHtml, pentestReportMarkdown, type ReportMeta } from "@/lib/pentestReport";
import { cn, copyText } from "@/lib/utils";
import { diffFindings, FINDING_STATUSES, findingsReport, findingsReportHtml, findingsReportJson, parseImportedFindings, SEVERITIES, useFindings, type Finding, type FindingStatus, type Severity } from "@/stores/findings";
import { useProjectScan } from "@/stores/projectScan";
import { toast } from "@/stores/toast";
import { useWorkspace } from "@/stores/workspace";

function scanToFinding(f: ProjectScanFinding, i: number): Finding {
  const severity: Severity = f.severity === "error" ? "high" : f.severity === "warning" ? "medium" : "info";
  return {
    id: `scan-${i}`,
    title: `${f.ruleId}${f.cwe ? ` (${f.cwe})` : ""}`,
    severity,
    location: `${f.file}:${f.line}`,
    detail: f.message,
    status: "open",
    at: 0,
  };
}

function printHtml(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  iframe.srcdoc = html;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      void 0;
    }
    setTimeout(() => iframe.remove(), 2000);
  };
  document.body.appendChild(iframe);
}

const REPORT_META_KEY = "wide.report.meta";
function loadReportMeta(): ReportMeta {
  try {
    const raw = localStorage.getItem(REPORT_META_KEY);
    if (raw) return { ...emptyReportMeta(), ...JSON.parse(raw), date: new Date().toISOString().slice(0, 10) };
  } catch {
    void 0;
  }
  return emptyReportMeta();
}

function ReportDialog({ findings, onClose }: { findings: Finding[]; onClose: () => void }) {
  const t = useT();
  const [meta, setMeta] = useState<ReportMeta>(loadReportMeta);

  const persist = (next: ReportMeta) => {
    setMeta(next);
    try {
      localStorage.setItem(REPORT_META_KEY, JSON.stringify(next));
    } catch {
      void 0;
    }
  };
  const field = (key: keyof ReportMeta, value: string | boolean) => persist({ ...meta, [key]: value });

  const saveTo = async (ext: "html" | "md", body: string) => {
    const root = useWorkspace.getState().root;
    if (!root) {
      toast.error(t("Open a project to save the report."));
      return;
    }
    const written = await bridge.writeFile(`${root}/wide-pentest-report.${ext}`, body);
    if (written.error) toast.error(t(written.error));
    else toast.success(t("Report saved to wide-pentest-report.{ext}.", { ext }));
  };

  const input =
    "w-full rounded-sm border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint";
  const label = "text-[11px] uppercase tracking-wide text-fg-faint";

  return (
    <Modal title={t("Generate report")} onClose={onClose} wide>
      <div className="flex max-h-[70vh] flex-col gap-2 overflow-auto">
        <div>
          <p className={label}>{t("Report title")}</p>
          <input value={meta.title} onChange={(e) => field("title", e.target.value)} className={cn(input, "mt-1")} spellCheck={false} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className={label}>{t("Client")}</p>
            <input value={meta.client} onChange={(e) => field("client", e.target.value)} className={cn(input, "mt-1")} spellCheck={false} />
          </div>
          <div>
            <p className={label}>{t("Target")}</p>
            <input value={meta.target} onChange={(e) => field("target", e.target.value)} className={cn(input, "mt-1 font-mono")} spellCheck={false} />
          </div>
          <div>
            <p className={label}>{t("Prepared by")}</p>
            <input value={meta.author} onChange={(e) => field("author", e.target.value)} className={cn(input, "mt-1")} spellCheck={false} />
          </div>
          <div>
            <p className={label}>{t("Date")}</p>
            <input value={meta.date} onChange={(e) => field("date", e.target.value)} className={cn(input, "mt-1 font-mono")} spellCheck={false} />
          </div>
        </div>
        <div>
          <p className={label}>{t("Scope")}</p>
          <textarea value={meta.scope} onChange={(e) => field("scope", e.target.value)} rows={2} className={cn(input, "mt-1 resize-y")} spellCheck={false} />
        </div>
        <div>
          <p className={label}>{t("Executive summary")}</p>
          <textarea value={meta.summary} onChange={(e) => field("summary", e.target.value)} rows={3} className={cn(input, "mt-1 resize-y")} spellCheck={false} />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-fg-dim">
          <input type="checkbox" checked={meta.confidential} onChange={(e) => field("confidential", e.target.checked)} />
          {t("Mark as confidential")}
        </label>
        <p className="text-[11px] text-fg-faint">{t("{count} findings will be included.", { count: findings.length })}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button type="button" onClick={() => printHtml(pentestReportHtml(meta, findings))} className="flex items-center gap-1.5 rounded-sm border border-accent px-3 py-1.5 text-[12px] text-accent transition-colors duration-100 hover:bg-accent hover:text-bg">
            <Printer className="size-3.5" strokeWidth={1.75} />
            {t("Print / Save as PDF")}
          </button>
          <button type="button" onClick={() => void saveTo("html", pentestReportHtml(meta, findings))} className="rounded-sm border border-line px-3 py-1.5 text-[12px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
            {t("Save HTML")}
          </button>
          <button type="button" onClick={() => void saveTo("md", pentestReportMarkdown(meta, findings))} className="rounded-sm border border-line px-3 py-1.5 text-[12px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
            {t("Save Markdown")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const STATUS_TONE: Record<FindingStatus, string> = {
  open: "text-fg-dim",
  confirmed: "text-rose-300",
  "false-positive": "text-fg-faint line-through",
  fixed: "text-emerald-300 line-through",
};

const SEVERITY_TONE: Record<Severity, string> = {
  critical: "bg-rose-500/15 text-rose-300 border-rose-500/40",
  high: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  low: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  info: "bg-fg/10 text-fg-dim border-line",
};

function AddForm({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [location, setLocation] = useState("");
  const [detail, setDetail] = useState("");

  const submit = () => {
    if (!title.trim()) return;
    useFindings.getState().add({ title: title.trim(), severity, location: location.trim(), detail: detail.trim() });
    onClose();
  };

  const field =
    "w-full rounded-sm border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint";

  return (
    <div className="wide-enter-fade shrink-0 border-b border-line px-2 py-2">
      <div className="flex gap-1">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Title")} className={cn(field, "flex-1")} spellCheck={false} />
        <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className="rounded-sm border border-line bg-panel px-1 text-[11px] text-fg outline-none">
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
      </div>
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("Location (URL or file)")} className={cn(field, "mt-1")} spellCheck={false} />
      <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={t("Detail and evidence")} rows={3} className={cn(field, "mt-1 resize-y font-mono")} spellCheck={false} />
      <div className="mt-1 flex gap-1">
        <button type="button" onClick={submit} disabled={!title.trim()} className="flex-1 rounded-sm border border-line py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40">
          {t("Add")}
        </button>
        <button type="button" onClick={onClose} className="rounded-sm border border-line px-2 py-1 text-[11px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

export function FindingsPanel() {
  const t = useT();
  const findings = useFindings((state) => state.findings);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const scanCount = useProjectScan((state) => state.findings.length);
  const canReport = findings.length > 0 || scanCount > 0;
  const [hideResolved, setHideResolved] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [osv, setOsv] = useState<{ exists?: boolean; updatedAt?: string; count?: number } | null>(null);
  const [osvBusy, setOsvBusy] = useState(false);

  useEffect(() => {
    const root = useWorkspace.getState().root;
    if (!root) {
      setOsv(null);
      return;
    }
    let alive = true;
    void bridge.osvInfo(root).then((reply) => {
      if (alive && reply.ok) setOsv({ exists: reply.exists, updatedAt: reply.updatedAt, count: reply.count });
    });
    return () => {
      alive = false;
    };
  }, []);

  const refreshOsv = async () => {
    const root = useWorkspace.getState().root;
    if (!root) {
      toast.error(t("Open a project first."));
      return;
    }
    setOsvBusy(true);
    const reply = await bridge.osvRefresh(root);
    setOsvBusy(false);
    if (reply.ok) {
      toast.success(t("Vulnerability database refreshed: {count} advisories.", { count: reply.count ?? 0 }));
      const info = await bridge.osvInfo(root);
      if (info.ok) setOsv({ exists: info.exists, updatedAt: info.updatedAt, count: info.count });
    } else {
      toast.error(reply.error ? t(reply.error) : t("Could not refresh the vulnerability database."));
    }
  };
  const shown = useMemo(
    () => (hideResolved ? findings.filter((f) => f.status !== "fixed" && f.status !== "false-positive") : findings),
    [findings, hideResolved],
  );

  const copyReport = async () => {
    if (await copyText(findingsReport(findings))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const gatherReport = (): Finding[] => {
    const scan = useProjectScan.getState().findings.map(scanToFinding);
    return [...findings, ...scan];
  };

  const exportHtml = async () => {
    const root = useWorkspace.getState().root;
    if (!root) {
      toast.error(t("Open a project to save the report."));
      return;
    }
    const report = gatherReport();
    const written = await bridge.writeFile(`${root}/wide-findings-report.html`, findingsReportHtml(report));
    await bridge.writeFile(`${root}/wide-findings-report.json`, findingsReportJson(report));
    if (written.error) toast.error(t(written.error));
    else toast.success(t("Report saved to wide-findings-report.html and .json."));
  };

  const printReport = () => printHtml(findingsReportHtml(gatherReport()));

  const importFindings = async () => {
    const picked = await bridge.openFile();
    if (!picked) return;
    const file = await bridge.readFile(picked.path);
    if (file.error) {
      toast.error(t(file.error));
      return;
    }
    const parsed = parseImportedFindings(file.content);
    if (!parsed.length) {
      toast.error(t("No findings found in that file."));
      return;
    }
    for (const f of parsed) useFindings.getState().add(f);
    toast.success(t("Imported findings: {count}", { count: parsed.length }));
  };

  const compareFindings = async () => {
    const picked = await bridge.openFile();
    if (!picked) return;
    const file = await bridge.readFile(picked.path);
    if (file.error) {
      toast.error(t(file.error));
      return;
    }
    const parsed = parseImportedFindings(file.content);
    if (!parsed.length) {
      toast.error(t("No findings found in that file."));
      return;
    }
    const diff = diffFindings(gatherReport(), parsed);
    toast.success(t("Compared: {added} new, {resolved} resolved, {common} unchanged.", { added: diff.added, resolved: diff.resolved, common: diff.common }));
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Findings")}>
        <span className="flex-1" />
        {findings.length > 0 && (
          <button type="button" onClick={() => void copyReport()} title={t("Copy report (Markdown)")} aria-label={t("Copy report (Markdown)")} className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
            <ClipboardCopy className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        {canReport && (
          <button type="button" onClick={() => void exportHtml()} title={t("Export report (HTML)")} aria-label={t("Export report (HTML)")} className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
            <FileDown className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        {canReport && (
          <button type="button" onClick={printReport} title={t("Print / PDF")} aria-label={t("Print / PDF")} className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
            <Printer className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        {canReport && (
          <button type="button" onClick={() => setShowReport(true)} title={t("Generate report")} aria-label={t("Generate report")} className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
            <ScrollText className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        <button type="button" onClick={() => void importFindings()} title={t("Import findings (SARIF or JSON)")} aria-label={t("Import findings (SARIF or JSON)")} className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
          <Upload className="size-3.5" strokeWidth={1.5} />
        </button>
        {canReport && (
          <button type="button" onClick={() => void compareFindings()} title={t("Compare with a saved report")} aria-label={t("Compare with a saved report")} className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
            <GitCompareArrows className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        {findings.length > 0 && (
          <button type="button" onClick={() => setHideResolved((v) => !v)} aria-pressed={hideResolved} title={t("Hide resolved findings")} aria-label={t("Hide resolved findings")} className={cn("rounded-sm p-1 transition-colors duration-100 hover:bg-hover hover:text-fg", hideResolved ? "text-fg" : "text-fg-faint")}>
            <Filter className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        <button type="button" onClick={() => setAdding((v) => !v)} title={t("Add finding")} aria-label={t("Add finding")} className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
          <Plus className="size-3.5" strokeWidth={1.5} />
        </button>
        {findings.length > 0 && (
          <button type="button" onClick={() => useFindings.getState().clear()} title={t("Clear all")} aria-label={t("Clear all")} className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
      </PanelHeader>

      {copied && <p className="shrink-0 border-b border-line px-3 py-1 text-[11px] text-emerald-300">{t("Report copied.")}</p>}
      {adding && <AddForm onClose={() => setAdding(false)} />}
      {showReport && <ReportDialog findings={gatherReport()} onClose={() => setShowReport(false)} />}

      <div className="min-h-0 flex-1 overflow-auto">
        {findings.length === 0 ? (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-fg-faint">
            {t("Nothing recorded yet. Add an issue, or send one here from the proxy or the comparer.")}
          </p>
        ) : (
          shown.map((finding) => (
            <div key={finding.id} className="border-b border-line">
              <button type="button" onClick={() => setOpen(open === finding.id ? null : finding.id)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover">
                <span className={cn("shrink-0 rounded-sm border px-1 py-0.5 text-[9px] uppercase", SEVERITY_TONE[finding.severity])}>
                  {t(finding.severity)}
                </span>
                <span className={cn("min-w-0 flex-1 truncate text-[12px]", STATUS_TONE[finding.status ?? "open"])}>{t(finding.title)}</span>
              </button>
              {open === finding.id && (
                <div className="px-2 pb-2">
                  <div className="flex flex-wrap gap-1 pb-1.5">
                    {FINDING_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => useFindings.getState().update(finding.id, { status: s })}
                        className={cn(
                          "rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors duration-100",
                          (finding.status ?? "open") === s ? "border-line bg-selected text-fg-bright" : "border-line text-fg-faint hover:bg-hover hover:text-fg",
                        )}
                      >
                        {t(s)}
                      </button>
                    ))}
                  </div>
                  {finding.location && (
                    <p className="truncate pb-1 font-mono text-[10px] text-fg-faint" title={finding.location}>
                      {finding.location}
                    </p>
                  )}
                  {finding.detail && (
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg-dim">
                      {t(finding.detail)}
                    </pre>
                  )}
                  <div className="mt-1 flex items-center gap-1">
                    {canVerifyLive(finding.location) && (
                      <button
                        type="button"
                        onClick={() => void verifyFindingLive(finding.id)}
                        title={t("Send a live request to this route and see whether the issue reproduces")}
                        className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-accent"
                      >
                        <Radar className="size-3" strokeWidth={1.75} />
                        {t("Verify live")}
                      </button>
                    )}
                    <button type="button" onClick={() => useFindings.getState().remove(finding.id)} className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-rose-300">
                      <X className="size-3" strokeWidth={1.75} />
                      {t("Remove")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5">
        <DatabaseZap className="size-3 shrink-0 text-fg-faint" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[10px] text-fg-faint" title={t("Offline OSV advisory database used by the dependency scan.")}>
          {osv?.exists && osv.updatedAt
            ? t("OSV database: {date}", { date: new Date(osv.updatedAt).toLocaleDateString() })
            : t("OSV database: built-in snapshot")}
        </span>
        <button type="button" onClick={() => void refreshOsv()} disabled={osvBusy} title={t("Refresh the OSV database (runs osv-scanner)")} aria-label={t("Refresh the OSV database")} className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40">
          <RotateCw className={cn("size-3", osvBusy && "animate-spin")} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
