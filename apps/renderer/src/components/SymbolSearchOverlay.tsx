import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge, type SymbolHit } from "@/lib/bridge";
import { languageInstalled } from "@/editor/languages";
import { useT } from "@/lib/i18n";
import { basename, cn, extname } from "@/lib/utils";
import { useActiveTab } from "@/stores/editor";
import { useSymbolSearch } from "@/stores/symbolSearch";
import { useWorkspace } from "@/stores/workspace";
import { TS_EXTENSIONS, outlineIcon } from "@/panels/StructurePanel";

export function SymbolSearchOverlay() {
  const t = useT();
  const open = useSymbolSearch((state) => state.open);
  const items = useSymbolSearch((state) => state.items);
  const active = useSymbolSearch((state) => state.active);
  const tab = useActiveTab();
  const root = useWorkspace((state) => state.root);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      useSymbolSearch.getState().setItems([]);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      useSymbolSearch.getState().setItems([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      const ext = tab?.kind === "file" ? extname(tab.path) : "";
      let hits: SymbolHit[] = [];
      try {
        if (tab?.kind === "file" && !TS_EXTENSIONS.has(ext) && languageInstalled(tab.path)) {
          hits = (await bridge.lspWorkspaceSymbol(tab.path, q)).items;
        } else if (root) {
          hits = (await bridge.tsNavigateTo(root, q)).items;
        } else {
          hits = [];
        }
      } catch {
        hits = [];
      }
      if (alive) useSymbolSearch.getState().setItems(hits ?? []);
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, open, tab?.path, root]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      useSymbolSearch.getState().move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      useSymbolSearch.getState().move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      useSymbolSearch.getState().choose();
    } else if (event.key === "Escape") {
      event.preventDefault();
      useSymbolSearch.getState().close();
    }
  };

  return (
    <>
      {}
      <div className="fixed inset-0 z-40" onClick={() => useSymbolSearch.getState().close()} />
      <div className="wide-enter-fade fixed left-1/2 top-24 z-50 flex max-h-[60vh] w-[min(560px,90vw)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <Search className="size-4 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("Go to symbol in project…")}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-1">
          {items.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-fg-faint">
              {query.trim() ? t("No symbols match.") : t("Type to search the project's symbols.")}
            </p>
          ) : (
            items.map((hit, index) => {
              const Icon = outlineIcon(hit.kind);
              return (
                <button
                  key={`${hit.file}-${hit.line}-${hit.name}-${index}`}
                  ref={index === active ? activeRef : undefined}
                  type="button"
                  onMouseMove={() => useSymbolSearch.getState().setActive(index)}
                  onClick={() => useSymbolSearch.getState().choose(index)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100",
                    index === active ? "bg-selected" : "hover:bg-hover",
                  )}
                >
                  <Icon className="size-3.5 shrink-0 text-fg-dim" strokeWidth={1.5} />
                  <span className="shrink-0 truncate text-[12px] text-fg">{hit.name}</span>
                  {hit.container && (
                    <span className="shrink truncate text-[11px] text-fg-faint">{hit.container}</span>
                  )}
                  <span className="ml-auto shrink-0 truncate pl-2 text-[11px] text-fg-faint" title={hit.file}>
                    {basename(hit.file)}:{hit.line + 1}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
