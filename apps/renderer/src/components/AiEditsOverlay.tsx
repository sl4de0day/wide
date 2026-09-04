import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import { diffCounts, lineDiff } from "@/lib/lineDiff";
import { basename, cn } from "@/lib/utils";
import { useAiEdits, type PendingEdit } from "@/stores/aiEdits";

function EditRow({ edit }: { edit: PendingEdit }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => lineDiff(edit.oldContent, edit.content), [edit.oldContent, edit.content]);
  const { added, removed } = useMemo(() => diffCounts(rows), [rows]);

  return (
    <div className="border-b border-line">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
          {open ? <ChevronDown className="size-3 shrink-0 text-fg-faint" strokeWidth={2} /> : <ChevronRight className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />}
          <span className="truncate text-[12px] text-fg" title={edit.path}>
            {basename(edit.path)}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-emerald-400">+{added}</span>
          <span className="shrink-0 font-mono text-[10px] text-rose-400">−{removed}</span>
        </button>
        <button
          type="button"
          onClick={() => useAiEdits.getState().accept(edit.id)}
          className="shrink-0 rounded-sm border border-line bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 transition-colors duration-100 hover:bg-emerald-500/20"
        >
          {t("Accept")}
        </button>
        <button
          type="button"
          onClick={() => useAiEdits.getState().reject(edit.id)}
          className="shrink-0 rounded-sm border border-line bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-300 transition-colors duration-100 hover:bg-rose-500/20"
        >
          {t("Reject")}
        </button>
      </div>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-line bg-canvas font-mono text-[11px] leading-relaxed">
          {rows.map((row, index) => (
            <div
              key={index}
              className={cn(
                "flex gap-2 whitespace-pre-wrap break-all px-2",
                row.type === "add" && "bg-emerald-500/10 text-emerald-300",
                row.type === "del" && "bg-rose-500/10 text-rose-300",
                row.type === "same" && "text-fg-dim",
              )}
            >
              <span className="shrink-0 select-none text-fg-faint">{row.type === "add" ? "+" : row.type === "del" ? "−" : " "}</span>
              <span>{row.text || " "}</span>
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

export function AiEditsOverlay() {
  const t = useT();
  const pending = useAiEdits((state) => state.pending);
  const reviewEnabled = useAiEdits((state) => state.reviewEnabled);

  if (pending.length === 0) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" />
      <div className="wide-enter-fade fixed left-1/2 top-16 z-50 flex max-h-[80vh] w-[min(720px,94vw)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <Check className="size-4 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <span className="flex-1 text-[12px] font-medium text-fg">
            {t("{count} proposed edits", { count: pending.length })}
          </span>
          <button
            type="button"
            onClick={() => useAiEdits.getState().acceptAll()}
            className="rounded-sm border border-line bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 transition-colors duration-100 hover:bg-emerald-500/20"
          >
            {t("Accept all")}
          </button>
          <button
            type="button"
            onClick={() => useAiEdits.getState().rejectAll()}
            className="rounded-sm border border-line bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 transition-colors duration-100 hover:bg-rose-500/20"
          >
            {t("Reject all")}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {pending.map((edit) => (
            <EditRow key={edit.id} edit={edit} />
          ))}
        </div>

        <label className="flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-1.5 text-[11px] text-fg-faint">
          <input type="checkbox" checked={reviewEnabled} onChange={(e) => useAiEdits.getState().setReview(e.target.checked)} className="size-3" />
          {t("Review the assistant's edits before applying")}
        </label>
      </div>
    </>
  );
}
