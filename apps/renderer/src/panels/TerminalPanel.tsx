import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ChevronDown, Play, Plus, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import { useT } from "@/lib/i18n";
import { terminalFontFamily, terminalTheme } from "@/lib/themes";
import { PanelHeader, panelButtonClass } from "@/components/SidePanel";
import { bridge } from "@/lib/bridge";
import { openInBrowser } from "@/lib/browserActions";
import { cn } from "@/lib/utils";
import { useDevServers } from "@/stores/devServers";
import { useRemote } from "@/stores/remote";
import { useRun } from "@/stores/run";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";

interface TerminalTab {
  id: string;
  title: string;
  customName?: string;
  ptyId: number | null;
  status: "idle" | "running" | "error";
  shellChoice?: string;
  error?: string;
}

interface TerminalSession {
  term: Terminal;
  fit: FitAddon;
  container: HTMLDivElement | null;
  opened: boolean;
}

const SHELL_OPTIONS: { id: string; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "powershell", label: "PowerShell" },
  { id: "pwsh", label: "pwsh" },
  { id: "cmd", label: "Command Prompt" },
  { id: "gitbash", label: "Git Bash" },
  { id: "wsl", label: "WSL" },
];

export function TerminalPanel() {
  const t = useT();
  const theme = useSettings((state) => state.theme);
  const pending = useRun((state) => state.pending);
  const drain = useRun((state) => state.drain);
  const devServers = useDevServers((state) => state.origins);

  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const sessionsRef = useRef<Map<string, TerminalSession>>(new Map());
  const tabsRef = useRef<TerminalTab[]>([]);
  tabsRef.current = tabs;

  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;

  const nextIndexRef = useRef(1);
  const shellMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shellMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (shellMenuRef.current && !shellMenuRef.current.contains(e.target as Node)) {
        setShellMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [shellMenuOpen]);

  useEffect(() => {
    const th = terminalTheme();
    for (const session of sessionsRef.current.values()) {
      session.term.options.theme = th;
    }
  }, [theme]);

  const applyFonts = useCallback((term: Terminal, fit: FitAddon, ptyId: number | null) => {
    const stack = term.options.fontFamily ?? "";
    void (async () => {
      try {
        await Promise.all([
          document.fonts.load(`${term.options.fontSize}px "JetBrains Mono"`),
          document.fonts.load(`bold ${term.options.fontSize}px "JetBrains Mono"`),
        ]);
        await document.fonts.ready;
      } catch {
      }
      term.options.fontFamily = `${stack}, monospace`;
      term.options.fontFamily = stack;
      fit.fit();
      if (ptyId !== null) void bridge.terminalResize(ptyId, term.cols, term.rows);
    })();
  }, []);

  const openedOriginsRef = useRef<Set<string>>(new Set());
  const urlBufferRef = useRef("");
  const detectDevServer = useCallback((chunk: string) => {
    urlBufferRef.current = (urlBufferRef.current + chunk).slice(-600);
    const re = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'`<>()[\]]*)?/gi;
    const autoOpen = useSettings.getState().autoOpenDevServer;
    let match: RegExpExecArray | null;
    while ((match = re.exec(urlBufferRef.current)) !== null) {
      const url = match[0].replace(/[.,;:)\]]+$/, "");
      try {
        const origin = new URL(url).origin;
        useDevServers.getState().add(origin.replace("0.0.0.0", "localhost"));
        if (!autoOpen || openedOriginsRef.current.has(origin)) continue;
        openedOriginsRef.current.add(origin);
        openInBrowser(url.replace("0.0.0.0", "localhost"));
      } catch {
      }
    }
  }, []);

  const createTerminal = useCallback(
    (shellChoice?: string) => {
      const term = new Terminal({
        fontFamily: terminalFontFamily(),
        fontSize: 12,
        theme: terminalTheme(),
        cursorBlink: true,
        convertEol: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);

      const openLink = (url: string) => {
        if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|\?|#|$)/i.test(url)) {
          openInBrowser(url);
        } else {
          void bridge.openExternal(url);
        }
      };

      term.registerLinkProvider({
        provideLinks(bufferLine, callback) {
          const line = term.buffer.active.getLine(bufferLine - 1)?.translateToString(true) ?? "";
          const re = /\bhttps?:\/\/[^\s"'`<>()[\]]+/g;
          const links: {
            range: { start: { x: number; y: number }; end: { x: number; y: number } };
            text: string;
            activate: () => void;
          }[] = [];
          let m: RegExpExecArray | null;
          while ((m = re.exec(line)) !== null) {
            const url = m[0].replace(/[.,;:]+$/, "");
            links.push({
              range: { start: { x: m.index + 1, y: bufferLine }, end: { x: m.index + url.length, y: bufferLine } },
              text: url,
              activate: () => openLink(url),
            });
          }
          callback(links.length ? links : undefined);
        },
      });

      const tabId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const tabNumber = nextIndexRef.current++;
      const initialTab: TerminalTab = {
        id: tabId,
        title: `${tabNumber}: Terminal`,
        ptyId: null,
        status: "idle",
        shellChoice,
      };

      sessionsRef.current.set(tabId, {
        term,
        fit,
        container: null,
        opened: false,
      });

      term.onData((data) => {
        const currentTab = tabsRef.current.find((t) => t.id === tabId);
        if (currentTab?.ptyId !== null && currentTab?.ptyId !== undefined) {
          void bridge.terminalWrite(currentTab.ptyId, data);
        }
      });

      setTabs((prev) => [...prev, initialTab]);
      setActiveId(tabId);

      const remoteState = useRemote.getState();
      const containerId = remoteState.activeContainer;
      const container = containerId
        ? { id: containerId, name: remoteState.containers.find((c) => c.id === containerId)?.name }
        : undefined;
      const remote = container ? undefined : remoteState.activeProfile() ?? undefined;
      const chosenShell = shellChoice && shellChoice !== "default"
        ? shellChoice
        : useSettings.getState().terminalShell;

      void bridge
        .terminalStart({
          cols: term.cols || 80,
          rows: term.rows || 24,
          cwd: useWorkspace.getState().root ?? undefined,
          shell: chosenShell,
          remote,
          container,
        })
        .then((session) => {
          if (!sessionsRef.current.has(tabId)) {
            if (session?.id) void bridge.terminalDispose(session.id);
            return;
          }

          if (session?.error || !session?.id) {
            setTabs((prev) =>
              prev.map((t) =>
                t.id === tabId
                  ? { ...t, status: "error", error: session?.error ?? "Could not start a shell." }
                  : t,
              ),
            );
            term.writeln(`\x1b[31m${session?.error ?? "Could not start a shell."}\x1b[0m`);
            return;
          }

          const shellLabel = session.shell || (chosenShell !== "default" ? chosenShell : "Terminal");
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tabId
                ? { ...t, ptyId: session.id, title: `${tabNumber}: ${shellLabel}`, status: "running" }
                : t,
            ),
          );

          applyFonts(term, fit, session.id);
        });

      return tabId;
    },
    [applyFonts],
  );

  const closeTerminal = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (tab?.ptyId !== null && tab?.ptyId !== undefined) {
      void bridge.terminalDispose(tab.ptyId);
    }

    const session = sessionsRef.current.get(tabId);
    if (session) {
      session.term.dispose();
      sessionsRef.current.delete(tabId);
    }

    setTabs((prev) => {
      const nextTabs = prev.filter((t) => t.id !== tabId);
      if (nextTabs.length === 0) {
        return [];
      }
      return nextTabs;
    });

    if (activeIdRef.current === tabId) {
      setTabs((prev) => {
        const nextTabs = prev.filter((t) => t.id !== tabId);
        if (nextTabs.length > 0) {
          const last = nextTabs[nextTabs.length - 1];
          setActiveId(last.id);
        } else {
          setActiveId(null);
        }
        return nextTabs;
      });
    }
  }, []);

  useEffect(() => {
    if (tabs.length === 0) {
      createTerminal();
    }
  }, [tabs.length, createTerminal]);

  useEffect(() => {
    const offData = bridge.onTerminalData(({ id, text }) => {
      const tab = tabsRef.current.find((t) => t.ptyId === id);
      if (!tab) return;
      const session = sessionsRef.current.get(tab.id);
      if (session) {
        session.term.write(text);
        detectDevServer(text);
      }
    });

    const offExit = bridge.onTerminalExit(({ id }) => {
      const tab = tabsRef.current.find((t) => t.ptyId === id);
      if (!tab) return;
      const session = sessionsRef.current.get(tab.id);
      if (session) {
        session.term.writeln("\r\n\x1b[90m[process exited]\x1b[0m");
      }
      setTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, status: "idle", ptyId: null } : t)),
      );
    });

    return () => {
      offData?.();
      offExit?.();
    };
  }, [detectDevServer]);

  useEffect(() => {
    return useWorkspace.subscribe((next, prev) => {
      if (next.root === prev.root) return;
      openedOriginsRef.current.clear();
      useDevServers.getState().clear();

      for (const [id, session] of sessionsRef.current.entries()) {
        const tab = tabsRef.current.find((t) => t.id === id);
        if (tab?.ptyId) void bridge.terminalDispose(tab.ptyId);
        session.term.dispose();
      }
      sessionsRef.current.clear();
      nextIndexRef.current = 1;
      setTabs([]);
      setActiveId(null);
    });
  }, []);

  useEffect(() => {
    return useRemote.subscribe((next, prev) => {
      if (next.activeId === prev.activeId && next.activeContainer === prev.activeContainer) return;
      for (const [id, session] of sessionsRef.current.entries()) {
        const tab = tabsRef.current.find((t) => t.id === id);
        if (tab?.ptyId) void bridge.terminalDispose(tab.ptyId);
        session.term.dispose();
      }
      sessionsRef.current.clear();
      nextIndexRef.current = 1;
      setTabs([]);
      setActiveId(null);
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const [id, session] of sessionsRef.current.entries()) {
        const tab = tabsRef.current.find((t) => t.id === id);
        if (tab?.ptyId) void bridge.terminalDispose(tab.ptyId);
        session.term.dispose();
      }
      sessionsRef.current.clear();
    };
  }, []);

  const bindContainer = useCallback((tabId: string, node: HTMLDivElement | null) => {
    const session = sessionsRef.current.get(tabId);
    if (!session || !node) return;
    session.container = node;
    if (!session.opened) {
      session.term.open(node);
      session.opened = true;
      session.fit.fit();
      const currentTab = tabsRef.current.find((t) => t.id === tabId);
      if (currentTab?.ptyId) {
        void bridge.terminalResize(currentTab.ptyId, session.term.cols, session.term.rows);
      }
    }
  }, []);

  const selectTab = useCallback((tabId: string) => {
    setActiveId(tabId);
    requestAnimationFrame(() => {
      const session = sessionsRef.current.get(tabId);
      if (session) {
        session.fit.fit();
        session.term.focus();
        const tab = tabsRef.current.find((t) => t.id === tabId);
        if (tab?.ptyId) {
          void bridge.terminalResize(tab.ptyId, session.term.cols, session.term.rows);
        }
      }
    });
  }, []);

  useLayoutEffect(() => {
    const onResize = () => {
      if (!activeId) return;
      const session = sessionsRef.current.get(activeId);
      if (session && session.container) {
        session.fit.fit();
        const tab = tabsRef.current.find((t) => t.id === activeId);
        if (tab?.ptyId) {
          void bridge.terminalResize(tab.ptyId, session.term.cols, session.term.rows);
        }
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeId]);

  const activeSession = activeId ? sessionsRef.current.get(activeId) : null;
  useEffect(() => {
    if (!activeSession?.container) return;
    const observer = new ResizeObserver(() => {
      if (activeSession.container && activeSession.container.clientWidth > 0 && activeSession.container.clientHeight > 0) {
        activeSession.fit.fit();
        const tab = tabsRef.current.find((t) => t.id === activeId);
        if (tab?.ptyId) {
          void bridge.terminalResize(tab.ptyId, activeSession.term.cols, activeSession.term.rows);
        }
      }
    });
    observer.observe(activeSession.container);
    return () => observer.disconnect();
  }, [activeSession, activeId]);

  useEffect(() => {
    if (pending.length === 0) return;
    const commands = drain();
    if (commands.length === 0) return;

    let targetTab = tabsRef.current.find((t) => t.id === activeId);
    if (!targetTab || targetTab.status !== "running" || targetTab.ptyId === null) {
      const running = tabsRef.current.find((t) => t.status === "running" && t.ptyId !== null);
      if (running) {
        selectTab(running.id);
        targetTab = running;
      } else {
        createTerminal();
        return;
      }
    }

    if (targetTab?.ptyId) {
      for (const cmd of commands) {
        void bridge.terminalWrite(targetTab.ptyId, `${cmd}\r`);
      }
    }
  }, [pending, drain, activeId, selectTab, createTerminal]);

  const currentTab = tabs.find((t) => t.id === activeId);

  const handleClear = () => {
    if (activeId) {
      sessionsRef.current.get(activeId)?.term.clear();
    }
  };

  const commitRename = (tabId: string) => {
    const trimmed = editingName.trim();
    if (trimmed) {
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, customName: trimmed } : t)),
      );
    }
    setEditingId(null);
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Terminal")}>
        <div className="relative flex items-center" ref={shellMenuRef}>
          <button
            type="button"
            title={t("New tab")}
            aria-label={t("New tab")}
            onClick={() => createTerminal()}
            className={panelButtonClass}
          >
            <Plus className="size-3.5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            title={t("Terminal shell")}
            aria-label={t("Terminal shell")}
            onClick={() => setShellMenuOpen((v) => !v)}
            className="flex h-6 w-4 items-center justify-center text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <ChevronDown className="size-3" strokeWidth={2} />
          </button>

          {shellMenuOpen && (
            <div className="wide-pop-up absolute right-0 top-full z-[300] mt-1 w-44 rounded-md border border-line bg-panel p-1 shadow-lg">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                {t("Terminal shell")}
              </div>
              {SHELL_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setShellMenuOpen(false);
                    createTerminal(opt.id);
                  }}
                  className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-[12px] text-fg transition-colors duration-100 hover:bg-hover hover:text-fg-bright"
                >
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          title={t("Run dev script")}
          aria-label={t("Run dev script")}
          onClick={() => useRun.getState().quickRunDev()}
          className={panelButtonClass}
        >
          <Play className="size-3.5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          title={t("Clear")}
          aria-label={t("Clear")}
          onClick={handleClear}
          className={panelButtonClass}
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} />
        </button>
        {currentTab && (
          <button
            type="button"
            title={t("Close Tab")}
            aria-label={t("Close Tab")}
            onClick={() => closeTerminal(currentTab.id)}
            className={panelButtonClass}
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
      </PanelHeader>

      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-chrome/50 px-2 py-1 overflow-x-auto select-none">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const isEditing = tab.id === editingId;

          return (
            <div
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              onDoubleClick={() => {
                setEditingId(tab.id);
                setEditingName(tab.customName || tab.title);
              }}
              className={cn(
                "group relative flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] transition-all duration-100 cursor-pointer",
                isActive
                  ? "border-line-strong bg-selected text-fg-bright font-medium shadow-xs"
                  : "border-transparent bg-panel/40 text-fg-dim hover:border-line hover:bg-hover hover:text-fg",
              )}
            >
              <TerminalIcon className="size-3 shrink-0 opacity-70" strokeWidth={1.8} />

              {isEditing ? (
                <input
                  type="text"
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => commitRename(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(tab.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-20 rounded bg-canvas px-1 py-0 text-[11px] text-fg outline-hidden ring-1 ring-accent"
                />
              ) : (
                <span className="max-w-[120px] truncate">{tab.customName || tab.title}</span>
              )}

              {tab.status === "running" && (
                <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />
              )}
              {tab.status === "idle" && (
                <span className="size-1.5 shrink-0 rounded-full bg-fg-faint" />
              )}
              {tab.status === "error" && (
                <span className="size-1.5 shrink-0 rounded-full bg-status-error" />
              )}

              <button
                type="button"
                title={t("Close Tab")}
                aria-label={t("Close Tab")}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(tab.id);
                }}
                className="ml-0.5 rounded-sm p-0.5 text-fg-faint opacity-50 transition-all hover:bg-raised hover:text-fg hover:opacity-100"
              >
                <X className="size-2.5" strokeWidth={2} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          title={t("New tab")}
          aria-label={t("New tab")}
          onClick={() => createTerminal()}
          className="flex h-5 w-5 items-center justify-center rounded text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <Plus className="size-3" strokeWidth={2} />
        </button>
      </div>

      {devServers.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1">
          <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Local servers")}</span>
          {devServers.map((origin) => (
            <button
              key={origin}
              type="button"
              title={t("Open in the built-in browser")}
              onClick={() => openInBrowser(origin)}
              className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] text-accent transition-colors duration-100 hover:bg-hover"
            >
              {origin.replace(/^https?:\/\//, "")}
            </button>
          ))}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-canvas p-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(node) => bindContainer(tab.id, node)}
            className={cn("h-full w-full", tab.id === activeId ? "block" : "hidden")}
          />
        ))}
      </div>

      {currentTab?.status === "error" && (
        <p className="shrink-0 border-t border-line px-3 py-1 text-[11px] text-status-error">
          {currentTab.error || t("Could not start a shell.")}
        </p>
      )}
    </div>
  );
}

