import { FileCode, Pin, Sparkles, Terminal, Settings, Globe, Radio } from "lucide-react";
import { useEffect, useRef } from "react";

import { useT } from "@/lib/i18n";
import { cn, normalisePath } from "@/lib/utils";
import { useEditor, type Tab } from "@/stores/editor";
import { useTabSwitcher } from "@/stores/tabSwitcher";
import { useWorkspace } from "@/stores/workspace";

function getTabIcon(tab: Tab) {
  if (tab.kind === "catcher") return Radio;
  if (tab.kind === "pitcher") return Radio;
  if (tab.kind === "browser") return Globe;
  if (tab.path === "wide://settings") return Settings;
  if (tab.path.startsWith("wide://ai/")) return Sparkles;
  if (tab.path.startsWith("wide://terminal")) return Terminal;
  return FileCode;
}

export function TabSwitcherOverlay() {
  const t = useT();
  const isOpen = useTabSwitcher((state) => state.isOpen);
  const selectedIndex = useTabSwitcher((state) => state.selectedIndex);
  const close = useTabSwitcher((state) => state.close);
  const confirm = useTabSwitcher((state) => state.confirm);
  const next = useTabSwitcher((state) => state.next);
  const prev = useTabSwitcher((state) => state.prev);
  const setIndex = useTabSwitcher((state) => state.setIndex);

  const tabs = useEditor((state) => state.tabs);
  const root = useWorkspace((state) => state.root);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") {
        confirm();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) prev();
        else next();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        prev();
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [isOpen, confirm, close, next, prev]);

  useEffect(() => {
    if (!isOpen) return;
    const selectedEl = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    selectedEl?.scrollIntoView({ block: "nearest" });
  }, [isOpen, selectedIndex]);

  if (!isOpen || tabs.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40 backdrop-blur-xs select-none"
      onClick={close}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-line-strong bg-panel p-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-2.5 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
          <span>{t("Switch Tab (Ctrl+Tab)")}</span>
          <span className="text-[10px] lowercase text-fg-dim font-normal">
            {t("Release Ctrl to switch")}
          </span>
        </div>

        <div ref={listRef} className="mt-1 max-h-72 overflow-y-auto space-y-0.5">
          {tabs.map((tab, idx) => {
            const isSelected = idx === selectedIndex;
            const Icon = getTabIcon(tab);
            const isFile = tab.kind === "file";
            const relativePath =
              isFile && root
                ? normalisePath(tab.path).slice(normalisePath(root).length + 1)
                : tab.path;

            return (
              <div
                key={tab.path}
                onMouseEnter={() => setIndex(idx)}
                onClick={() => {
                  setIndex(idx);
                  confirm();
                }}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer",
                  isSelected
                    ? "bg-accent/15 text-accent border border-accent/30 font-medium"
                    : "text-fg-dim hover:bg-hover hover:text-fg border border-transparent",
                )}
              >
                <Icon className={cn("size-4 shrink-0", isSelected ? "text-accent" : "opacity-70")} />

                <span className="truncate font-medium">{tab.name}</span>

                {tab.pinned && (
                  <Pin className="size-3 shrink-0 text-accent/80 rotate-45" />
                )}

                <div className="flex-1" />

                {isFile && relativePath !== tab.name && (
                  <span className="max-w-[180px] truncate text-[11px] text-fg-faint">
                    {relativePath}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

