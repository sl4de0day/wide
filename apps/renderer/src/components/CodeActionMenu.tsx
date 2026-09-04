import { Lightbulb, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCodeAction } from "@/stores/codeAction";

export function CodeActionMenu() {
  const t = useT();
  const active = useCodeAction((state) => state.active);
  const actions = useCodeAction((state) => state.actions);
  const x = useCodeAction((state) => state.x);
  const y = useCodeAction((state) => state.y);
  const busy = useCodeAction((state) => state.busy);
  const error = useCodeAction((state) => state.error);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (active) setCursor(0);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        useCodeAction.getState().cancel();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((c) => (c + 1) % Math.max(1, actions.length));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((c) => (c - 1 + actions.length) % Math.max(1, actions.length));
      } else if (event.key === "Enter") {
        event.preventDefault();
        void useCodeAction.getState().run(cursor);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, actions.length, cursor]);

  if (!active) return null;

  const left = Math.min(x, window.innerWidth - 320);
  const top = Math.min(y, window.innerHeight - 220);

  return (
    <div
      className="wide-pop-up fixed z-50 flex max-h-[280px] w-[300px] flex-col overflow-hidden rounded-md border border-line bg-panel shadow-lg"
      style={{ left, top }}
    >
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {actions.map((action, index) => (
          <button
            key={`${action.title}-${index}`}
            type="button"
            onMouseEnter={() => setCursor(index)}
            onClick={() => void useCodeAction.getState().run(index)}
            className={cn(
              "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors duration-100",
              index === cursor ? "bg-selected text-fg-bright" : "text-fg hover:bg-hover",
            )}
          >
            {action.kind === "refactor" ? (
              <Wrench className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
            ) : (
              <Lightbulb className="size-3.5 shrink-0 text-amber-400" strokeWidth={1.75} />
            )}
            <span className="min-w-0 flex-1 truncate">{action.title}</span>
          </button>
        ))}
      </div>
      {(busy || error) && (
        <p
          className={cn(
            "shrink-0 border-t border-line px-2.5 py-1 text-[10px]",
            error ? "text-status-error" : "text-fg-faint",
          )}
        >
          {error || t("Applying…")}
        </p>
      )}
    </div>
  );
}
