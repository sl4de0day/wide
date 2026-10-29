import { ChevronLeft, ShieldAlert } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { ActivityBar, panelById } from "./components/ActivityBar";
import { EditorArea } from "./components/EditorArea";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Launcher } from "./components/Launcher";
import { CodeActionMenu } from "./components/CodeActionMenu";
import { RenameOverlay } from "./components/RenameOverlay";
import { SymbolSearchOverlay } from "./components/SymbolSearchOverlay";
import { QuickOpenOverlay } from "./components/QuickOpenOverlay";
import { CommandPalette } from "./components/CommandPalette";
import { DecoderOverlay } from "./components/DecoderOverlay";
import { RecentProjectsOverlay } from "./components/RecentProjectsOverlay";
import { useRecentProjects } from "./stores/recentProjects";
import { TransformModal } from "./components/TransformModal";
import { useTransformModal } from "./stores/transform";
import { transformSelection } from "./lib/transformSelection";
import { base64Decode, base64Encode, hexDecode, hexEncode, htmlDecode, htmlEncode, md5Hex, urlDecode, urlEncode } from "./lib/codec";
import { useDecoder } from "./stores/decoder";
import { ComparerOverlay } from "./components/ComparerOverlay";
import { useComparer } from "./stores/comparer";
import { useCatcher } from "./stores/catcher";
import { MacrosOverlay } from "./components/MacrosOverlay";
import { useMacros } from "./stores/macros";
import { subscribeProjectScan, useProjectScan } from "./stores/projectScan";
import { AiEditsOverlay } from "./components/AiEditsOverlay";
import { McpTrustPrompt } from "./components/McpTrustPrompt";
import { useAiEdits } from "./stores/aiEdits";
import { sendSelectionToChat } from "./lib/sendToChat";
import { copyConversation, exportConversation } from "./lib/chatExport";
import { BottomDock, SidePanel } from "./components/SidePanel";
import { SettingsView } from "./components/SettingsView";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { bridge } from "./lib/bridge";
import { requestCloseAll, requestCloseOthers, requestCloseTab } from "./lib/tabClose";
import { ConfirmHost } from "./components/ConfirmHost";
import { PromptHost } from "./components/PromptHost";
import { Toasts } from "./components/Toasts";
import { toast } from "./stores/toast";
import { cn } from "./lib/utils";
import { CrashReportDialog } from "./components/CrashReportDialog";
import { useTelemetry } from "./stores/telemetry";
import { useDiagnostics } from "./stores/diagnostics";
import { subscribeFindingsProject, useFindings } from "./stores/findings";
import { SETTINGS_PATH, useEditor } from "./stores/editor";
import { subscribeAiEvents, subscribeAiPulls } from "./stores/ai";
import { subscribeProxyTraffic } from "./stores/proxy";
import { subscribeOast } from "./stores/oast";
import { subscribeDebugEvents } from "./stores/debug";
import { useExtensions } from "./stores/extensions";
import { useSession } from "./stores/session";
import { useSymbolSearch } from "./stores/symbolSearch";
import { useQuickOpen } from "./stores/quickOpen";
import { comboOf, useCommandPalette } from "./stores/commands";
import { resetEslintState } from "./editor/features/eslint";
import { resetLspState, subscribeLspDiagnostics } from "./editor/features/lsp";
import { parseProjectRules, parseSecurityConfig, setProjectRules, setSecurityConfig } from "./editor/features/inspect/engine";
import { forgetTailwindTheme } from "./editor/features/tailwind";
import { applyLanguage, isLanguage, useT } from "./lib/i18n";
import { installCatcherSession } from "./lib/catcherSession";
import { forgetLastFile, recallLastFile, rememberLastFile } from "./lib/lastFile";
import { applySyntaxPalette, applyTheme, hasStoredLanguage, hydrateSettingsFromDisk, useSettings } from "./stores/settings";
import { useUpdate } from "./stores/update";
import { subscribeFsChanges, useWorkspace } from "./stores/workspace";
import logo from "./assets/wide-logo.png";


const KEEP_ALIVE = new Set(["terminal"]);



