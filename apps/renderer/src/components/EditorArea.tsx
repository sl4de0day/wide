import {
  ChevronDown,
  Columns2,
  Columns3,
  Eraser,
  Eye,
  Grid2x2,
  Play,
  Rows2,
  Rows3,
  Square,
  X,
} from "lucide-react";
import { MediaView } from "./MediaView";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useT } from "@/lib/i18n";
import { bridge } from "@/lib/bridge";
import { commentLanguageFor } from "@/lib/comments";
import { runCommand } from "@/lib/runnable";
import { requestCloseAll, requestCloseOthers, requestCloseRight, requestCloseTab } from "@/lib/tabClose";
import { cn } from "@/lib/utils";
import {
  countLeaves,
  detectPreset,
  type GridPreset,
  type LayoutNode,
  type LayoutSplitNode,
} from "@/lib/editorLayout";
import {
  AI_CHAT_PATH,
  DIFF_PATH,
  EXTENSION_PATH,
  isDirty,
  MD_PREVIEW_PATH,
  useEditor,
  usePaneTab,
  type Tab,
} from "@/stores/editor";
import { useExtensions } from "@/stores/extensions";
import { useRun } from "@/stores/run";
import { useWorkspace } from "@/stores/workspace";
import { ReferencesOverlay } from "./ReferencesOverlay";
import { SettingsView } from "./SettingsView";

const CodeEditor = lazy(() => import("@/editor/CodeEditor").then((m) => ({ default: m.CodeEditor })));

const HttpResponse = lazy(() => import("@/panels/HttpResponse").then((m) => ({ default: m.HttpResponse })));
const AiChatView = lazy(() => import("./AiChatView").then((m) => ({ default: m.AiChatView })));
const CatcherView = lazy(() => import("./CatcherView").then((m) => ({ default: m.CatcherView })));
const PitcherView = lazy(() => import("./pitcher/PitcherView").then((m) => ({ default: m.PitcherView })));
const BrowserView = lazy(() => import("./BrowserView").then((m) => ({ default: m.BrowserView })));
const CyberChefView = lazy(() => import("./CyberChefView").then((m) => ({ default: m.CyberChefView })));
const ScratchpadView = lazy(() => import("./ScratchpadView").then((m) => ({ default: m.ScratchpadView })));
const MarkdownPreview = lazy(() => import("./MarkdownPreview").then((m) => ({ default: m.MarkdownPreview })));
const DiffView = lazy(() => import("@/panels/DiffView").then((m) => ({ default: m.DiffView })));
const ExtensionView = lazy(() => import("./ExtensionView").then((m) => ({ default: m.ExtensionView })));
const SssfView = lazy(() => import("./SssfView").then((m) => ({ default: m.SssfView })));

function RunButton({ tab, root, run }: { tab: Tab; root: string | null; run: (path: string, command: string) => Promise<void> }) {
  const t = useT();
  const [command, setCommand] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    runCommand(tab.path, root).then((cmd) => {
      if (active) setCommand(cmd);
    });
    return () => {
      active = false;
    };
  }, [tab.path, root]);

  if (!command) return null;

  return (
    <button
      type="button"
      title={command}
      aria-label={t("Run {name}", { name: tab.name })}
      onClick={(e) => {
        e.stopPropagation();
        void run(tab.path, command);
      }}
      className="flex size-4 items-center justify-center rounded-sm text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-status-ok"
    >
      <Play className="size-3" strokeWidth={2} fill="currentColor" />
    </button>
  );
}

