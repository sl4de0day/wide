import {
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderX,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { DirEntry } from "@/lib/bridge";
import { fileMark } from "@/lib/fileIcons";
import { folderColour } from "@/lib/folderIcons";
import { extensionById, languageExtensionFor } from "@/lib/marketplace";
import { useT } from "@/lib/i18n";
import { cn, copyText, dirname } from "@/lib/utils";
import { PanelHeader, panelButtonClass } from "@/components/SidePanel";
import { confirm } from "@/stores/confirm";
import { useEditor } from "@/stores/editor";
import { useExtensions } from "@/stores/extensions";
import { useWorkspace } from "@/stores/workspace";

const ROW_HEIGHT = 24;
const OVERSCAN = 8;

interface VisibleRow {

  entry?: DirEntry;
  depth: number;
  folderHeader?: boolean;
  missing?: boolean;
  needs?: string;

  renaming?: boolean;

  draftCreate?: "file" | "folder";
}

const FileMarkIcon = memo(function FileMarkIcon({ name }: { name: string }) {
  const mark = fileMark(name);
  if (!mark) return <File className="size-3 shrink-0 text-fg-dim" strokeWidth={1.5} />;
  if (mark.kind === "icon") {
    const Icon = mark.Icon;
    return <Icon className="size-3 shrink-0" strokeWidth={1.5} style={{ color: mark.colour }} />;
  }
  return (
    <svg viewBox="0 0 24 24" className="size-3 shrink-0" fill={mark.colour} aria-hidden="true">
      <path d={mark.path} />
    </svg>
  );
});

const FolderMarkIcon = memo(function FolderMarkIcon({ name, open }: { name: string; open: boolean }) {
  const colour = folderColour(name);
  const Icon = open ? FolderOpen : Folder;
  return <Icon className="size-3 shrink-0" strokeWidth={1.5} color={colour} fill={colour} />;
});

function DraftRow({ row, top }: { row: VisibleRow; top: number }) {
  const t = useT();
  const rename = Boolean(row.renaming);
  const initial = rename ? row.entry?.name ?? "" : "";
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const committed = useRef(false);
  const error = useWorkspace((s) => s.draft?.error ?? null);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    if (rename) {
      const dot = initial.lastIndexOf(".");
      if (dot > 0) el.setSelectionRange(0, dot);
      else el.select();
    }
  }, [rename, initial]);

  const commit = async () => {
    if (committed.current) return;
    committed.current = true;
    const result = await useWorkspace.getState().commitDraft(value);

    if (result === null && useWorkspace.getState().draft) committed.current = false;
  };
  const cancel = () => {
    if (committed.current) return;
    committed.current = true;
    useWorkspace.getState().cancelDraft();
  };

  const icon = rename
    ? row.entry?.isDirectory
      ? <FolderMarkIcon name={row.entry.name} open={false} />
      : <FileMarkIcon name={row.entry?.name ?? ""} />
    : row.draftCreate === "folder"
      ? <Folder className="size-3 shrink-0 text-fg-dim" strokeWidth={1.5} />
      : <File className="size-3 shrink-0 text-fg-dim" strokeWidth={1.5} />;

  return (
    <div
      className="absolute inset-x-0 flex items-center gap-1 pr-2"
      style={{ height: ROW_HEIGHT, top, paddingLeft: `${row.depth * 12 + 8}px` }}
    >
      <span className="size-3 shrink-0" />
      {icon}
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        onBlur={() => void commit()}
        spellCheck={false}
        title={error ?? undefined}
        placeholder={rename ? undefined : t(row.draftCreate === "folder" ? "Folder name" : "File name")}
        aria-label={t("Name")}
        className={cn(
          "min-w-0 flex-1 rounded-sm border bg-canvas px-1 py-0 text-[13px] text-fg outline-none",
          error ? "border-status-error" : "border-accent",
        )}
      />
      {error && <span className="pointer-events-none shrink-0 truncate text-[10px] text-status-error" title={t(error)}>{t(error)}</span>}
    </div>
  );
}

