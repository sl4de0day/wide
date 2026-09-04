import { X } from "lucide-react";
import { useEffect } from "react";

import { useT } from "@/lib/i18n";
import { useReferences } from "@/stores/references";

export function ReferencesOverlay() {
  const t = useT();
  const open = useReferences((state) => state.open);
  const query = useReferences((state) => state.query);
  const groups = useReferences((state) => state.groups);
  const total = useReferences((state) => state.total);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") useReferences.getState().close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="wide-enter-fade absolute bottom-3 right-3 z-40 flex max-h-[60%] w-[340px] flex-col overflow-hidden rounded-md border border-line bg-panel shadow-lg">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg">
          {t("{count} uses of {name}", { count: total, name: query })}
        </span>
        <button
          type="button"
          onClick={() => useReferences.getState().close()}
          title={t("Close")}
          aria-label={t("Close")}
          className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {groups.map((group) => (
          <div key={group.file}>
            <p className="truncate px-3 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-fg-faint" title={group.file}>
              {group.name}
              <span className="ml-1.5 normal-case tracking-normal text-fg-faint/70">
                {group.locations.length}
              </span>
            </p>
            {group.locations.map((location, index) => (
              <button
                key={`${location.start}-${index}`}
                type="button"
                onClick={() => useReferences.getState().go(location)}
                className="flex w-full items-center gap-2 px-3 py-1 text-left transition-colors duration-100 hover:bg-hover"
              >
                <span
                  className={cnDot(location.write)}
                  title={location.write ? t("Written here") : t("Read here")}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-dim">
                  {t("offset {offset}", { offset: location.start })}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function cnDot(write?: boolean): string {
  return `size-1.5 shrink-0 rounded-full ${write ? "bg-amber-400" : "bg-fg-faint/50"}`;
}