function TabOverflowMenu({ tabs, activePath, onPick }: { tabs: Tab[]; activePath: string | null; onPick: (path: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex shrink-0 items-stretch border-l border-line">
      <button
        type="button"
        title={t("Open editors")}
        aria-label={t("Open editors")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center px-1.5 text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        <ChevronDown className="size-3.5" strokeWidth={2} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[300]" onClick={() => setOpen(false)} />
          <div className="wide-pop-up absolute right-0 top-full z-[301] mt-0.5 max-h-80 w-64 overflow-auto rounded-md border border-line bg-panel p-1 shadow-lg">
            {tabs.map((tab) => (
              <button
                key={tab.path}
                type="button"
                onClick={() => { onPick(tab.path); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[12px] transition-colors duration-100",
                  tab.path === activePath ? "bg-selected text-fg-bright" : "text-fg-dim hover:bg-hover hover:text-fg",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{tab.kind === "file" ? tab.name : t(tab.name)}</span>
                {isDirty(tab) && <span className="shrink-0 text-[14px] leading-none">•</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EditorTabs({ onOpenPanel }: { onOpenPanel?: (id: string) => void }) {
  const tabs = useEditor((state) => state.tabs);
  const activePath = useEditor((state) => state.activePath);
  const setActive = useEditor((state) => state.setActive);
  const root = useWorkspace((state) => state.root);
  const hasCleaner = useExtensions((state) => state.installed.has("comment-cleaner"));
  const hasMarkdownViewer = useExtensions((state) => state.installed.has("markdown-viewer"));

  const [notice, setNotice] = useState("");

  const [tabMenu, setTabMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const t = useT();

  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabMenu]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const run = async (path: string, command: string) => {
    setActive(path);
    await useEditor.getState().saveActive();
    useRun.getState().send(command);
    onOpenPanel?.("terminal");
  };

  const clean = async (path: string) => {
    const state = useEditor.getState();
    const tab = state.tabs.find((item) => item.path === path);
    if (!tab || tab.kind !== "file") return;
    const reply = await bridge.stripComments(root ?? "", path, tab.content);
    if (!reply.ok || typeof reply.text !== "string") {
      setNotice(reply.error ?? t("That file could not be cleaned."));
      return;
    }
    if (reply.text === tab.content) {
      setNotice(t("There were no comments to remove."));
      return;
    }
    state.setActive(path);

    state.replaceContent(path, reply.text);

    setNotice(t("Removed {count} comments.", { count: reply.removed ?? 0 }));
  };

  if (tabs.length === 0) return null;

  const menuItem = "flex w-full items-center justify-between gap-6 rounded-sm px-2 py-1 text-left text-[12px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg";

  return (
    <>
    <div
      className="flex shrink-0 items-stretch border-b border-line bg-chrome"
      style={{ height: "var(--h-tabbar)" }}
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          onClick={() => setActive(tab.path)}
          onContextMenu={(e) => { e.preventDefault(); setTabMenu({ path: tab.path, x: e.clientX, y: e.clientY }); }}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void requestCloseTab(tab.path); } }}
          className={cn(
            "group flex shrink-0 cursor-pointer items-center gap-2 border-r border-line px-3 text-[12px]",
            tab.path === activePath ? "bg-canvas text-fg-bright" : "text-fg-dim hover:bg-hover",
          )}
        >
          <span className="truncate">
            {tab.kind === "file" ? tab.name : t(tab.name)}
          </span>
          {hasCleaner && tab.kind === "file" && commentLanguageFor(tab.name) && (
            <button
              type="button"
              title={t("Remove comments")}
              aria-label={t("Remove comments from {name}", { name: tab.name })}
              onClick={(e) => { e.stopPropagation(); void clean(tab.path); }}
              className="flex size-4 items-center justify-center rounded-sm text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg-bright"
            >
              <Eraser className="size-3" strokeWidth={1.75} />
            </button>
          )}
          {hasMarkdownViewer && tab.kind === "file" && /\.(?:md|markdown|mdx)$/i.test(tab.name) && (
            <button
              type="button"
              title={t("Preview Markdown")}
              aria-label={t("Preview Markdown")}
              onClick={(e) => { e.stopPropagation(); useEditor.getState().openMarkdownPreview(tab.path, tab.name); }}
              className="flex size-4 items-center justify-center rounded-sm text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg-bright"
            >
              <Eye className="size-3" strokeWidth={1.75} />
            </button>
          )}
          {tab.kind === "file" && <RunButton tab={tab} root={root} run={run} />}
          <button
            type="button"
            title={t("Close")}
            aria-label={t("Close {name}", {
              name: tab.kind === "file" ? tab.name : t(tab.name),
            })}
            onClick={(e) => { e.stopPropagation(); void requestCloseTab(tab.path); }}
            className="flex size-4 items-center justify-center rounded-sm text-fg-dim hover:bg-hover hover:text-fg"
          >
            {isDirty(tab) ? <span className="text-[16px] leading-none">•</span> : <X className="size-3" strokeWidth={2} />}
          </button>
        </div>
      ))}
      </div>
      <div className="flex items-stretch shrink-0">
        {tabs.length > 1 && <TabOverflowMenu tabs={tabs} activePath={activePath} onPick={setActive} />}
        <LayoutPickerMenu />
      </div>
    </div>
    {tabMenu && createPortal(
      <>
        <div className="fixed inset-0 z-[300]" onClick={() => setTabMenu(null)} onContextMenu={(e) => { e.preventDefault(); setTabMenu(null); }} />
        <div
          className="wide-pop-up fixed z-[301] min-w-44 rounded-md border border-line bg-panel p-1 shadow-lg"
          style={{ left: Math.min(tabMenu.x, window.innerWidth - 190), top: Math.min(tabMenu.y, window.innerHeight - 160) }}
        >
          <button type="button" className={menuItem} onClick={() => { const p = tabMenu.path; setTabMenu(null); void requestCloseTab(p); }}>{t("Close")}</button>
          <button type="button" className={menuItem} onClick={() => { const p = tabMenu.path; setTabMenu(null); void requestCloseOthers(p); }}>{t("Close Others")}</button>
          <button type="button" className={menuItem} onClick={() => { const p = tabMenu.path; setTabMenu(null); void requestCloseRight(p); }}>{t("Close to the Right")}</button>
          <div className="my-1 h-px bg-line" />
          <button type="button" className={menuItem} onClick={() => { setTabMenu(null); void requestCloseAll(); }}>{t("Close All")}</button>
        </div>
      </>,
      document.body,
    )}
    </>
  );
}

function LayoutPickerMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const layout = useEditor((state) => state.layout);
  const setGridPreset = useEditor((state) => state.setGridPreset);
  const currentPreset = detectPreset(layout);

  const presets: Array<{ id: GridPreset; label: string; icon: typeof Square }> = [
    { id: "1x1", label: t("Single (1x1)"), icon: Square },
    { id: "1x2", label: t("Two Columns (1x2)"), icon: Columns2 },
    { id: "2x1", label: t("Two Rows (2x1)"), icon: Rows2 },
    { id: "2x2", label: t("2x2 Grid"), icon: Grid2x2 },
    { id: "1x3", label: t("Three Columns (1x3)"), icon: Columns3 },
    { id: "3x1", label: t("Three Rows (3x1)"), icon: Rows3 },
  ];

  const CurrentIcon =
    currentPreset === "1x2"
      ? Columns2
      : currentPreset === "2x1"
      ? Rows2
      : currentPreset === "2x2"
      ? Grid2x2
      : currentPreset === "1x3"
      ? Columns3
      : currentPreset === "3x1"
      ? Rows3
      : Square;

  return (
    <div className="relative flex shrink-0 items-stretch border-l border-line">
      <button
        type="button"
        title={t("Editor grid layout")}
        aria-label={t("Editor grid layout")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center px-2 text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        <CurrentIcon className="size-3.5" strokeWidth={1.75} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[300]" onClick={() => setOpen(false)} />
          <div className="wide-pop-up absolute right-0 top-full z-[301] mt-0.5 min-w-48 rounded-md border border-line bg-panel p-1 shadow-lg">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
              {t("Grid Layout")}
            </div>
            {presets.map((preset) => {
              const Icon = preset.icon;
              const isSelected = currentPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setGridPreset(preset.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors duration-100",
                    isSelected
                      ? "bg-selected text-fg-bright font-medium"
                      : "text-fg-dim hover:bg-hover hover:text-fg",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                  {isSelected && <span className="text-status-ok text-[11px] font-bold">✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PaneFileSwitcher({
  paneId,
  currentPath,
}: {
  paneId: string;
  currentPath: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const tabs = useEditor((state) => state.tabs);
  const setPaneActivePath = useEditor((state) => state.setPaneActivePath);

  if (tabs.length <= 1) return null;

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        title={t("Switch file in this pane")}
        aria-label={t("Switch file in this pane")}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-sm p-0.5 text-fg-dim transition-colors hover:bg-hover hover:text-fg"
      >
        <ChevronDown className="size-3" strokeWidth={2} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-[300]"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div
            className="wide-pop-up absolute left-0 top-full z-[301] mt-1 max-h-64 w-56 overflow-auto rounded-md border border-line bg-panel p-1 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {tabs.map((tab) => (
              <button
                key={tab.path}
                type="button"
                onClick={() => {
                  setPaneActivePath(paneId, tab.path);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[11px] transition-colors duration-100",
                  tab.path === currentPath
                    ? "bg-selected text-fg-bright font-medium"
                    : "text-fg-dim hover:bg-hover hover:text-fg",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {tab.kind === "file" ? tab.name : t(tab.name)}
                </span>
                {isDirty(tab) && <span className="shrink-0 text-[14px] leading-none">•</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TabContentRenderer({ tab, paneId }: { tab: Tab | null; paneId: string }) {
  const t = useT();

  if (!tab) {
    return (
      <div className="wide-enter-fade flex h-full flex-col items-center justify-center p-4 text-center">
        <p className="text-[12px] italic text-fg-dim">{t("Open a file to start editing.")}</p>
      </div>
    );
  }

  if (tab.kind === "file") {
    return (
      <Suspense fallback={null}>
        <CodeEditor key={`${paneId}:${tab.path}`} tab={tab} />
      </Suspense>
    );
  }
  if (tab.kind === "settings") return <SettingsView />;
  if (tab.kind === "extension") return <ExtensionView id={tab.path.slice(EXTENSION_PATH.length)} />;
  if (tab.kind === "ai-chat") return <AiChatView key={tab.path} id={tab.path.slice(AI_CHAT_PATH.length)} />;
  if (tab.kind === "http") return <HttpResponse />;
  if (tab.kind === "policy") return <SssfView />;
  if (tab.kind === "browser") return <BrowserView />;
  if (tab.kind === "catcher") return <CatcherView />;
  if (tab.kind === "pitcher") return <PitcherView />;
  if (tab.kind === "cyberchef") return <CyberChefView />;
  if (tab.kind === "scratchpad") return <ScratchpadView />;
  if (tab.kind === "markdown-preview") return <MarkdownPreview sourcePath={tab.path.slice(MD_PREVIEW_PATH.length)} />;
  if (tab.kind === "media") return <MediaView key={tab.path} tab={tab} />;
  if (tab.kind === "diff") {
    const suffix = tab.path.slice(DIFF_PATH.length);
    const slash = suffix.indexOf("/");
    return (
      <DiffView
        key={tab.path}
        relPath={suffix.slice(slash + 1)}
        staged={suffix.slice(0, slash) === "staged"}
      />
    );
  }
  return null;
}

function PaneContainer({ paneId, isOnlyPane }: { paneId: string; isOnlyPane: boolean }) {
  const t = useT();
  const tab = usePaneTab(paneId);
  const activePaneId = useEditor((state) => state.activePaneId);
  const setActivePane = useEditor((state) => state.setActivePane);
  const splitPane = useEditor((state) => state.splitPane);
  const closePane = useEditor((state) => state.closePane);

  const isActive = activePaneId === paneId;

  return (
    <div
      onClick={() => setActivePane(paneId)}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas transition-colors duration-100",
        !isOnlyPane && isActive && "ring-1 ring-inset ring-accent/30",
      )}
    >
      {!isOnlyPane && (
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-2 border-b px-2 py-1 transition-colors duration-100 select-none",
            isActive
              ? "border-line bg-panel text-fg-bright font-medium"
              : "border-line/60 bg-chrome/60 text-fg-dim hover:text-fg",
          )}
          style={{ height: "28px" }}
        >
          <div className="flex min-w-0 items-center gap-1.5 flex-1">
            <span className="min-w-0 truncate text-[11px]">
              {tab ? (tab.kind === "file" ? tab.name : t(tab.name)) : t("Empty")}
            </span>
            {isDirty(tab) && <span className="shrink-0 text-[14px] leading-none text-status-warning">•</span>}
            <PaneFileSwitcher paneId={paneId} currentPath={tab?.path ?? null} />
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              title={t("Split Right")}
              aria-label={t("Split Right")}
              onClick={(e) => {
                e.stopPropagation();
                splitPane(paneId, "vertical");
              }}
              className="rounded-sm p-1 text-fg-dim transition-colors hover:bg-hover hover:text-fg"
            >
              <Columns2 className="size-3" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title={t("Split Down")}
              aria-label={t("Split Down")}
              onClick={(e) => {
                e.stopPropagation();
                splitPane(paneId, "horizontal");
              }}
              className="rounded-sm p-1 text-fg-dim transition-colors hover:bg-hover hover:text-fg"
            >
              <Rows2 className="size-3" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title={t("Close Pane")}
              aria-label={t("Close Pane")}
              onClick={(e) => {
                e.stopPropagation();
                closePane(paneId);
              }}
              className="rounded-sm p-1 text-fg-dim transition-colors hover:bg-hover hover:text-fg"
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      <div className="relative min-h-0 min-w-0 flex-1">
        <Suspense fallback={null}>
          <TabContentRenderer tab={tab} paneId={paneId} />
        </Suspense>
      </div>
    </div>
  );
}

function SplitNodeView({ node }: { node: LayoutSplitNode }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const setSplitRatio = useEditor((state) => state.setSplitRatio);

  const direction = node.direction;
  const isVertical = direction === "vertical";

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const newRatio = isVertical
        ? (event.clientX - rect.left) / rect.width
        : (event.clientY - rect.top) / rect.height;
      setSplitRatio(node.id, newRatio);
    },
    [isVertical, node.id, setSplitRatio],
  );

  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = isVertical ? "col-resize" : "row-resize";
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = prevCursor;
    };
  }, [dragging, isVertical, onPointerMove]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 overflow-hidden",
        isVertical ? "flex-row" : "flex-col",
      )}
    >
      <div
        className="min-h-0 min-w-0 flex shrink-0"
        style={{
          [isVertical ? "width" : "height"]: `${node.ratio * 100}%`,
        }}
      >
        <LayoutRenderer node={node.children[0]} isOnlyPane={false} />
      </div>

      <div
        role="separator"
        aria-orientation={isVertical ? "vertical" : "horizontal"}
        aria-label={t("Resize split")}
        onPointerDown={() => setDragging(true)}
        onDoubleClick={() => setSplitRatio(node.id, 0.5)}
        className={cn(
          "shrink-0 bg-line transition-colors duration-100 hover:bg-accent active:bg-accent",
          isVertical
            ? "w-1 cursor-col-resize hover:w-1"
            : "h-1 cursor-row-resize hover:h-1",
        )}
      />

      <div className="min-h-0 min-w-0 flex flex-1">
        <LayoutRenderer node={node.children[1]} isOnlyPane={false} />
      </div>
    </div>
  );
}

function LayoutRenderer({ node, isOnlyPane }: { node: LayoutNode; isOnlyPane: boolean }) {
  if (node.type === "leaf") {
    return <PaneContainer paneId={node.paneId} isOnlyPane={isOnlyPane} />;
  }
  return <SplitNodeView node={node} />;
}

export function EditorArea({ onOpenPanel }: { onOpenPanel?: (id: string) => void }) {
  const layout = useEditor((state) => state.layout);
  const paneCount = countLeaves(layout);
  const isOnlyPane = paneCount === 1;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
      <ReferencesOverlay />
      <EditorTabs onOpenPanel={onOpenPanel} />
      <div className="min-h-0 min-w-0 flex-1 flex">
        <LayoutRenderer node={layout} isOnlyPane={isOnlyPane} />
      </div>
    </div>
  );
}
