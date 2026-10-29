import {
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Columns2,
  Copy,
  CopyPlus,
  File,
  FileCode,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderX,
  GitCompare,
  Pencil,
  RotateCw,
  Scissors,
  Terminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { bridge, type DirEntry } from "@/lib/bridge";
import { fileMark } from "@/lib/fileIcons";
import { folderColour } from "@/lib/folderIcons";
import { extensionById, languageExtensionFor } from "@/lib/marketplace";
import { useT } from "@/lib/i18n";
import { cn, copyText, dirname, getRelativePath, normalisePath } from "@/lib/utils";
import { PanelHeader, panelButtonClass } from "@/components/SidePanel";
import { confirm } from "@/stores/confirm";
import { useEditor } from "@/stores/editor";
import { useExtensions } from "@/stores/extensions";
import { useWorkspace } from "@/stores/workspace";
import { useComparer } from "@/stores/comparer";
import { useFindings, type Severity } from "@/stores/findings";
import { useDiagnostics } from "@/stores/diagnostics";
import { toast } from "@/stores/toast";

const ROW_HEIGHT = 24;
const OVERSCAN = 8;

export interface SecurityBadgeInfo {
  count: number;
  maxSeverity: Severity;
  tooltip: string;
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

interface VisibleRow {
  entry?: DirEntry;
  depth: number;
  folderHeader?: boolean;
  missing?: boolean;
  needs?: string;
  renaming?: boolean;
  draftCreate?: "file" | "folder";
}

interface TreeClipboard {
  paths: string[];
  mode: "copy" | "cut";
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
  badge,
  dropTarget,
  isCut,
  isCompareSelected,
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
  badge?: SecurityBadgeInfo;
  dropTarget: boolean;
  isCut?: boolean;
  isCompareSelected?: boolean;
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
        "absolute inset-x-0 flex items-center gap-1 rounded-sm pr-2 text-left text-[13px] select-none",
        "transition-colors duration-100",
        active ? "bg-selected text-fg-bright hover:bg-active" : selected ? "bg-hover text-fg" : "text-fg hover:bg-hover",
        isCut && "opacity-40",
        isCompareSelected && "ring-1 ring-accent/60 ring-inset",
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
      <span className="truncate flex-1">{entry.name}</span>
      {badge && (
        <span
          title={badge.tooltip}
          className={cn(
            "ml-auto shrink-0 flex items-center justify-center font-mono text-[9px] font-bold px-1.5 py-0.2 rounded-full leading-none",
            badge.maxSeverity === "critical"
              ? "bg-red-500/20 text-red-400 border border-red-500/40"
              : badge.maxSeverity === "high"
              ? "bg-orange-500/20 text-orange-400 border border-orange-500/40"
              : badge.maxSeverity === "medium"
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
              : "bg-blue-500/20 text-blue-300 border border-blue-500/40",
          )}
        >
          {badge.count}
        </span>
      )}
    </button>
  );
});

