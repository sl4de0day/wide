import { Folder, FolderOpen, History, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useRecentProjects } from "@/stores/recentProjects";
import { useWorkspace } from "@/stores/workspace";
import type { Project } from "@/lib/bridge";

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return "";
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function RecentProjectsOverlay() {
  const isOpen = useRecentProjects((state) => state.isOpen);
  const projects = useRecentProjects((state) => state.projects);
  const loading = useRecentProjects((state) => state.loading);
  const close = useRecentProjects((state) => state.close);
  const currentRoot = useWorkspace((state) => state.root);
  const openPath = useWorkspace((state) => state.openPath);
  const openFolder = useWorkspace((state) => state.openFolder);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q),
    );
  }, [projects, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = async (project: Project) => {
    if (project.missing) return;
    close();
    await openPath(project.path);
  };

  const handleOpenOther = async () => {
    close();
    await openFolder();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const total = filtered.length + 1; // +1 for "Open other folder..."
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex < filtered.length) {
        const picked = filtered[selectedIndex];
        if (picked) void handleSelect(picked);
      } else {
        void handleOpenOther();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40 backdrop-blur-xs select-none">
      <div className="fixed inset-0" onClick={close} />

      <div
        className="wide-enter-fade relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        {/* Header with Search */}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 bg-canvas">
          <History className="size-4 text-accent shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recent projects and workspaces... (Ctrl+R)"
            className="w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint font-sans"
          />
          <button
            type="button"
            onClick={close}
            className="rounded p-0.5 text-fg-dim hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* Project List */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-fg-faint">
              Loading recent projects...
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-fg-faint">
              No recent projects matching &ldquo;{query}&rdquo;
            </div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === selectedIndex;
              const isCurrent = currentRoot === item.path;

              return (
                <div
                  key={item.path}
                  onClick={() => void handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "flex items-center gap-3 px-3.5 py-2 cursor-pointer text-xs transition-colors",
                    isSelected ? "bg-selected text-fg-bright" : "hover:bg-hover text-fg",
                    item.missing && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <Folder
                    className={cn(
                      "size-4 shrink-0",
                      isCurrent ? "text-accent" : "text-fg-faint",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{item.name}</span>
                      {isCurrent && (
                        <span className="rounded bg-accent/20 px-1 py-0.2 text-[9px] font-semibold text-accent">
                          Current
                        </span>
                      )}
                      {item.missing && (
                        <span className="rounded bg-status-danger/20 px-1 py-0.2 text-[9px] text-status-danger">
                          Missing
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-fg-faint truncate">
                      {item.path}
                    </div>
                  </div>
                  {item.openedAt && (
                    <span className="text-[10px] text-fg-faint shrink-0 tabular-nums">
                      {formatRelativeTime(item.openedAt)}
                    </span>
                  )}
                </div>
              );
            })
          )}

          {/* Option: Open other folder */}
          <div
            onClick={() => void handleOpenOther()}
            onMouseEnter={() => setSelectedIndex(filtered.length)}
            className={cn(
              "flex items-center gap-3 border-t border-line/60 px-3.5 py-2 cursor-pointer text-xs transition-colors mt-1",
              selectedIndex === filtered.length
                ? "bg-selected text-fg-bright"
                : "hover:bg-hover text-fg-dim",
            )}
          >
            <FolderOpen className="size-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <span className="font-medium">Open other folder...</span>
              <div className="text-[10px] text-fg-faint">Browse filesystem for project</div>
            </div>
            <span className="text-[10px] font-mono text-fg-faint">Ctrl+O</span>
          </div>
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between border-t border-line bg-chrome px-3 py-1.5 text-[10px] text-fg-faint">
          <span>{filtered.length} recent project(s)</span>
          <span>Esc to close · ↑↓ to navigate · Enter to open</span>
        </div>
      </div>
    </div>
  );
}
