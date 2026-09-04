import { FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { fileMark } from "@/lib/fileIcons";
import { useT } from "@/lib/i18n";
import { basename, cn } from "@/lib/utils";
import { useQuickOpen, type QuickFile } from "@/stores/quickOpen";
import { useWorkspace } from "@/stores/workspace";

function score(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let ti = 0;
  let total = 0;
  let prev = -2;
  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      let point = 1;
      if (ti === prev + 1) point += 3;
      if (ti === 0 || t[ti - 1] === "/") point += 4;
      total += point;
      prev = ti;
      qi += 1;
    }
    ti += 1;
  }
  if (qi < q.length) return null;

  return total - target.length * 0.05;
}

export function QuickOpenOverlay() {
  const t = useT();
  const open = useQuickOpen((state) => state.open);
  const items = useQuickOpen((state) => state.items);
  const active = useQuickOpen((state) => state.active);
  const root = useWorkspace((state) => state.root);
  const [query, setQuery] = useState("");
  const files = useRef<QuickFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    inputRef.current?.focus();
    let alive = true;
    void (async () => {
      const reply = root ? await bridge.listProjectFiles(root) : { files: [] };
      if (!alive) return;
      files.current = reply.files ?? [];

      useQuickOpen.getState().setItems(files.current.slice(0, 50));
    })();
    return () => {
      alive = false;
    };
  }, [open, root]);

  const parsed = useMemo(() => {
    const match = /^(.*?):(\d+)\s*$/.exec(query);
    return match ? { text: match[1].trim(), line: Number(match[2]) } : { text: query.trim(), line: 0 };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const q = parsed.text;
    if (!q) {
      useQuickOpen.getState().setItems(files.current.slice(0, 50));
      return;
    }
    const scored: { file: QuickFile; s: number }[] = [];
    for (const file of files.current) {
      const s = score(q, file.relativePath);
      if (s !== null) scored.push({ file, s });
    }
    scored.sort((a, b) => b.s - a.s);
    useQuickOpen.getState().setItems(scored.slice(0, 200).map((entry) => entry.file));
  }, [parsed.text, open]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      useQuickOpen.getState().move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      useQuickOpen.getState().move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      useQuickOpen.getState().choose(undefined, parsed.line);
    } else if (event.key === "Escape") {
      event.preventDefault();
      useQuickOpen.getState().close();
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => useQuickOpen.getState().close()} />
      <div className="wide-enter-fade fixed left-1/2 top-24 z-50 flex max-h-[60vh] w-[min(560px,90vw)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <FileText className="size-4 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("Go to file…")}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-1">
          {items.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-fg-faint">
              {root ? t("No files match.") : t("Open a folder first.")}
            </p>
          ) : (
            items.map((file, index) => {
              const mark = fileMark(file.relativePath);
              const dir = file.relativePath.includes("/")
                ? file.relativePath.slice(0, file.relativePath.lastIndexOf("/"))
                : "";
              return (
                <button
                  key={file.path}
                  ref={index === active ? activeRef : undefined}
                  type="button"
                  onMouseMove={() => useQuickOpen.getState().setActive(index)}
                  onClick={() => useQuickOpen.getState().choose(index, parsed.line)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100",
                    index === active ? "bg-selected" : "hover:bg-hover",
                  )}
                >
                  {mark && mark.kind === "mark" ? (
                    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill={mark.colour} aria-hidden="true">
                      <path d={mark.path} />
                    </svg>
                  ) : mark && mark.kind === "icon" ? (
                    <mark.Icon className="size-3.5 shrink-0" strokeWidth={1.5} style={{ color: mark.colour }} />
                  ) : (
                    <FileText className="size-3.5 shrink-0 text-fg-dim" strokeWidth={1.5} />
                  )}
                  <span className="shrink-0 truncate text-[12px] text-fg">{basename(file.relativePath)}</span>
                  {dir && <span className="shrink truncate text-[11px] text-fg-faint">{dir}</span>}
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
