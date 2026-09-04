import { ChevronDown, ChevronUp, X } from "lucide-react";

import { useT } from "@/lib/i18n";

export function FindBar({
  query,
  onQuery,
  active,
  count,
  onStep,
  onClose,
}: {
  query: string;
  onQuery: (q: string) => void;
  active: number;
  count: number;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const current = count === 0 ? 0 : (((active % count) + count) % count) + 1;
  return (
    <div className="flex items-center gap-1 rounded-md border border-line bg-panel px-1.5 py-1 shadow-lg">
      <input
        autoFocus
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t("Find")}
        spellCheck={false}
        className="w-32 bg-transparent text-[11px] text-fg outline-none placeholder:text-fg-faint"
      />
      <span className="min-w-9 text-right text-[10px] tabular-nums text-fg-faint">
        {current}/{count}
      </span>
      <button type="button" onClick={() => onStep(-1)} disabled={count === 0} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-40" aria-label={t("Previous match")}>
        <ChevronUp className="size-3.5" strokeWidth={2} />
      </button>
      <button type="button" onClick={() => onStep(1)} disabled={count === 0} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-40" aria-label={t("Next match")}>
        <ChevronDown className="size-3.5" strokeWidth={2} />
      </button>
      <button type="button" onClick={onClose} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg" aria-label={t("Close")}>
        <X className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
