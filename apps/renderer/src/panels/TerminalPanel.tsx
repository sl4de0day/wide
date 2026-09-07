import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import { useT } from "@/lib/i18n";
import { terminalFontFamily, terminalTheme } from "@/lib/themes";
import { PanelHeader, panelButtonClass } from "@/components/SidePanel";
import { bridge } from "@/lib/bridge";
import { openInBrowser } from "@/lib/browserActions";
import { useDevServers } from "@/stores/devServers";
import { useRemote } from "@/stores/remote";
import { useRun } from "@/stores/run";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";

export function TerminalPanel() {
  const holder = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<number | null>(null);

  const startRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const pending = useRun((state) => state.pending);
  const drain = useRun((state) => state.drain);
  const theme = useSettings((state) => state.theme);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = terminalTheme();
  }, [theme]);

  useEffect(() => {
    if (!holder.current) return;
    const node = holder.current;
    const term = new Terminal({
      fontFamily: terminalFontFamily(),
      fontSize: 12,
      theme: terminalTheme(),
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(node);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const openLink = (url: string) => {
      if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|\?|#|$)/i.test(url)) openInBrowser(url);
      else void bridge.openExternal(url);
    };
    term.registerLinkProvider({
      provideLinks(bufferLine, callback) {
        const line = term.buffer.active.getLine(bufferLine - 1)?.translateToString(true) ?? "";
        const re = /\bhttps?:\/\/[^\s"'`<>()[\]]+/g;
        const links: { range: { start: { x: number; y: number }; end: { x: number; y: number } }; text: string; activate: () => void }[] = [];
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
      if (termRef.current !== term) return;
      term.options.fontFamily = `${stack}, monospace`;
      term.options.fontFamily = stack;
      fit.fit();
      if (idRef.current !== null) void bridge.terminalResize(idRef.current, term.cols, term.rows);
    })();

    let disposed = false;

    let urlBuffer = "";
    const openedOrigins = new Set<string>();
    const detectDevServer = (chunk: string) => {
      urlBuffer = (urlBuffer + chunk).slice(-600);
      const re = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'`<>()[\]]*)?/gi;
      const autoOpen = useSettings.getState().autoOpenDevServer;
      let match: RegExpExecArray | null;
      while ((match = re.exec(urlBuffer)) !== null) {
        const url = match[0].replace(/[.,;:)\]]+$/, "");
        try {
          const origin = new URL(url).origin;
          useDevServers.getState().add(origin.replace("0.0.0.0", "localhost"));
          if (!autoOpen || openedOrigins.has(origin)) continue;
          openedOrigins.add(origin);
          openInBrowser(url.replace("0.0.0.0", "localhost"));
        } catch {

        }
      }
    };

    const offData = bridge.onTerminalData(({ id, text }) => {
      if (id !== idRef.current) return;
      term.write(text);
      detectDevServer(text);
    });
    const offExit = bridge.onTerminalExit(({ id }) => {
      if (id !== idRef.current) return;
      term.writeln("\r\n[90m[process exited][0m");
      idRef.current = null;
      setStatus("idle");
    });

    const start = () => {
      if (idRef.current !== null) return;
      const remoteState = useRemote.getState();
      const containerId = remoteState.activeContainer;
      const container = containerId ? { id: containerId, name: remoteState.containers.find((c) => c.id === containerId)?.name } : undefined;
      const remote = container ? undefined : remoteState.activeProfile() ?? undefined;
      void bridge
        .terminalStart({ cols: term.cols, rows: term.rows, cwd: useWorkspace.getState().root ?? undefined, shell: useSettings.getState().terminalShell, remote, container })
        .then((session) => {
          if (disposed) return;
          if (session?.error || !session?.id) {
            setStatus("error");
            term.writeln(`[31m${session?.error ?? "Could not start a shell."}[0m`);
            return;
          }
          idRef.current = session.id;
          setStatus("running");
        });
    };
    startRef.current = start;
    start();

    const offShell = useSettings.subscribe((next, prev) => {
      if (next.terminalShell === prev.terminalShell) return;
      const current = idRef.current;
      idRef.current = null;
      if (current !== null) void bridge.terminalDispose(current);
      term.reset();
      start();
    });

    const offRemote = useRemote.subscribe((next, prev) => {
      if (next.activeId === prev.activeId && next.activeContainer === prev.activeContainer) return;
      const current = idRef.current;
      idRef.current = null;
      if (current !== null) void bridge.terminalDispose(current);
      term.reset();
      start();
    });

    const offWorkspace = useWorkspace.subscribe((next, prev) => {
      if (next.root === prev.root) return;
      const current = idRef.current;
      idRef.current = null;
      if (current !== null) void bridge.terminalDispose(current);
      term.reset();
      openedOrigins.clear();
      useDevServers.getState().clear();
      start();
    });

    term.onData((data) => {
      if (idRef.current !== null) void bridge.terminalWrite(idRef.current, data);
    });

    const onResize = () => {
      fit.fit();
      if (idRef.current !== null) void bridge.terminalResize(idRef.current, term.cols, term.rows);
    };
    window.addEventListener("resize", onResize);

    const observer = new ResizeObserver(() => {

      if (node.clientWidth > 0 && node.clientHeight > 0) onResize();
    });
    observer.observe(node);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      offData?.();
      offExit?.();
      offShell();
      offRemote();
      offWorkspace();
      if (idRef.current !== null) void bridge.terminalDispose(idRef.current);
      term.dispose();
      termRef.current = null;
      startRef.current = null;
    };

  }, []);

  useEffect(() => {
    if (pending.length === 0) return;
    const id = idRef.current;
    if (status !== "running" || id === null) {

      startRef.current?.();
      return;
    }
    for (const command of drain()) {
      void bridge.terminalWrite(id, `${command}\r`);
    }
  }, [pending, drain, status]);
  const t = useT();
  const devServers = useDevServers((state) => state.origins);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Terminal")}>
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
          onClick={() => termRef.current?.clear()}
          className={panelButtonClass}
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} />
        </button>
      </PanelHeader>
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
      <div className="min-h-0 flex-1 overflow-hidden bg-canvas p-1">
        <div ref={holder} className="h-full" />
      </div>
      {status === "error" && (
        <p className="shrink-0 border-t border-line px-3 py-1 text-[11px] text-status-error">
          {t("Could not start a shell.")}
        </p>
      )}
    </div>
  );
}