function MenuItem({
  icon: Icon,
  label,
  shortcut,
  onClick,
  danger,
  disabled,
}: {
  icon?: LucideIcon | React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={cn(
        "flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-[12px] transition-colors duration-100",
        disabled && "opacity-40 cursor-default",
        !disabled && danger && "text-status-error hover:bg-status-error/10",
        !disabled && !danger && "text-fg-dim hover:bg-hover hover:text-fg",
      )}
    >
      <span className="flex items-center gap-2 truncate">
        {Icon && <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />}
        <span className="truncate">{label}</span>
      </span>
      {shortcut && <span className="ml-3 shrink-0 font-mono text-[10px] text-fg-faint">{shortcut}</span>}
    </button>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />;
}

export function FileTree({ onOpenPanel }: { onOpenPanel?: (id: string) => void } = {}) {
  const root = useWorkspace((state) => state.root);
  const folders = useWorkspace((state) => state.folders);
  const installed = useExtensions((state) => state.installed);
  const children = useWorkspace((state) => state.children);
  const expanded = useWorkspace((state) => state.expanded);
  const draft = useWorkspace((state) => state.draft);
  const activePath = useEditor((state) => state.activePath);
  const t = useT();

  const findings = useFindings((state) => state.findings);
  const bySource = useDiagnostics((state) => state.bySource);

  const badgesByPath = useMemo(() => {
    const map = new Map<string, { count: number; maxWeight: number; severities: Record<string, number> }>();

    const recordIssue = (filePath: string, severity: Severity) => {
      if (!filePath) return;
      const norm = normalisePath(filePath);
      const cur = map.get(norm) ?? { count: 0, maxWeight: -1, severities: {} };
      cur.count += 1;
      const weight = SEVERITY_WEIGHT[severity] ?? 0;
      if (weight > cur.maxWeight) cur.maxWeight = weight;
      cur.severities[severity] = (cur.severities[severity] ?? 0) + 1;
      map.set(norm, cur);
    };

    for (const f of findings) {
      if (f.status === "fixed" || f.status === "false-positive") continue;
      const cleanLoc = (f.location || "").split(":")[0].trim();
      if (!cleanLoc || cleanLoc.startsWith("http://") || cleanLoc.startsWith("https://")) continue;
      recordIssue(cleanLoc, f.severity || "medium");
    }

    for (const [file, sources] of Object.entries(bySource)) {
      const securityDiags = [...(sources.security ?? []), ...(sources.inspection ?? [])];
      for (const diag of securityDiags) {
        const sev: Severity = diag.severity === "error" ? "high" : "medium";
        recordIssue(file, sev);
      }
    }

    const result = new Map<string, SecurityBadgeInfo>();
    const weightToSev: Severity[] = ["info", "low", "medium", "high", "critical"];

    for (const [pathKey, data] of map.entries()) {
      const maxSev = weightToSev[data.maxWeight] ?? "medium";
      const parts: string[] = [];
      if (data.severities.critical) parts.push(`${data.severities.critical} critical`);
      if (data.severities.high) parts.push(`${data.severities.high} high`);
      if (data.severities.medium) parts.push(`${data.severities.medium} medium`);
      if (data.severities.low) parts.push(`${data.severities.low} low`);
      if (data.severities.info) parts.push(`${data.severities.info} info`);
      const tooltip = `${data.count} security issue${data.count === 1 ? "" : "s"} (${parts.join(", ")})`;

      result.set(pathKey, {
        count: data.count,
        maxSeverity: maxSev,
        tooltip,
      });
    }

    return result;
  }, [findings, bySource]);

  const getBadge = useCallback(
    (entryPath: string, isDirectory: boolean): SecurityBadgeInfo | undefined => {
      const norm = normalisePath(entryPath);
      const exact = badgesByPath.get(norm);
      if (exact) return exact;

      for (const [key, badge] of badgesByPath.entries()) {
        if (!isDirectory && (norm.endsWith("/" + key) || key.endsWith("/" + norm))) {
          return badge;
        }
        if (isDirectory && (key.startsWith(norm + "/") || norm.endsWith("/" + key))) {
          return badge;
        }
      }
      return undefined;
    },
    [badgesByPath],
  );

  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [lastAnchor, setLastAnchor] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<TreeClipboard | null>(null);
  const [comparePath, setComparePath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ entry: DirEntry | null; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);

  const pick = useCallback((path: string) => {
    setSelected(path);
    setSelection(new Set([path]));
    setLastAnchor(path);
  }, []);

  const selectRange = useCallback((fromPath: string, toPath: string, allRows: VisibleRow[]) => {
    const paths = allRows.filter((r) => r.entry && !r.draftCreate).map((r) => r.entry!.path);
    const a = paths.indexOf(fromPath);
    const b = paths.indexOf(toPath);
    if (a !== -1 && b !== -1) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelection(new Set(paths.slice(lo, hi + 1)));
      setSelected(toPath);
    }
  }, []);

  const getSelectedTargets = useCallback((): string[] => {
    if (selection.size > 0 && selected && selection.has(selected)) {
      return Array.from(selection);
    }
    if (selected) return [selected];
    if (selection.size > 0) return Array.from(selection);
    return [];
  }, [selected, selection]);

  const onDuplicateTargets = useCallback(async (targets: string[]) => {
    if (targets.length === 0) return;
    const newPaths = await useWorkspace.getState().duplicateBatch(targets);
    if (newPaths.length > 0) {
      setSelection(new Set(newPaths));
      const last = newPaths[newPaths.length - 1];
      setSelected(last);
      setLastAnchor(last);
    }
  }, []);

  const onCutTargets = useCallback((targets: string[]) => {
    if (targets.length === 0) return;
    setClipboard({ paths: targets, mode: "cut" });
  }, []);

  const onCopyTargets = useCallback((targets: string[]) => {
    if (targets.length === 0) return;
    setClipboard({ paths: targets, mode: "copy" });
    void copyText(targets.join("\n"));
  }, []);

  const onPasteInto = useCallback(async (targetDir: string) => {
    if (!clipboard || clipboard.paths.length === 0) return;
    if (clipboard.mode === "cut") {
      await useWorkspace.getState().moveBatch(clipboard.paths, targetDir);
      setClipboard(null);
    } else {
      await useWorkspace.getState().copyBatch(clipboard.paths, targetDir);
    }
  }, [clipboard]);

  const onCompareWithSelected = useCallback(async (targetPath: string) => {
    if (!comparePath) return;
    const [f1, f2] = await Promise.all([bridge.readFile(comparePath), bridge.readFile(targetPath)]);
    useComparer.getState().setLeft(f1.content);
    useComparer.getState().setRight(f2.content);
    useComparer.getState().openComparer();
  }, [comparePath]);

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
      await useWorkspace.getState().batchDelete(paths);
      setSelection(new Set());
      setSelected(null);
    },
    [children, folders, root, t],
  );

  const onDropRow = useCallback(
    (dir: string) => {
      const source = drag;
      setDrag(null);
      setDropDir(null);
      if (!source || !dir) return;

      const sources = selection.size > 1 && selection.has(source) ? Array.from(selection) : [source];
      const validSources = sources.filter((src) => {
        if (dir === src || dir === dirname(src) || dir.startsWith(src + "/") || dir.startsWith(src + "\\")) return false;
        return true;
      });
      if (validSources.length > 0) {
        void useWorkspace.getState().moveBatch(validSources, dir);
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
      setLastAnchor(entry.path);
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
      setLastAnchor(entry.path);
      return;
    }
    if (e.shiftKey && lastAnchor) {
      selectRange(lastAnchor, entry.path, rows);
      return;
    }
    pick(entry.path);
    if (e.altKey && !entry.isDirectory) {
      void useEditor.getState().openFileToSide(entry.path);
      return;
    }
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
      if (next?.entry) {
        if (e.shiftKey && lastAnchor) {
          selectRange(lastAnchor, next.entry.path, rows);
        } else {
          pick(next.entry.path);
        }
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = at <= 0 ? withEntry[withEntry.length - 1] : withEntry[at - 1];
      if (prev?.entry) {
        if (e.shiftKey && lastAnchor) {
          selectRange(lastAnchor, prev.entry.path, rows);
        } else {
          pick(prev.entry.path);
        }
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        const allPaths = withEntry.map((r) => r.entry!.path);
        setSelection(new Set(allPaths));
        return;
      }
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        const targets = getSelectedTargets();
        void onDuplicateTargets(targets);
        return;
      }
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        const targets = getSelectedTargets();
        onCopyTargets(targets);
        return;
      }
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        const targets = getSelectedTargets();
        onCutTargets(targets);
        return;
      }
      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        const entry = selected ? findEntry(children, folders, root, selected) : null;
        const targetDir = entry ? dirFor(entry) ?? root : root;
        if (targetDir) void onPasteInto(targetDir);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (selected) {
          const entry = findEntry(children, folders, root, selected);
          if (entry && !entry.isDirectory) void useEditor.getState().openFileToSide(entry.path);
        }
        return;
      }
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (selection.size > 1 && selected) {
        setSelection(new Set([selected]));
      } else {
        setSelection(new Set());
        setSelected(null);
      }
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
    } else if (e.key === "F2") {
      e.preventDefault();
      useWorkspace.getState().startRename(entry);
    } else if (e.key === "Delete") {
      e.preventDefault();
      const targets = getSelectedTargets();
      void removeTargets(targets);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (entry.isDirectory) void useWorkspace.getState().toggleDir(entry.path);
      else void useEditor.getState().openFile(entry.path);
    }
  };

  const menuTargets = menu?.entry
    ? selection.size > 1 && selection.has(menu.entry.path)
      ? Array.from(selection)
      : [menu.entry.path]
    : [];

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
                  badge={getBadge(entry.path, Boolean(entry.isDirectory))}
                  dropTarget={Boolean(drag) && entry.isDirectory && dropDir === entry.path}
                  isCut={clipboard?.mode === "cut" && clipboard.paths.includes(entry.path)}
                  isCompareSelected={comparePath === entry.path}
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
          <div className="fixed inset-0 z-[300]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="wide-pop-up fixed z-[301] min-w-52 rounded-md border border-line bg-panel p-1 shadow-lg text-[12px]"
            style={{
              left: Math.max(8, Math.min(menu.x, window.innerWidth - 230)),
              top: Math.max(8, Math.min(menu.y, window.innerHeight - 380)),
            }}
          >
            {menuDir && (
              <>
                <MenuItem icon={FilePlus} label={t("New file")} onClick={() => { setMenu(null); void useWorkspace.getState().startCreate(menuDir, "file"); }} />
                <MenuItem icon={FolderPlus} label={t("New folder")} onClick={() => { setMenu(null); void useWorkspace.getState().startCreate(menuDir, "folder"); }} />
              </>
            )}
            {menu.entry && (
              <>
                <MenuSeparator />
                {!menu.entry.isDirectory && (
                  <MenuItem
                    icon={Columns2}
                    label={t("Open to the side")}
                    shortcut="Ctrl+Enter"
                    onClick={() => {
                      const p = menu.entry!.path;
                      setMenu(null);
                      void useEditor.getState().openFileToSide(p);
                    }}
                  />
                )}
                <MenuItem
                  icon={Terminal}
                  label={t("Open in Terminal")}
                  onClick={() => {
                    setMenu(null);
                    onOpenPanel?.("terminal");
                  }}
                />
                <MenuSeparator />
                <MenuItem
                  icon={Scissors}
                  label={t("Cut")}
                  shortcut="Ctrl+X"
                  onClick={() => {
                    setMenu(null);
                    onCutTargets(menuTargets);
                  }}
                />
                <MenuItem
                  icon={Copy}
                  label={t("Copy")}
                  shortcut="Ctrl+C"
                  onClick={() => {
                    setMenu(null);
                    onCopyTargets(menuTargets);
                  }}
                />
                <MenuItem
                  icon={ClipboardPaste}
                  label={t("Paste")}
                  shortcut="Ctrl+V"
                  disabled={!clipboard || clipboard.paths.length === 0}
                  onClick={() => {
                    setMenu(null);
                    if (menuDir) void onPasteInto(menuDir);
                  }}
                />
                <MenuItem
                  icon={CopyPlus}
                  label={menuTargets.length > 1 ? t("Duplicate {n} items", { n: menuTargets.length }) : t("Duplicate")}
                  shortcut="Ctrl+D"
                  onClick={() => {
                    setMenu(null);
                    void onDuplicateTargets(menuTargets);
                  }}
                />
                <MenuSeparator />
                <MenuItem
                  icon={Copy}
                  label={t("Copy path")}
                  onClick={() => {
                    const p = menu.entry!.path;
                    setMenu(null);
                    void copyText(p);
                  }}
                />
                <MenuItem
                  icon={FileCode}
                  label={t("Copy relative path")}
                  shortcut="Shift+Alt+C"
                  onClick={() => {
                    const p = menu.entry!.path;
                    setMenu(null);
                    void copyText(getRelativePath(root, p));
                  }}
                />
                <MenuItem
                  icon={FileText}
                  label={t("Copy file name")}
                  onClick={() => {
                    const n = menu.entry!.name;
                    setMenu(null);
                    void copyText(n);
                  }}
                />
                {!menu.entry.isDirectory && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      icon={GitCompare}
                      label={t("Select for compare")}
                      onClick={() => {
                        const p = menu.entry!.path;
                        setMenu(null);
                        setComparePath(p);
                        toast.info(t("Selected for compare"));
                      }}
                    />
                    {comparePath && comparePath !== menu.entry.path && (
                      <MenuItem
                        icon={GitCompare}
                        label={t("Compare with selected")}
                        onClick={() => {
                          const p = menu.entry!.path;
                          setMenu(null);
                          void onCompareWithSelected(p);
                        }}
                      />
                    )}
                  </>
                )}
                <MenuSeparator />
                <MenuItem
                  icon={FolderOpen}
                  label={t("Reveal in File Explorer")}
                  onClick={() => {
                    const e = menu.entry!;
                    setMenu(null);
                    useWorkspace.getState().reveal(e);
                  }}
                />
                <MenuSeparator />
                <MenuItem
                  icon={Pencil}
                  label={t("Rename")}
                  shortcut="F2"
                  onClick={() => {
                    const e = menu.entry!;
                    setMenu(null);
                    useWorkspace.getState().startRename(e);
                  }}
                />
                <MenuItem
                  icon={Trash2}
                  label={menuTargets.length > 1 ? t("Delete {n} items", { n: menuTargets.length }) : t("Delete")}
                  shortcut="Del"
                  danger
                  onClick={() => {
                    setMenu(null);
                    void removeTargets(menuTargets);
                  }}
                />
              </>
            )}
            {!menu.entry && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={ClipboardPaste}
                  label={t("Paste")}
                  shortcut="Ctrl+V"
                  disabled={!clipboard || clipboard.paths.length === 0}
                  onClick={() => {
                    setMenu(null);
                    if (root) void onPasteInto(root);
                  }}
                />
                <MenuItem
                  icon={Terminal}
                  label={t("Open in Terminal")}
                  onClick={() => {
                    setMenu(null);
                    onOpenPanel?.("terminal");
                  }}
                />
                <MenuSeparator />
                {root && (
                  <>
                    <MenuItem
                      icon={Copy}
                      label={t("Copy path")}
                      onClick={() => {
                        setMenu(null);
                        void copyText(root);
                      }}
                    />
                    <MenuItem
                      icon={FolderOpen}
                      label={t("Reveal in File Explorer")}
                      onClick={() => {
                        setMenu(null);
                        void bridge.reveal(root);
                      }}
                    />
                  </>
                )}
                <MenuSeparator />
                <MenuItem
                  icon={RotateCw}
                  label={t("Refresh")}
                  onClick={() => {
                    setMenu(null);
                    void useWorkspace.getState().refresh();
                  }}
                />
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