const Row = memo(function Row({
  entry,
  depth,
  top,
  expanded,
  active,
  selected,
  folderHeader,
  missing,
  needs,
  needsLabel,
  dropTarget,
  onActivate,
  onContext,
  onDragStartRow,
  onDropRow,
  onDragEnterRow,
}: {
  entry: DirEntry;
  depth: number;
  top: number;
  expanded: boolean;
  active: boolean;
  selected: boolean;
  folderHeader?: boolean;
  missing?: boolean;
  needs?: string;
  needsLabel?: string;
  dropTarget: boolean;
  onActivate: (entry: DirEntry, e: React.MouseEvent) => void;
  onContext: (entry: DirEntry, x: number, y: number) => void;
  onDragStartRow: (path: string) => void;
  onDropRow: (dir: string) => void;
  onDragEnterRow: (dir: string) => void;
}) {

  const dropDir = entry.isDirectory ? entry.path : dirname(entry.path);

  return (
    <button
      type="button"
      onClick={(e) => { if (!missing) onActivate(entry, e); }}
      onContextMenu={(e) => {
        if (missing) return;
        e.preventDefault();
        e.stopPropagation();
        onContext(entry, e.clientX, e.clientY);
      }}
      draggable={!missing && !folderHeader}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStartRow(entry.path); }}
      onDragOver={(e) => { if (!missing) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
      onDragEnter={() => { if (!missing) onDragEnterRow(dropDir); }}
      onDrop={(e) => { if (!missing) { e.preventDefault(); e.stopPropagation(); onDropRow(dropDir); } }}
      title={needsLabel ? `${needsLabel}\n${entry.path}` : entry.path}
      className={cn(
        "absolute inset-x-0 flex items-center gap-1 rounded-sm pr-2 text-left text-[13px]",
        "transition-colors duration-100",
        active ? "bg-selected text-fg-bright hover:bg-active" : selected ? "bg-hover text-fg" : "text-fg hover:bg-hover",
        dropTarget && "ring-1 ring-accent ring-inset",
        folderHeader && "text-[11px] uppercase tracking-wide text-fg-muted",
        missing && "cursor-default text-fg-faint line-through hover:bg-transparent",
        needs && "text-status-error",
      )}
      style={{ height: ROW_HEIGHT, top, paddingLeft: `${depth * 12 + 8}px` }}
    >
      {missing ? (
        <>
          <span className="size-3 shrink-0" />
          <FolderX className="size-3 shrink-0 text-fg-faint" strokeWidth={1.5} />
        </>
      ) : entry.isDirectory ? (
        <>
          {expanded ? (
            <ChevronDown className="size-3 shrink-0 text-fg-dim" strokeWidth={2} />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-fg-dim" strokeWidth={2} />
          )}
          <FolderMarkIcon name={entry.name} open={expanded} />
        </>
      ) : (
        <>
          <span className="size-3 shrink-0" />
          <span className={cn("flex shrink-0", needs && "opacity-40")}>
            <FileMarkIcon name={entry.name} />
          </span>
        </>
      )}
      <span className="truncate">{entry.name}</span>
    </button>
  );
});

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof File; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[12px] transition-colors duration-100",
        danger ? "text-status-error hover:bg-status-error/10" : "text-fg-dim hover:bg-hover hover:text-fg",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      {label}
    </button>
  );
}

