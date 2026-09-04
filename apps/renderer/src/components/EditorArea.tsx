import { ChevronDown, Eraser, Play, X } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useT } from "@/lib/i18n";
import { bridge } from "@/lib/bridge";
import { commentLanguageFor } from "@/lib/comments";
import { loadDockSize, saveDockSize } from "@/lib/dockSize";
import { runCommand } from "@/lib/runnable";
import { requestCloseAll, requestCloseOthers, requestCloseRight, requestCloseTab } from "@/lib/tabClose";
import { cn } from "@/lib/utils";
import {
  AI_CHAT_PATH,
  DIFF_PATH,
  EXTENSION_PATH,
  isDirty,
  useActiveTab,
  useEditor,
  type FileTab,
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
const DiffView = lazy(() => import("@/panels/DiffView").then((m) => ({ default: m.DiffView })));
const ExtensionView = lazy(() => import("./ExtensionView").then((m) => ({ default: m.ExtensionView })));
const SssfView = lazy(() => import("./SssfView").then((m) => ({ default: m.SssfView })));
const AboutView = lazy(() => import("./AboutView").then((m) => ({ default: m.AboutView })));

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
          onContextMenu={(e) => { e.preventDefault(); setTabMenu({ path: tab.path, x: e.clientX, y: e.clientY }); }}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void requestCloseTab(tab.path); } }}
          className={cn(
            "group flex shrink-0 items-center gap-2 border-r border-line px-3 text-[12px]",
            tab.path === activePath ? "bg-canvas text-fg-bright" : "text-fg-dim hover:bg-hover",
          )}
        >
          <button type="button" onClick={() => setActive(tab.path)} className="truncate">
            {

}
            {tab.kind === "file" ? tab.name : t(tab.name)}
          </button>
          {hasCleaner && tab.kind === "file" && commentLanguageFor(tab.name) && (
            <button
              type="button"
              title={t("Remove comments")}
              aria-label={t("Remove comments from {name}", { name: tab.name })}
              onClick={() => void clean(tab.path)}
              className="flex size-4 items-center justify-center rounded-sm text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg-bright"
            >
              <Eraser className="size-3" strokeWidth={1.75} />
            </button>
          )}
          {(() => {

            if (tab.kind !== "file") return null;
            const command = runCommand(tab.path, root);
            if (!command) return null;
            return (
              <button
                type="button"
                title={command}
                aria-label={t("Run {name}", { name: tab.name })}
                onClick={() => void run(tab.path, command)}
                className="flex size-4 items-center justify-center rounded-sm text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-status-ok"
              >
                <Play className="size-3" strokeWidth={2} fill="currentColor" />
              </button>
            );
          })()}
          <button
            type="button"
            title={t("Close")}
            aria-label={t("Close {name}", {
              name: tab.kind === "file" ? tab.name : t(tab.name),
            })}
            onClick={() => void requestCloseTab(tab.path)}
            className="flex size-4 items-center justify-center rounded-sm text-fg-dim hover:bg-hover hover:text-fg"
          >
            {isDirty(tab) ? <span className="text-[16px] leading-none">•</span> : <X className="size-3" strokeWidth={2} />}
          </button>
        </div>
      ))}
      </div>
      {tabs.length > 1 && <TabOverflowMenu tabs={tabs} activePath={activePath} onPick={setActive} />}
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

const SPLIT_KEY = "wide.split.ratio";

function SplitEditors({ left, right }: { left: FileTab; right: FileTab }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [ratio, setRatio] = useState(() => Math.min(0.85, Math.max(0.15, loadDockSize(SPLIT_KEY, 50) / 100)));

  useEffect(() => {
    saveDockSize(SPLIT_KEY, ratio * 100);
  }, [ratio]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setRatio(Math.min(0.85, Math.max(0.15, (event.clientX - rect.left) / rect.width)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    const previous = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = previous;
    };
  }, [dragging, onPointerMove]);

  const header = "flex shrink-0 items-center gap-2 border-b border-line px-2 py-1";
  return (
    <div ref={containerRef} className="flex h-full min-h-0">
      <div className="flex min-w-0 shrink-0 flex-col" style={{ width: `${ratio * 100}%` }}>
        <div className={header}>
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-dim">{left.name}</span>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <CodeEditor key={left.path} tab={left} />
          </Suspense>
        </div>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Resize split")}
        onPointerDown={() => setDragging(true)}
        onDoubleClick={() => setRatio(0.5)}
        className="w-px shrink-0 cursor-col-resize bg-line transition-colors duration-100 hover:bg-line-strong"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={header}>
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-dim">{right.name}</span>
          <button
            type="button"
            onClick={() => useEditor.getState().closeSplit()}
            title={t("Close split")}
            aria-label={t("Close split")}
            className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" strokeWidth={2} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <CodeEditor key={`split:${right.path}`} tab={right} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export function EditorArea({ onOpenPanel }: { onOpenPanel?: (id: string) => void }) {
  const tab = useActiveTab();
  const splitPath = useEditor((state) => state.splitPath);
  const splitTab = useEditor((state) => state.tabs.find((item) => item.path === splitPath));
  const splitFile = splitTab && splitTab.kind === "file" ? splitTab : null;
  const t = useT();

  return (

    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
      <ReferencesOverlay />
      <EditorTabs onOpenPanel={onOpenPanel} />
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
        {!tab ? (
          <div className="wide-enter-fade flex h-full items-center justify-center">
            <p className="text-[12px] italic text-fg-dim">{t("Open a file to start editing.")}</p>
          </div>
        ) : tab.kind === "file" && splitFile ? (

          <SplitEditors left={tab} right={splitFile} />
        ) : tab.kind === "file" ? (
          <Suspense fallback={null}>
            <CodeEditor key={tab.path} tab={tab} />
          </Suspense>
        ) : tab.kind === "settings" ? (
          <SettingsView />
        ) : tab.kind === "extension" ? (
          <ExtensionView id={tab.path.slice(EXTENSION_PATH.length)} />
        ) : tab.kind === "ai-chat" ? (

          <AiChatView key={tab.path} id={tab.path.slice(AI_CHAT_PATH.length)} />
        ) : tab.kind === "http" ? (
          <HttpResponse />
        ) : tab.kind === "policy" ? (
          <SssfView />
        ) : tab.kind === "about" ? (
          <AboutView />
        ) : tab.kind === "browser" ? (
          <BrowserView />
        ) : tab.kind === "catcher" ? (
          <CatcherView />
        ) : tab.kind === "pitcher" ? (
          <PitcherView />
        ) : tab.kind === "diff" ? (
          (() => {
            const suffix = tab.path.slice(DIFF_PATH.length);
            const slash = suffix.indexOf("/");
            return <DiffView key={tab.path} relPath={suffix.slice(slash + 1)} staged={suffix.slice(0, slash) === "staged"} />;
          })()
        ) : null}
        </Suspense>
      </div>
    </div>
  );
}
