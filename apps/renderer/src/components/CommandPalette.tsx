import { Command as CommandIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatCombo, shortcutFor, useCommandPalette, type Command } from "@/stores/commands";

export function CommandPalette() {
  const t = useT();
  const open = useCommandPalette((state) => state.open);
  const commands = useCommandPalette((state) => state.commands);
  const bindings = useCommandPalette((state) => state.bindings);
  const active = useCommandPalette((state) => state.active);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      useCommandPalette.getState().setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const results = useMemo(() => {
    const available = commands.filter((command) => !command.when || command.when());
    const q = query.trim().toLowerCase();
    const scored = available
      .map((command) => ({ command, title: t(command.title).toLowerCase() }))
      .filter((entry) => !q || entry.title.includes(q))
      .sort((a, b) => {
        if (!q) return 0;

        return Number(b.title.startsWith(q)) - Number(a.title.startsWith(q));
      });
    return scored.map((entry) => entry.command);
  }, [commands, query, t]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (command: Command | undefined) => {
    if (!command) return;
    useCommandPalette.getState().close();
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      useCommandPalette.getState().move(1, results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      useCommandPalette.getState().move(-1, results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      useCommandPalette.getState().close();
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => useCommandPalette.getState().close()} />
      <div role="dialog" aria-modal="true" aria-label={t("Command palette")} className="wide-enter-fade fixed left-1/2 top-24 z-50 flex max-h-[60vh] w-[min(560px,90vw)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <CommandIcon className="size-4 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("Type a command…")}
            spellCheck={false}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="cmdpalette-list"
            aria-activedescendant={results.length > 0 ? `cmdpalette-opt-${active}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
          />
        </div>

        <div id="cmdpalette-list" role="listbox" aria-label={t("Commands")} className="min-h-0 flex-1 overflow-auto py-1">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-fg-faint">{t("No commands match.")}</p>
          ) : (
            results.map((command, index) => (
              <button
                key={command.id}
                id={`cmdpalette-opt-${index}`}
                role="option"
                aria-selected={index === active}
                ref={index === active ? activeRef : undefined}
                type="button"
                onMouseMove={() => useCommandPalette.getState().setActive(index)}
                onClick={() => choose(command)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100",
                  index === active ? "bg-selected" : "hover:bg-hover",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{t(command.title)}</span>
                {(() => {
                  const combo = shortcutFor(command, bindings);
                  return combo ? (
                    <kbd className="shrink-0 rounded-sm border border-line bg-panel px-1 text-[10px] text-fg-dim">{formatCombo(combo)}</kbd>
                  ) : null;
                })()}
                {command.group && (
                  <span className="shrink-0 text-[11px] text-fg-faint">{t(command.group)}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
