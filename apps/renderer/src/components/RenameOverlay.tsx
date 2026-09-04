import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n";
import { useRename } from "@/stores/rename";

export function RenameOverlay() {
  const t = useT();
  const active = useRename((state) => state.active);
  const oldName = useRename((state) => state.oldName);
  const x = useRename((state) => state.x);
  const y = useRename((state) => state.y);
  const busy = useRename((state) => state.busy);
  const error = useRename((state) => state.error);
  const [value, setValue] = useState(oldName);
  const input = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (active) setValue(oldName);
  }, [active, oldName]);

  useEffect(() => {
    if (!active) return;
    const element = input.current;
    if (element) {
      element.focus();
      element.select();
    }
  }, [active]);

  if (!active) return null;

  const left = Math.min(x, window.innerWidth - 240);
  const top = Math.min(y, window.innerHeight - 80);

  return (
    <div
      className="wide-pop-up fixed z-50 flex flex-col gap-1 rounded-md border border-line bg-panel p-1.5 shadow-lg"
      style={{ left, top, width: 220 }}
    >
      <input
        ref={input}
        value={value}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void useRename.getState().submit(value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            useRename.getState().cancel();
          }
        }}
        onBlur={() => {

          if (!useRename.getState().busy) useRename.getState().cancel();
        }}
        spellCheck={false}
        aria-label={t("New name")}
        className="w-full rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-accent disabled:opacity-50"
      />
      <p className="px-0.5 text-[10px] leading-snug text-fg-faint">
        {error ? <span className="text-status-error">{error}</span> : busy ? t("Renaming…") : t("Enter to rename, Esc to cancel")}
      </p>
    </div>
  );
}