export function FileTree() {
  const root = useWorkspace((state) => state.root);
  const folders = useWorkspace((state) => state.folders);
  const installed = useExtensions((state) => state.installed);
  const children = useWorkspace((state) => state.children);
  const expanded = useWorkspace((state) => state.expanded);
  const draft = useWorkspace((state) => state.draft);
  const activePath = useEditor((state) => state.activePath);
  const t = useT();

  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{ entry: DirEntry | null; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);

  const pick = useCallback((path: string) => { setSelected(path); setSelection(new Set([path])); }, []);

  const removeTargets = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const first = findEntry(children, folders, root, paths[0]);
      const ok = await confirm({
        title: paths.length > 1 ? t("Delete {n} items?", { n: paths.length }) : t("Delete “{name}”?", { name: first?.name ?? "" }),
        message: t("It will be moved to the Recycle Bin."),
        confirmLabel: t("Delete"),
        danger: true,
      });
      if (!ok) return;
      for (const p of paths) { const en = findEntry(children, folders, root, p); if (en) void useWorkspace.getState().remove(en); }
    },
    [children, folders, root, t],
  );

  const onDropRow = useCallback(
    (dir: string) => {
      const source = drag;
      setDrag(null);
      setDropDir(null);
      if (!source || !dir) return;

      const sources = selection.size > 1 && selection.has(source) ? [...selection] : [source];
      for (const src of sources) {

        if (dir === src || dir === dirname(src) || dir.startsWith(src + "/") || dir.startsWith(src + "\\")) continue;
        void useWorkspace.getState().move(src, dir);
      }
    },
    [drag, selection],
  );

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.clientHeight));
    observer.observe(node);
    setHeight(node.clientHeight);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", close); };
  }, [menu]);

  const openContext = useCallback((entry: DirEntry | null, x: number, y: number) => {
    if (entry) {

      setSelection((s) => (s.has(entry.path) ? s : new Set([entry.path])));
      setSelected(entry.path);
    }
    setMenu({ entry, x, y });
  }, []);

  const rows = useMemo(() => {
    const out: VisibleRow[] = [];
    const wanting = (entry: DirEntry): string | undefined => {
      if (entry.isDirectory) return undefined;
      const owner = languageExtensionFor(entry.name);
      if (!owner || installed.has(owner)) return undefined;
      return extensionById(owner)?.name ?? owner;
    };

    const walk = (dir: string, depth: number) => {

      if (draft?.mode === "create" && draft.parentPath === dir) {
        out.push({ draftCreate: draft.kind, depth });
      }
      for (const entry of children[dir] ?? []) {
        const renaming = draft?.mode === "rename" && draft.path === entry.path;
        out.push({ entry, depth, needs: wanting(entry), renaming });
        if (entry.isDirectory && expanded.has(entry.path)) walk(entry.path, depth + 1);
      }
    };

    if (folders.length > 1) {
      for (const folder of folders) {
        const renaming = draft?.mode === "rename" && draft.path === folder.path;
        out.push({
          entry: { name: folder.name, path: folder.path, isDirectory: true },
          depth: 0,
          folderHeader: true,
          missing: Boolean(folder.missing),
          renaming,
        });
        if (!folder.missing && expanded.has(folder.path)) walk(folder.path, 1);
      }
      return out;
    }

    const only = folders[0]?.path ?? root;
    if (only) walk(only, 0);
    return out;
  }, [root, folders, children, expanded, installed, draft]);

  const viewHeight = height || viewport.current?.clientHeight || 800;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);
  const windowed = rows.slice(first, last);

  const onActivate = (entry: DirEntry, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelection((s) => {
        const next = new Set(s);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      setSelected(entry.path);
      return;
    }
    if (e.shiftKey && selected) {
      const paths = rows.filter((r) => r.entry).map((r) => r.entry!.path);
      const a = paths.indexOf(selected);
      const b = paths.indexOf(entry.path);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelection(new Set(paths.slice(lo, hi + 1)));
        setSelected(entry.path);
        return;
      }
    }
    pick(entry.path);
    if (entry.isDirectory) void useWorkspace.getState().toggleDir(entry.path);
    else void useEditor.getState().openFile(entry.path);
  };

  const dirFor = (entry: DirEntry | null): string | null =>
    entry ? (entry.isDirectory ? entry.path : dirname(entry.path)) : root;

  const menuDir = menu ? dirFor(menu.entry) : root;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const withEntry = rows.filter((r) => r.entry && !r.draftCreate);
    const at = withEntry.findIndex((r) => r.entry!.path === selected);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = withEntry[at + 1] ?? withEntry[0];
      if (next?.entry) pick(next.entry.path);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = at <= 0 ? withEntry[withEntry.length - 1] : withEntry[at - 1];
      if (prev?.entry) pick(prev.entry.path);
      return;
    }

    if (!selected) return;
    const entry = findEntry(children, folders, root, selected);
    if (!entry) return;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (entry.isDirectory && !expanded.has(entry.path)) void useWorkspace.getState().toggleDir(entry.path);
      else if (entry.isDirectory) { const child = withEntry[at + 1]; if (child?.entry) pick(child.entry.path); }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (entry.isDirectory && expanded.has(entry.path)) void useWorkspace.getState().toggleDir(entry.path);
      else { const parent = dirname(entry.path); if (parent) pick(parent); }
    } else if (e.key === "F2") { e.preventDefault(); useWorkspace.getState().startRename(entry); }
    else if (e.key === "Delete") {
      e.preventDefault();
      const targets = selection.size > 1 && selection.has(entry.path) ? [...selection] : [entry.path];
      void removeTargets(targets);
    }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (entry.isDirectory) void useWorkspace.getState().toggleDir(entry.path);
      else void useEditor.getState().openFile(entry.path);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Explorer")}>
        {root && (
          <>
            <button type="button" title={t("New file")} aria-label={t("New file")} onClick={() => void useWorkspace.getState().startCreate(selected && isDir(children, folders, selected) ? selected : root, "file")} className={panelButtonClass}>
              <FilePlus className="size-3.5" strokeWidth={1.5} />
            </button>
            <button type="button" title={t("New folder")} aria-label={t("New folder")} onClick={() => void useWorkspace.getState().startCreate(selected && isDir(children, folders, selected) ? selected : root, "folder")} className={panelButtonClass}>
              <FolderPlus className="size-3.5" strokeWidth={1.5} />
            </button>
          </>
        )}
        <button type="button" title={t("Refresh")} aria-label={t("Refresh")} onClick={() => void useWorkspace.getState().refresh()} className={panelButtonClass}>
          <RotateCw className="size-3.5" strokeWidth={1.5} />
        </button>
      </PanelHeader>

      {!root ? (
        <div className="flex min-h-0 flex-1 flex-col items-start gap-2 px-3 py-4">
          <p className="text-[12px] leading-relaxed text-fg-faint">{t("You have not yet opened a folder.")}</p>
          <button type="button" onClick={() => void useWorkspace.getState().openFolder()} className="rounded-md border border-line px-2.5 py-1 text-[12px] text-fg transition-colors duration-100 hover:bg-hover">
            {t("Open folder")}
          </button>
        </div>
      ) : (
        <div
          ref={viewport}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop);

            if (event.currentTarget.clientHeight !== height) setHeight(event.currentTarget.clientHeight);
          }}
          onContextMenu={(e) => { e.preventDefault(); openContext(null, e.clientX, e.clientY); }}
          className="min-h-0 flex-1 overflow-auto py-1 outline-none"
        >
          <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
            {windowed.map((row, index) => {
              const top = (first + index) * ROW_HEIGHT;
              if (row.draftCreate || row.renaming) {
                return <DraftRow key={row.renaming ? `rename:${row.entry?.path}` : `create:${row.depth}`} row={row} top={top} />;
              }
              const entry = row.entry!;
              return (
                <Row
                  key={entry.path}
                  entry={entry}
                  depth={row.depth}
                  top={top}
                  expanded={entry.isDirectory && expanded.has(entry.path)}
                  active={activePath === entry.path}
                  selected={selection.has(entry.path) || selected === entry.path}
                  folderHeader={row.folderHeader}
                  missing={row.missing}
                  needs={row.needs}
                  needsLabel={row.needs ? t("Install the {name} extension to read this file properly.", { name: row.needs }) : undefined}
                  dropTarget={Boolean(drag) && entry.isDirectory && dropDir === entry.path}
                  onActivate={onActivate}
                  onContext={openContext}
                  onDragStartRow={setDrag}
                  onDropRow={onDropRow}
                  onDragEnterRow={setDropDir}
                />
              );
            })}
          </div>
        </div>
      )}

      {menu && createPortal(
        <>
          {
}
          <div className="fixed inset-0 z-[300]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="wide-pop-up fixed z-[301] min-w-44 rounded-md border border-line bg-panel p-1 shadow-lg"
            style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 240) }}
          >
            {menuDir && (
              <>
                <MenuItem icon={FilePlus} label={t("New file")} onClick={() => { setMenu(null); void useWorkspace.getState().startCreate(menuDir, "file"); }} />
                <MenuItem icon={FolderPlus} label={t("New folder")} onClick={() => { setMenu(null); void useWorkspace.getState().startCreate(menuDir, "folder"); }} />
              </>
            )}
            {menu.entry && (
              <>
                <div className="my-1 h-px bg-line" />
                <MenuItem icon={Pencil} label={t("Rename")} onClick={() => { const e = menu.entry!; setMenu(null); useWorkspace.getState().startRename(e); }} />
                <MenuItem
                  icon={Trash2}
                  label={selection.size > 1 && menu.entry && selection.has(menu.entry.path) ? t("Delete {n} items", { n: selection.size }) : t("Delete")}
                  danger
                  onClick={() => {
                    const e = menu.entry!;
                    setMenu(null);
                    const targets = selection.size > 1 && selection.has(e.path) ? [...selection] : [e.path];
                    void removeTargets(targets);
                  }}
                />
                <div className="my-1 h-px bg-line" />
                <MenuItem icon={Copy} label={t("Copy path")} onClick={() => { const e = menu.entry!; setMenu(null); void copyText(e.path); }} />
                <MenuItem icon={Folder} label={t("Reveal in File Explorer")} onClick={() => { const e = menu.entry!; setMenu(null); useWorkspace.getState().reveal(e); }} />
              </>
            )}
            {!menu.entry && (
              <>
                <div className="my-1 h-px bg-line" />
                <MenuItem icon={RotateCw} label={t("Refresh")} onClick={() => { setMenu(null); void useWorkspace.getState().refresh(); }} />
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function findEntry(
  children: Record<string, DirEntry[]>,
  folders: { path: string; name: string; missing?: boolean }[],
  root: string | null,
  path: string,
): DirEntry | null {
  for (const list of Object.values(children)) {
    const hit = list.find((e) => e.path === path);
    if (hit) return hit;
  }
  const folder = folders.find((f) => f.path === path);
  if (folder) return { name: folder.name, path: folder.path, isDirectory: true };
  if (root === path) return { name: "", path, isDirectory: true };
  return null;
}

function isDir(
  children: Record<string, DirEntry[]>,
  folders: { path: string; name: string; missing?: boolean }[],
  path: string,
): boolean {
  const e = findEntry(children, folders, null, path);
  return Boolean(e?.isDirectory) || folders.some((f) => f.path === path);
}
