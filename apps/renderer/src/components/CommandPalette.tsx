import { Command as CommandIcon, FileText, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { basename, cn } from "@/lib/utils";
import { formatCombo, shortcutFor, useCommandPalette, type Command } from "@/stores/commands";
import { useEditor } from "@/stores/editor";
import { useFindings } from "@/stores/findings";
import { useWorkspace } from "@/stores/workspace";

type Entry =
  | { kind: "command"; command: Command }
  | { kind: "file"; path: string; relativePath: string }
  | { kind: "finding"; id: string; title: string; location: string };

export function CommandPalette() {
  const t = useT();
  const open = useCommandPalette((state) => state.open);
  const commands = useCommandPalette((state) => state.commands);
  const bindings = useCommandPalette((state) => state.bindings);
  const active = useCommandPalette((state) => state.active);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<{ path: string; relativePath: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      useCommandPalette.getState().setActive(0);
      inputRef.current?.focus();
      const root = useWorkspace.getState().root;
      if (root) void bridge.listProjectFiles(root).then((reply) => setFiles(reply.files ?? []));
      else setFiles([]);
    }
  }, [open]);

  const results = useMemo<Entry[]>(() => {
    const available = commands.filter((command) => !command.when || command.when());
    const q = query.trim().toLowerCase();
    const commandEntries = available
      .map((command) => ({ command, title: t(command.title).toLowerCase() }))
      .filter((entry) => !q || entry.title.includes(q))
      .sort((a, b) => (q ? Number(b.title.startsWith(q)) - Number(a.title.startsWith(q)) : 0))
      .map((entry): Entry => ({ kind: "command", command: entry.command }));

    if (!q) return commandEntries;

    const fileEntries: Entry[] = files
      .filter((file) => file.relativePath.toLowerCase().includes(q))
      .slice(0, 30)
      .map((file) => ({ kind: "file", path: file.path, relativePath: file.relativePath }));

    const findingEntries: Entry[] = useFindings
      .getState()
      .findings.filter((finding) => finding.title.toLowerCase().includes(q))
      .slice(0, 15)
      .map((finding) => ({ kind: "finding", id: finding.id, title: finding.title, location: finding.location }));

    return [...commandEntries, ...fileEntries, ...findingEntries];
  }, [commands, query, t, files]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    useCommandPalette.getState().close();
    if (entry.kind === "command") entry.command.run();
    else if (entry.kind === "file") void useEditor.getState().openFile(entry.path);
    else useCommandPalette.getState().runById("view.findings");
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
            placeholder={t("Search commands, files and findings…")}
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
            <p className="px-3 py-3 text-[12px] text-fg-faint">{t("Nothing matches.")}</p>
          ) : (
            results.map((entry, index) => {
              const key =
                entry.kind === "command"
                  ? `c:${entry.command.id}`
                  : entry.kind === "file"
                    ? `f:${entry.path}`
                    : `v:${entry.id}`;
              const combo = entry.kind === "command" ? shortcutFor(entry.command, bindings) : null;
              return (
                <button
                  key={key}
                  id={`cmdpalette-opt-${index}`}
                  role="option"
                  aria-selected={index === active}
                  ref={index === active ? activeRef : undefined}
                  type="button"
                  onMouseMove={() => useCommandPalette.getState().setActive(index)}
                  onClick={() => choose(entry)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100",
                    index === active ? "bg-selected" : "hover:bg-hover",
                  )}
                >
                  {entry.kind === "file" && <FileText className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />}
                  {entry.kind === "finding" && <ShieldAlert className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg">
                    {entry.kind === "command"
                      ? t(entry.command.title)
                      : entry.kind === "file"
                        ? basename(entry.relativePath)
                        : entry.title}
                  </span>
                  {entry.kind === "file" && (
                    <span className="min-w-0 max-w-[45%] shrink truncate text-[11px] text-fg-faint" title={entry.relativePath}>
                      {entry.relativePath}
                    </span>
                  )}
                  {combo && (
                    <kbd className="shrink-0 rounded-sm border border-line bg-panel px-1 text-[10px] text-fg-dim">{formatCombo(combo)}</kbd>
                  )}
                  {entry.kind === "command" && entry.command.group && (
                    <span className="shrink-0 text-[11px] text-fg-faint">{t(entry.command.group)}</span>
                  )}
                  {entry.kind === "finding" && (
                    <span className="shrink-0 text-[11px] text-fg-faint">{t("Findings")}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
