import { GitCompare, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import { byteDiff, lineDiff, wordDiff } from "@/lib/lineDiff";
import { cn } from "@/lib/utils";
import { useComparer } from "@/stores/comparer";

export function ComparerOverlay() {
  const t = useT();
  const open = useComparer((state) => state.open);
  const left = useComparer((state) => state.left);
  const right = useComparer((state) => state.right);

  const [mode, setMode] = useState<"lines" | "words" | "bytes">("lines");
  const rows = useMemo(() => {
    if (!left && !right) return [];
    if (mode === "words") return wordDiff(left, right);
    if (mode === "bytes") return byteDiff(left, right);
    return lineDiff(left, right);
  }, [left, right, mode]);
  const changed = useMemo(() => rows.filter((row) => row.type !== "same").length, [rows]);
  const inline = mode !== "lines";

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={() => useComparer.getState().close()} />
      <div className="wide-enter-fade fixed left-1/2 top-12 z-50 flex max-h-[84vh] w-[min(860px,94vw)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <GitCompare className="size-4 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <span className="flex-1 text-[12px] font-medium text-fg">{t("Comparer")}</span>
          <div className="flex items-center gap-0.5 rounded-sm border border-line p-0.5">
            {(["lines", "words", "bytes"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-[10px] transition-colors duration-100",
                  mode === m ? "bg-hover text-fg" : "text-fg-faint hover:text-fg",
                )}
              >
                {m === "lines" ? t("Lines") : m === "words" ? t("Words") : t("Bytes")}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-fg-faint">
            {changed === 0
              ? t("Identical")
              : mode === "lines"
                ? t("{count} differing lines", { count: changed })
                : t("{count} differences", { count: changed })}
          </span>
          <button
            type="button"
            onClick={() => useComparer.getState().close()}
            className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
            aria-label={t("Close")}
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-line p-2">
          <textarea
            value={left}
            onChange={(event) => useComparer.getState().setLeft(event.target.value)}
            placeholder={t("Left…")}
            spellCheck={false}
            rows={5}
            className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
          />
          <textarea
            value={right}
            onChange={(event) => useComparer.getState().setRight(event.target.value)}
            placeholder={t("Right…")}
            spellCheck={false}
            rows={5}
            className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {rows.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-fg-faint">{t("Paste two things to compare.")}</p>
          ) : (
            inline ? (
              <p className="whitespace-pre-wrap break-all px-1 font-mono text-[11px] leading-relaxed text-fg-dim">
                {rows.map((row, index) => (
                  <span
                    key={index}
                    className={cn(
                      row.type === "add" && "bg-emerald-500/20 text-emerald-300",
                      row.type === "del" && "bg-rose-500/20 text-rose-300 line-through",
                    )}
                  >
                    {row.text}
                  </span>
                ))}
              </p>
            ) : (
            <pre className="font-mono text-[11px] leading-relaxed">
              {rows.map((row, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex gap-2 whitespace-pre-wrap break-all px-1",
                    row.type === "add" && "bg-emerald-500/10 text-emerald-300",
                    row.type === "del" && "bg-rose-500/10 text-rose-300",
                    row.type === "same" && "text-fg-dim",
                  )}
                >
                  <span className="shrink-0 select-none text-fg-faint">
                    {row.type === "add" ? "+" : row.type === "del" ? "−" : " "}
                  </span>
                  <span>{row.text || " "}</span>
                </div>
              ))}
            </pre>
            )
          )}
        </div>
      </div>
    </>
  );
}
