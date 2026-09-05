import { ClipboardCopy, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import { useT } from "@/lib/i18n";
import { cn, copyText } from "@/lib/utils";
import { findingsReport, SEVERITIES, useFindings, type Severity } from "@/stores/findings";

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

  const copyReport = async () => {
    if (await copyText(findingsReport(findings))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
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

      <div className="min-h-0 flex-1 overflow-auto">
        {findings.length === 0 ? (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-fg-faint">
            {t("Nothing recorded yet. Add an issue, or send one here from the proxy or the comparer.")}
          </p>
        ) : (
          findings.map((finding) => (
            <div key={finding.id} className="border-b border-line">
              <button type="button" onClick={() => setOpen(open === finding.id ? null : finding.id)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover">
                <span className={cn("shrink-0 rounded-sm border px-1 py-0.5 text-[9px] uppercase", SEVERITY_TONE[finding.severity])}>
                  {t(finding.severity)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{t(finding.title)}</span>
              </button>
              {open === finding.id && (
                <div className="px-2 pb-2">
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
                  <button type="button" onClick={() => useFindings.getState().remove(finding.id)} className="mt-1 flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-rose-300">
                    <X className="size-3" strokeWidth={1.75} />
                    {t("Remove")}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