function RemoteFallbackNotice() {
  const t = useT();
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("remoteFallback") === "1") {
        setShow(true);
        params.delete("remoteFallback");
        const query = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
      }
    } catch {

    }
  }, []);
  if (!show) return null;
  return (
    <div className="wide-enter-fade fixed left-1/2 top-14 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-md border border-line bg-raised px-4 py-2 text-[12px] shadow-lg">
      <span className="text-status-warn">
        {t("The remote connection failed — running locally. Open Settings → Remote to check it.")}
      </span>
      <button
        type="button"
        onClick={() => setShow(false)}
        aria-label={t("Dismiss")}
        className="shrink-0 text-fg-faint transition-colors duration-100 hover:text-fg"
      >
        ✕
      </button>
    </div>
  );
}



function SssfDegradedNotice() {
  const t = useT();
  const [state, setState] = useState<{ degraded: boolean; lastError: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void bridge
      .sssfStatus()
      .then((reply) => { if (alive && reply.ok && reply.status) setState({ degraded: reply.status.degraded, lastError: reply.status.lastError }); })
      .catch(() => {});
    const off = bridge.onSssfChanged((status) => setState({ degraded: status.degraded, lastError: status.lastError }));
    return () => { alive = false; off(); };
  }, []);
  if (!state?.degraded) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[400] flex items-center justify-center gap-3 border-b border-status-error/40 bg-status-error/15 px-4 py-1.5 text-[12px]">
      <ShieldAlert className="size-4 shrink-0 text-status-error" strokeWidth={2} />
      <span className="text-status-error">{t("Security policy failed to load — Wide is locked. Fix the policy file, then reload.")}</span>
      {state.lastError && <span className="min-w-0 truncate text-fg-faint" title={state.lastError}>{state.lastError}</span>}
      <button
        type="button"
        onClick={() => void bridge.sssfReload()}
        className="shrink-0 rounded-sm border border-status-error/50 px-2 py-0.5 text-status-error transition-colors duration-100 hover:bg-status-error/20"
      >
        {t("Reload policy")}
      </button>
    </div>
  );
}



function addSecurityFindingsForActiveFile(): number {
  const editor = useEditor.getState();
  const path = editor.lastFilePath;
  if (!path) return 0;
  const tab = editor.tabs.find((item) => item.path === path);
  if (!tab || tab.kind !== "file") return 0;
  const diagnostics = useDiagnostics.getState().bySource[path]?.security ?? [];
  if (diagnostics.length === 0) return 0;

  const lineFor = (from: number): number => {
    let line = 1;
    for (let i = 0; i < Math.min(from, tab.content.length); i += 1) if (tab.content[i] === "\n") line += 1;
    return line;
  };
  const severityOf = { error: "high", warning: "medium", info: "low", hint: "low" } as const;
  const add = useFindings.getState().add;
  for (const diagnostic of diagnostics) {
    add({
      title: diagnostic.message.split("\n")[0],
      severity: severityOf[diagnostic.severity] ?? "low",
      location: `${path}:${lineFor(diagnostic.from)}`,
      detail: diagnostic.message,
    });
  }
  return diagnostics.length;
}

function BootGate() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: "#3b4252" }}>
      <img src={logo} alt="Wide" width={432} height={432} className="size-[432px] select-none animate-pulse" draggable={false} />
    </div>
  );
}

export default function App() {


  const [activeSide, setActiveSide] = useState<string | null>("project");
  const [activeBottom, setActiveBottom] = useState<string | null>(null);

  const [mounted, setMounted] = useState<Set<string>>(() => new Set(["project"]));

  const saveActive = useEditor((state) => state.saveActive);
  const formatActive = useEditor((state) => state.formatActive);
  const openFolder = useWorkspace((state) => state.openFolder);
  const rootName = useWorkspace((state) => state.rootName);
  const root = useWorkspace((state) => state.root);


  const settingsOpen = useEditor((state) => state.activePath === SETTINGS_PATH);
  const booting = useUpdate((state) => state.booting);




  const hasFileTab = useEditor((state) =>
    state.tabs.some(
      (tab) => tab.kind === "file" || tab.kind === "catcher" || tab.kind === "pitcher" || tab.kind === "browser" || tab.kind === "scratchpad",
    ),
  );
  const closeTab = useEditor((state) => state.closeTab);
  const t = useT();

  const title = useEditor(
    useShallow((state) => {
      const tab = state.tabs.find((item) => item.path === state.activePath);
      return {
        name: tab?.name ?? null,
        dirty: tab?.kind === "file" ? tab.content !== tab.savedContent : false,
      };
    }),
  );


  useEffect(() => {

    const adjustFontSize = (delta: number) => {
      const current = useSettings.getState().fontSize;
      const next = Math.min(24, Math.max(10, current + delta));
      if (next !== current) useSettings.getState().set({ fontSize: next });
    };
    const onKeyDown = (event: KeyboardEvent) => {


      if (event.ctrlKey || event.metaKey || event.altKey) {
        const boundId = useCommandPalette.getState().bindings[comboOf(event)];
        if (boundId && useCommandPalette.getState().runById(boundId)) {
          event.preventDefault();
          return;
        }
      }
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void saveActive();
      } else if (key === "o") {
        event.preventDefault();
        void openFolder();
      } else if (key === "w" && !event.shiftKey && !event.altKey) {


        const active = useEditor.getState().activePath;
        if (active) {
          event.preventDefault();
          void requestCloseTab(active);
        }
      } else if (key === "t" && event.shiftKey && !event.altKey) {

        event.preventDefault();
        useEditor.getState().reopenClosed();
      } else if (key === "," && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        useEditor.getState().openSettings();
      } else if (key === "e" && event.altKey) {
        event.preventDefault();
        useTransformModal.getState().openModal();
      } else if (key === "s" && event.altKey) {
        event.preventDefault();
        const next = !useSettings.getState().streamerMode;
        useSettings.getState().set({ streamerMode: next });
        if (next) toast.success("Streamer mode enabled: secrets & API keys masked");
        else toast.info("Streamer mode disabled");
      } else if (key === "tab") {

        const { tabs, activePath, setActive } = useEditor.getState();
        if (tabs.length > 1) {
          event.preventDefault();
          const i = tabs.findIndex((tab) => tab.path === activePath);
          const n = tabs.length;
          const next = tabs[(i + (event.shiftKey ? n - 1 : 1) + n) % n];
          if (next) setActive(next.path);
        }
      } else if (event.altKey && event.shiftKey && key === "f") {


        event.preventDefault();
        void formatActive();
      } else if (event.shiftKey && key === "f") {
        event.preventDefault();
        openPanel("search");
      } else if (key === "r" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        useRecentProjects.getState().open();
      } else if (key === "t" && !event.shiftKey && !event.altKey) {

        event.preventDefault();
        if (useWorkspace.getState().root) useSymbolSearch.getState().openSearch();
        else toast.info(t("Open a folder to search its symbols."));
      } else if (key === "p" && event.shiftKey) {

        event.preventDefault();
        useCommandPalette.getState().openPalette();
      } else if (key === "p" && !event.altKey) {

        event.preventDefault();
        if (useWorkspace.getState().root) useQuickOpen.getState().openPalette();
        else toast.info(t("Open a folder to quick-open its files."));
      } else if (key === "=" || key === "+") {


        event.preventDefault();
        adjustFontSize(1);
      } else if (key === "-" || key === "_") {
        event.preventDefault();
        adjustFontSize(-1);
      } else if (key === "0") {

        event.preventDefault();
        useSettings.getState().set({ fontSize: 13 });
      }
    };
    let wheelDelta = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const target = event.target as Element | null;
      const isCodeEditor = Boolean(
        target?.closest(".cm-editor, [data-code-editor], .cm-scroller, .cm-content")
      );
      if (!isCodeEditor) return;
      wheelDelta += event.deltaY;
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheelDelta = 0;
      }, 200);
      const threshold = 40;
      if (wheelDelta <= -threshold) {
        adjustFontSize(1);
        wheelDelta = 0;
      } else if (wheelDelta >= threshold) {
        adjustFontSize(-1);
        wheelDelta = 0;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel, true);
      if (wheelTimer) clearTimeout(wheelTimer);
    };



  }, [saveActive, openFolder, formatActive]);




  useEffect(() => {
    useDiagnostics.getState().reset();


    forgetTailwindTheme();
    resetEslintState();
    resetLspState();



    setProjectRules([]);
    setSecurityConfig(parseSecurityConfig(""));
    useCommandPalette.getState().setBindings({});
    if (root) {
      void bridge
        .readFile(`${root}/.wide/rules.json`)
        .then((file) => {
          const parsed = parseProjectRules(file?.content ?? "");
          setProjectRules(parsed.rules);
          for (const error of parsed.errors) console.warn(`[inspections] ${error}`);
        })
        .catch(() => setProjectRules([]));

      void bridge
        .readFile(`${root}/.wide/security.json`)
        .then((file) => setSecurityConfig(parseSecurityConfig(file?.content ?? "")))
        .catch(() => setSecurityConfig(parseSecurityConfig("")));


      void bridge
        .readFile(`${root}/.wide/keybindings.json`)
        .then((file) => {
          if (!file?.content) return;
          const parsed = JSON.parse(file.content) as { bindings?: Record<string, string> };
          if (parsed && parsed.bindings && typeof parsed.bindings === "object") {
            useCommandPalette.getState().setBindings(parsed.bindings);
          }
        })
        .catch(() => useCommandPalette.getState().setBindings({}));
    }
  }, [root]);


  useEffect(() => {
    useSession.getState().wipe();
    return () => useSession.getState().wipe();
  }, [root]);


  useEffect(() => {
    const marker = title.dirty ? "● " : "";
    const parts = [title.name && `${marker}${title.name}`, rootName, "Wide"];
    void bridge.setTitle(parts.filter(Boolean).join(" — "));
  }, [title, rootName]);

  useEffect(() => {
    applySyntaxPalette();
    applyLanguage();
    applyTheme();


    void useExtensions.getState().refresh();
  }, []);



  const installedExtensions = useExtensions((state) => state.installed);
  useEffect(() => {
    const orphans = [...mounted].filter((id) => {
      const owner = panelById(id)?.extension;
      return owner && !installedExtensions.has(owner);
    });
    if (orphans.length === 0) return;
    setMounted((current) => {
      const next = new Set(current);
      for (const id of orphans) next.delete(id);
      return next;
    });


    setActiveSide((current) => (current && orphans.includes(current) ? null : current));
    setActiveBottom((current) => (current && orphans.includes(current) ? null : current));
  }, [installedExtensions, mounted]);



  useEffect(() => subscribeLspDiagnostics(), []);



  useEffect(() => subscribeAiEvents(), []);
  useEffect(() => subscribeAiPulls(), []);


  useEffect(() => subscribeProxyTraffic(), []);
  useEffect(() => subscribeOast(), []);
  useEffect(() => subscribeDebugEvents(), []);

  useEffect(() => subscribeFsChanges(), []);

  useEffect(() => subscribeProjectScan(), []);
  useEffect(() => subscribeFindingsProject(), []);


  useEffect(() => {
    const off = bridge.onHostOpenPath(({ path }) => void useWorkspace.getState().openTarget(path));
    bridge.requestPendingOpenPath();
    return off;
  }, []);

  useEffect(() => {
    const offState = bridge.onBackendState(({ state }) => {
      if (state === "restarted") {
        toast.error(t("Wide's backend stopped and was restarted. Reopen your project to carry on; anything unsaved is still in the editor."));
      } else {
        toast.error(t("Wide's backend stopped and could not be restarted. Save your work elsewhere and restart Wide."));
      }
    });
    const offFault = bridge.onBackendFault(() => {
      toast.error(t("Something went wrong in Wide's backend. If a panel stops responding, restart Wide."));
    });
    return () => {
      offState();
      offFault();
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateSettingsFromDisk();
      if (cancelled) return;
      if (hasStoredLanguage()) return;
      const reply = await bridge.installLanguage().catch(() => null);
      const code = reply && reply.ok ? (reply.language ?? "") : "";
      if (!cancelled && code && isLanguage(code) && code !== useSettings.getState().language) {
        useSettings.getState().set({ language: code });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void useUpdate.getState().boot();
  }, []);

  useEffect(() => {
    void useTelemetry.getState().checkPending();
  }, []);

  const tabsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabsSig = useRef("");
  const restoredRoots = useRef(new Set<string>());

  const readyRoots = useRef(new Set<string>());

  useEffect(() => {
    const persist = () => {
      const currentRoot = useWorkspace.getState().root;

      if (!currentRoot || !readyRoots.current.has(currentRoot)) return;
      const state = useEditor.getState();
      const files = state.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.path);
      const active = state.activePath && files.includes(state.activePath) ? state.activePath : files[files.length - 1] ?? "";
      void bridge.saveTabs(currentRoot, { files, active }).catch(() => undefined);
    };
    const flush = () => {
      if (tabsSaveTimer.current) {
        clearTimeout(tabsSaveTimer.current);
        tabsSaveTimer.current = null;
      }
      persist();
    };
    const unsub = useEditor.subscribe((state) => {
      const files = state.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.path);
      const active = state.activePath && files.includes(state.activePath) ? state.activePath : "";
      const sig = `${files.join("|")}::${active}`;
      if (sig === tabsSig.current) return;
      tabsSig.current = sig;
      if (tabsSaveTimer.current) clearTimeout(tabsSaveTimer.current);
      tabsSaveTimer.current = setTimeout(persist, 300);
    });

    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      unsub();
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      if (tabsSaveTimer.current) clearTimeout(tabsSaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!root || restoredRoots.current.has(root)) return;
    restoredRoots.current.add(root);

    tabsSig.current = "";
    let cancelled = false;
    void (async () => {
      try {
        const reply = await bridge.loadTabs(root).catch(() => null);
        const saved = reply && reply.ok ? reply.tabs : null;
        if (cancelled || !saved || !Array.isArray(saved.files) || saved.files.length === 0) return;
        const editor = useEditor.getState();
        const open = new Set(editor.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.path));
        for (const path of saved.files) {
          if (cancelled) return;
          if (!open.has(path)) await editor.openFile(path);
        }
        if (!cancelled && saved.active && useEditor.getState().tabs.some((tab) => tab.path === saved.active)) {
          useEditor.getState().setActive(saved.active);
        }
      } finally {

        if (!cancelled) readyRoots.current.add(root);
      }
    })();
    return () => {
      cancelled = true;

      if (!readyRoots.current.has(root)) restoredRoots.current.delete(root);
    };
  }, [root]);

  useEffect(() => {
    if (!root) return undefined;
    return installCatcherSession(root);
  }, [root]);

  useEffect(() => {
    const timer = setInterval(
      () => {
        void (async () => {
          await useUpdate.getState().check();
          await useUpdate.getState().stage();
        })();
      },
      6 * 60 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, []);



  useEffect(() => {
    if (!root) return;
    const last = recallLastFile(root);
    if (!last) return;
    let cancelled = false;
    void (async () => {
      const opened = await useEditor.getState().openFile(last.path);
      if (cancelled) return;
      if (!opened) {
        forgetLastFile(root);
        return;
      }



      if (last.line > 1 || last.column > 1) {
        await useEditor.getState().revealAt(last.path, last.line, last.column);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root]);



  const activePath = useEditor((state) => state.activePath);
  const cursor = useEditor((state) => state.cursor);
  useEffect(() => {
    if (!root || !activePath || activePath.startsWith("wide://")) return;


    const timer = setTimeout(() => {
      rememberLastFile(root, activePath, cursor.line, cursor.column);
    }, 1000);
    return () => clearTimeout(timer);
  }, [root, activePath, cursor]);


  const fontSize = useSettings((state) => state.fontSize);
  const language = useSettings((state) => state.language);
  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${fontSize}px`);
  }, [fontSize]);

  const isBottom = (id: string) => panelById(id)?.place === "bottom";
  const isActive = (id: string) => (isBottom(id) ? activeBottom : activeSide) === id;

  const togglePanel = (id: string) => {
    setMounted((current) => (current.has(id) ? current : new Set(current).add(id)));
    const set = isBottom(id) ? setActiveBottom : setActiveSide;
    set((current) => (current === id ? null : id));
  };
  const openPanel = (id: string) => {
    setMounted((current) => (current.has(id) ? current : new Set(current).add(id)));
    (isBottom(id) ? setActiveBottom : setActiveSide)(id);
  };



  useEffect(() => {
    const installed = useExtensions.getState().installed;
    const has = (id: string) => installed.has(id);
    const hasRoot = () => Boolean(useWorkspace.getState().root);
    useCommandPalette.getState().register([
      { id: "file.save", title: "Save", group: "File", key: "ctrl+s", run: () => void useEditor.getState().saveActive() },
      { id: "file.format", title: "Format Document", group: "File", key: "ctrl+alt+shift+f", run: () => void useEditor.getState().formatActive() },
      { id: "file.closeTab", title: "Close Tab", group: "File", key: "ctrl+w", run: () => { const a = useEditor.getState().activePath; if (a) void requestCloseTab(a); } },
      { id: "file.reopenClosedTab", title: "Reopen Closed Tab", group: "File", key: "ctrl+shift+t", run: () => useEditor.getState().reopenClosed() },
      { id: "file.closeOthers", title: "Close Other Tabs", group: "File", run: () => { const a = useEditor.getState().activePath; if (a) void requestCloseOthers(a); } },
      { id: "file.closeAll", title: "Close All Tabs", group: "File", run: () => void requestCloseAll() },
      { id: "view.settings", title: "Settings", group: "View", key: "ctrl+,", run: () => useEditor.getState().openSettings() },
      { id: "view.split", title: "Toggle split editor", group: "View", run: () => useEditor.getState().toggleSplit() },
      { id: "view.splitRight", title: "Split Editor Right", group: "View", key: "ctrl+\\", run: () => { const ed = useEditor.getState(); ed.splitPane(ed.activePaneId, "vertical"); } },
      { id: "view.splitDown", title: "Split Editor Down", group: "View", key: "ctrl+k ctrl+\\", run: () => { const ed = useEditor.getState(); ed.splitPane(ed.activePaneId, "horizontal"); } },
      { id: "view.closePane", title: "Close Active Editor Pane", group: "View", run: () => { const ed = useEditor.getState(); ed.closePane(ed.activePaneId); } },
      { id: "view.layout.single", title: "Editor Layout: Single (1x1)", group: "View", run: () => useEditor.getState().setGridPreset("1x1") },
      { id: "view.layout.twoColumns", title: "Editor Layout: Two Columns (1x2)", group: "View", run: () => useEditor.getState().setGridPreset("1x2") },
      { id: "view.layout.twoRows", title: "Editor Layout: Two Rows (2x1)", group: "View", run: () => useEditor.getState().setGridPreset("2x1") },
      { id: "view.layout.grid", title: "Editor Layout: 2x2 Grid", group: "View", run: () => useEditor.getState().setGridPreset("2x2") },
      { id: "view.layout.threeColumns", title: "Editor Layout: Three Columns (1x3)", group: "View", run: () => useEditor.getState().setGridPreset("1x3") },
      { id: "view.layout.threeRows", title: "Editor Layout: Three Rows (3x1)", group: "View", run: () => useEditor.getState().setGridPreset("3x1") },
      { id: "view.nextPane", title: "Focus Next Editor Pane", group: "View", key: "f6", run: () => useEditor.getState().focusNextPane() },
      { id: "view.prevPane", title: "Focus Previous Editor Pane", group: "View", key: "shift+f6", run: () => useEditor.getState().focusPrevPane() },
      { id: "file.openFolder", title: "Open folder", group: "File", key: "ctrl+o", run: () => void useWorkspace.getState().openFolder() },
      { id: "file.openRecent", title: "Open Recent Project…", group: "File", key: "ctrl+r", run: () => useRecentProjects.getState().open() },
      { id: "go.file", title: "Go to File…", group: "Go", key: "ctrl+p", when: hasRoot, run: () => useQuickOpen.getState().openPalette() },
      { id: "go.symbol", title: "Go to Symbol in Project…", group: "Go", key: "ctrl+t", when: hasRoot, run: () => useSymbolSearch.getState().openSearch() },
      { id: "tool.decoder", title: "Decoder / JWT", group: "Tools", run: () => useDecoder.getState().openDecoder() },
      { id: "tool.transform", title: "Transform Selection…", group: "Tools", key: "ctrl+alt+e", run: () => useTransformModal.getState().openModal() },
      { id: "tool.transform.urle", title: "Transform: URL Encode Selection", group: "Tools", run: () => transformSelection(urlEncode) },
      { id: "tool.transform.urld", title: "Transform: URL Decode Selection", group: "Tools", run: () => transformSelection(urlDecode) },
      { id: "tool.transform.b64e", title: "Transform: Base64 Encode Selection", group: "Tools", run: () => transformSelection(base64Encode) },
      { id: "tool.transform.b64d", title: "Transform: Base64 Decode Selection", group: "Tools", run: () => transformSelection(base64Decode) },
      { id: "tool.transform.hexe", title: "Transform: Hex Encode Selection", group: "Tools", run: () => transformSelection(hexEncode) },
      { id: "tool.transform.hexd", title: "Transform: Hex Decode Selection", group: "Tools", run: () => transformSelection(hexDecode) },
      { id: "tool.transform.htmle", title: "Transform: HTML Entity Encode", group: "Tools", run: () => transformSelection(htmlEncode) },
      { id: "tool.transform.htmld", title: "Transform: HTML Entity Decode", group: "Tools", run: () => transformSelection(htmlDecode) },
      { id: "tool.transform.md5", title: "Transform: MD5 Hash Selection", group: "Tools", run: () => transformSelection(md5Hex) },
      { id: "tool.comparer", title: "Comparer", group: "Tools", run: () => useComparer.getState().openComparer() },
      { id: "catcher.intruder", title: "Catcher: Intruder", group: "Catcher", run: () => useCatcher.getState().show("intruder") },
      { id: "tool.macros", title: "Session macros", group: "Tools", run: () => useMacros.getState().openMacros() },
      { id: "view.explorer", title: "Explorer", group: "View", run: () => openPanel("project") },
      { id: "view.search", title: "Search", group: "View", key: "ctrl+shift+f", run: () => openPanel("search") },
      { id: "view.structure", title: "Structure", group: "View", run: () => openPanel("structure") },
      { id: "view.problems", title: "Problems", group: "View", run: () => openPanel("problems") },
      { id: "view.terminal", title: "Terminal", group: "View", run: () => openPanel("terminal") },
      { id: "view.build", title: "Build", group: "View", run: () => openPanel("build") },
      { id: "view.extensions", title: "Extensions", group: "View", run: () => openPanel("tools") },
      { id: "view.debug", title: "Debug", group: "View", run: () => openPanel("debug") },
      { id: "view.scm", title: "Source Control", group: "View", when: () => has("codeberg") || has("github"), run: () => openPanel(has("codeberg") ? "codeberg" : "github") },
      { id: "view.ai", title: "AI Assistant", group: "View", when: () => has("ai-assistant"), run: () => openPanel("ai") },
      { id: "ai.review", title: "Toggle: Review AI edits before applying", group: "AI", when: () => has("ai-assistant"), run: () => useAiEdits.getState().setReview(!useAiEdits.getState().reviewEnabled) },
      { id: "ai.ghost", title: "Toggle: Inline AI completions (ghost text)", group: "AI", when: () => has("ai-assistant"), run: () => useSettings.getState().set({ aiGhostText: !useSettings.getState().aiGhostText }) },
      { id: "ai.sendSelection", title: "Send the selection to the assistant", group: "AI", key: "ctrl+alt+a", when: () => has("ai-assistant"), run: () => void sendSelectionToChat() },
      { id: "ai.explainSelection", title: "Explain the selection", group: "AI", when: () => has("ai-assistant"), run: () => void sendSelectionToChat("Explain this code.") },
      { id: "ai.copyConversation", title: "Copy the conversation", group: "AI", when: () => has("ai-assistant"), run: () => void copyConversation() },
      { id: "ai.exportConversation", title: "Export the conversation to Markdown", group: "AI", when: () => has("ai-assistant"), run: () => void exportConversation() },
      { id: "security.toggle", title: "Toggle: Real-time security analysis", group: "Security", run: () => useSettings.getState().set({ securityLint: !useSettings.getState().securityLint }) },
      {
        id: "view.streamerMode",
        title: "Toggle Streamer Mode (Mask Secrets)",
        group: "View",
        key: "ctrl+alt+s",
        run: () => {
          const next = !useSettings.getState().streamerMode;
          useSettings.getState().set({ streamerMode: next });
          if (next) toast.success("Streamer mode enabled: secrets & API keys masked");
          else toast.info("Streamer mode disabled");
        },
      },
      { id: "security.toFindings", title: "Add this file's security issues to Findings", group: "Security", run: () => { if (addSecurityFindingsForActiveFile() > 0) openPanel("findings"); } },
      { id: "security.projectScan", title: "Scan project for cross-file vulnerabilities", group: "Security", when: hasRoot, run: () => { void useProjectScan.getState().run(); openPanel("problems"); } },
      { id: "view.catcher", title: "Catcher", group: "View", run: () => useEditor.getState().openCatcher() },
      { id: "view.pitcher", title: "Pitcher", group: "View", run: () => useEditor.getState().openPitcher() },
      { id: "view.browser", title: "Browser", group: "View", run: () => useEditor.getState().openBrowser() },
      { id: "view.scratchpad", title: "Scratchpad", group: "View", key: "ctrl+alt+n", run: () => useEditor.getState().openScratchpad() },
      { id: "catcher.proxy", title: "Catcher: Proxy", group: "Catcher", run: () => useCatcher.getState().show("proxy") },
      { id: "catcher.target", title: "Catcher: Target (Site Map)", group: "Catcher", run: () => useCatcher.getState().show("target") },
      { id: "catcher.repeater", title: "Catcher: Repeater", group: "Catcher", run: () => useCatcher.getState().show("repeater") },
      { id: "view.findings", title: "Findings", group: "View", run: () => openPanel("findings") },
    ]);



  }, [installedExtensions]);



  const hasBottomPanels = [...mounted].some((id) => panelById(id)?.place === "bottom");

  const panelsFor = (place: "top" | "bottom", active: string | null) =>
    [...mounted]
      .filter((id) => panelById(id)?.place === place)
      .filter((id) => id === active || KEEP_ALIVE.has(id))
      .map((id) => {
        const Body = panelById(id)?.component;
        if (!Body) return null;
        return (
          <div key={id} className={cn("h-full", id !== active && "hidden")}>
            <ErrorBoundary>
              <Suspense fallback={null}>
                <Body onOpenPanel={openPanel} />
              </Suspense>
            </ErrorBoundary>
          </div>
        );
      });





  if (booting) return <BootGate />;

  if (!root && !hasFileTab)
    return (
      <div className="relative h-full">
        <RemoteFallbackNotice />
      <SssfDegradedNotice />
        {settingsOpen ? (
          <div className="flex h-full flex-col bg-canvas">
            <div
              className="flex shrink-0 items-center border-b border-line px-2"
              style={{ height: "var(--h-tabbar)" }}
            >
              <button
                type="button"
                onClick={() => closeTab(SETTINGS_PATH)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-fg-dim",
                  "transition-colors duration-100 hover:bg-hover hover:text-fg",
                )}
              >
                <ChevronLeft className="size-3.5" strokeWidth={1.5} />
                {t("Back")}
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <SettingsView />
            </div>
          </div>
        ) : (
          <Launcher />
        )}
      </div>
    );

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      <RemoteFallbackNotice />
      <SssfDegradedNotice />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar isActive={isActive} onSelect={togglePanel} />
        {activeSide && <SidePanel>{panelsFor("top", activeSide)}</SidePanel>}
        {

}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {

}
          <ErrorBoundary>
            <EditorArea key={language} onOpenPanel={openPanel} />
          </ErrorBoundary>
          {

}
          {hasBottomPanels && (
            <BottomDock hidden={!activeBottom}>{panelsFor("bottom", activeBottom)}</BottomDock>
          )}
        </div>
      </div>
      <StatusBar onOpenPanel={openPanel} />
      <RenameOverlay />
      <CodeActionMenu />
      <SymbolSearchOverlay />
      <QuickOpenOverlay />
      <CommandPalette />
      <DecoderOverlay />
      <TransformModal />
      <RecentProjectsOverlay />
      <ComparerOverlay />
      <MacrosOverlay />
      <AiEditsOverlay />
      <McpTrustPrompt />
      <ConfirmHost />
      <PromptHost />
      <Toasts />
      <CrashReportDialog />
    </div>
  );
}
