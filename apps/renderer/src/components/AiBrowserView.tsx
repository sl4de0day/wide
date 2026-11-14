import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Clock,
  Download,
  Globe,
  Hand,
  Lock,
  Maximize2,
  Minimize2,
  Power,
  RotateCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { bridge, type AiBrowserDetectedInfo } from "@/lib/bridge";
import { forwardBrowserKey, forwardBrowserMouse, useAiBrowser } from "@/stores/aiBrowser";

export function AiBrowserView() {
  const active = useAiBrowser((s) => s.active);
  const url = useAiBrowser((s) => s.url);
  const title = useAiBrowser((s) => s.title);
  const loading = useAiBrowser((s) => s.loading);
  const lastAction = useAiBrowser((s) => s.lastAction);
  const frame = useAiBrowser((s) => s.frame);
  const history = useAiBrowser((s) => s.history);
  const status = useAiBrowser((s) => s.status);
  const canGoBack = useAiBrowser((s) => s.canGoBack);
  const canGoForward = useAiBrowser((s) => s.canGoForward);
  const proxyPort = useAiBrowser((s) => s.proxyPort);
  const browserLabel = useAiBrowser((s) => s.browserLabel);
  const installing = useAiBrowser((s) => s.installing);
  const installStatus = useAiBrowser((s) => s.installStatus);
  const takeover = useAiBrowser((s) => s.takeover);
  const setTakeover = useAiBrowser((s) => s.setTakeover);
  const syncSession = useAiBrowser((s) => s.syncSession);
  const clear = useAiBrowser((s) => s.clear);

  const [showLog, setShowLog] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [draftUrl, setDraftUrl] = useState(url);
  const [urlFocused, setUrlFocused] = useState(false);
  const [detected, setDetected] = useState<AiBrowserDetectedInfo | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const lastMoveRef = useRef<number>(0);

  useEffect(() => {
    if (!urlFocused) setDraftUrl(url);
  }, [url, urlFocused]);

  useEffect(() => {
    let cancelled = false;
    void bridge.aiBrowserStatus().then((res) => {
      if (cancelled || !res.ok) return;
      if (res.detected) setDetected(res.detected);
      if (res.session) syncSession(res.session);
    });
    return () => {
      cancelled = true;
    };
  }, [syncSession]);

  const navigateUrl = (event: FormEvent) => {
    event.preventDefault();
    const target = draftUrl.trim();
    if (!target) return;
    void bridge.aiBrowserNav({ action: active ? "goto" : "open", url: target }).then((res) => {
      if (res.ok && res.session) syncSession(res.session);
    });
  };

  const runNav = (action: "back" | "forward" | "reload" | "toggle_proxy") => {
    void bridge.aiBrowserNav({ action }).then((res) => {
      if (res.ok && res.session) syncSession(res.session);
    });
  };

  const launchDefault = () => {
    const startUrl = draftUrl && draftUrl !== "about:blank" ? draftUrl : "https://example.com";
    void bridge.aiBrowserNav({ action: "open", url: startUrl }).then((res) => {
      if (res.ok && res.session) syncSession(res.session);
    });
  };

  const installRuntime = () => {
    void bridge.aiBrowserInstall().then((res) => {
      if (res.ok && res.label) {
        setDetected({
          found: true,
          executablePath: res.executablePath || "",
          label: res.label,
          source: res.source || "playwright",
        });
      }
    });
  };

  const closeSession = () => {
    void bridge.aiBrowser("close").then(() => clear());
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!takeover || !imgRef.current) return;
    const now = Date.now();
    if (now - lastMoveRef.current < 45) return;
    lastMoveRef.current = now;
    forwardBrowserMouse("mousemove", imgRef.current.getBoundingClientRect(), event.clientX, event.clientY);
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!takeover || !imgRef.current) return;
    event.preventDefault();
    viewportRef.current?.focus();
    forwardBrowserMouse(
      "mousedown",
      imgRef.current.getBoundingClientRect(),
      event.clientX,
      event.clientY,
      event.button,
      event.detail || 1,
    );
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    if (!takeover || !imgRef.current) return;
    forwardBrowserMouse(
      "mouseup",
      imgRef.current.getBoundingClientRect(),
      event.clientX,
      event.clientY,
      event.button,
      event.detail || 1,
    );
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!takeover) return;
    event.preventDefault();
    void bridge.aiBrowserInput({ type: "wheel", deltaX: event.deltaX, deltaY: event.deltaY });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!takeover) return;
    event.preventDefault();
    event.stopPropagation();
    forwardBrowserKey(event.key, event.ctrlKey, event.altKey, event.metaKey);
  };

  const engineLabel = browserLabel || (detected?.found ? detected.label : "Browser");

  return (
    <div className={`flex flex-col h-full w-full bg-mono-950 text-mono-200 select-none ${fullscreen ? "fixed inset-0 z-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-mono-800 bg-mono-900 text-xs">
        <div className="flex items-center gap-2 shrink-0">
          <Globe className="w-4 h-4 text-sky-400" />
          <span className="font-semibold text-mono-100">AI Browser</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-mono-800 text-mono-300 border border-mono-700">
            {engineLabel}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${
              takeover
                ? "bg-sky-500/15 text-sky-300 border-sky-500/40"
                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${takeover ? "bg-sky-400" : "bg-emerald-400 animate-pulse"}`} />
            {takeover ? "TAKEOVER" : status.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={!canGoBack}
            onClick={() => runNav("back")}
            title="Back"
            className="p-1 rounded border border-mono-800 bg-mono-950 text-mono-300 hover:bg-mono-800 disabled:opacity-35 disabled:pointer-events-none"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!canGoForward}
            onClick={() => runNav("forward")}
            title="Forward"
            className="p-1 rounded border border-mono-800 bg-mono-950 text-mono-300 hover:bg-mono-800 disabled:opacity-35 disabled:pointer-events-none"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!active}
            onClick={() => runNav("reload")}
            title="Reload"
            className="p-1 rounded border border-mono-800 bg-mono-950 text-mono-300 hover:bg-mono-800 disabled:opacity-35 disabled:pointer-events-none"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-sky-400" : ""}`} />
          </button>
        </div>

        <form onSubmit={navigateUrl} className="flex-1 min-w-[180px] flex items-center gap-1.5 px-2.5 py-1 bg-mono-950 border border-mono-800 rounded focus-within:border-sky-500/60">
          <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
          <input
            type="text"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            onFocus={() => setUrlFocused(true)}
            onBlur={() => setUrlFocused(false)}
            placeholder="https://..."
            className="w-full bg-transparent text-mono-200 font-mono text-[11px] outline-none select-text"
          />
        </form>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => runNav("toggle_proxy")}
            title="Toggle Catcher proxy routing"
            className={`px-2 py-1 rounded text-[10px] font-mono border transition ${
              proxyPort > 0
                ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20"
                : "bg-mono-950 text-mono-400 border-mono-800 hover:text-mono-200"
            }`}
          >
            {proxyPort > 0 ? `Catcher :${proxyPort}` : "Direct"}
          </button>

          <button
            type="button"
            onClick={() => setTakeover(!takeover)}
            disabled={!frame}
            className={`px-2 py-1 rounded text-[11px] border flex items-center gap-1 transition disabled:opacity-40 ${
              takeover
                ? "bg-sky-500/20 text-sky-300 border-sky-500/50 font-medium"
                : "bg-mono-950 text-mono-300 border-mono-800 hover:bg-mono-800"
            }`}
          >
            <Hand className="w-3 h-3" />
            {takeover ? "Release Control" : "Take Control"}
          </button>

          <button
            type="button"
            onClick={() => setShowLog(!showLog)}
            className={`px-2 py-1 rounded text-[11px] border border-mono-800 flex items-center gap-1 transition ${
              showLog ? "bg-mono-800 text-mono-100" : "bg-mono-950 text-mono-400 hover:text-mono-200"
            }`}
          >
            <Terminal className="w-3 h-3" />
            {history.length}
          </button>

          {active && (
            <button
              type="button"
              onClick={closeSession}
              title="Close browser session"
              className="p-1 rounded text-mono-400 hover:text-red-400 border border-mono-800 hover:bg-mono-800 transition"
            >
              <Power className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1 rounded text-mono-400 hover:text-mono-200 border border-mono-800 hover:bg-mono-800 transition"
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col bg-mono-950 relative overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1 bg-mono-900/60 border-b border-mono-800/60 text-[11px] text-mono-400">
            <div className="flex items-center gap-2 truncate">
              <span className="font-semibold text-mono-300 truncate max-w-[260px]">{title}</span>
              <span className="text-mono-600">|</span>
              <span className="text-mono-400 truncate">{lastAction}</span>
            </div>
            <div className="flex items-center gap-1.5 text-mono-400 shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
              <span>{takeover ? "Click & type inside viewport to control browser" : "Autonomous Playwright stream"}</span>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-3 bg-mono-950 overflow-auto">
            {installing ? (
              <div className="flex flex-col items-center justify-center p-8 text-center border border-mono-800 rounded-lg max-w-md bg-mono-900/40">
                <Download className="w-10 h-10 text-sky-400 mb-3 animate-bounce" />
                <h3 className="font-semibold text-mono-100 text-sm mb-1">Downloading Chromium Runtime</h3>
                <p className="text-xs text-mono-400 font-mono">{installStatus || "Preparing Playwright Chromium..."}</p>
              </div>
            ) : frame ? (
              <div
                ref={viewportRef}
                tabIndex={takeover ? 0 : -1}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onWheel={handleWheel}
                onKeyDown={handleKeyDown}
                onContextMenu={(e) => {
                  if (takeover) e.preventDefault();
                }}
                className={`relative w-full max-w-[1280px] aspect-[16/10] max-h-full rounded-lg shadow-2xl overflow-hidden bg-mono-900 outline-none ${
                  takeover
                    ? "border-2 border-sky-500 cursor-crosshair"
                    : "border border-mono-800 cursor-default"
                }`}
              >
                <img
                  ref={imgRef}
                  src={frame}
                  alt="AI Browser Screencast"
                  className="w-full h-full block pointer-events-none select-none"
                  draggable={false}
                />
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-mono-950/85 border border-mono-700/60 text-[10px] text-mono-300 font-mono pointer-events-none">
                  {takeover ? "INTERACTIVE" : "LIVE STREAM"}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-mono-800 rounded-lg max-w-md">
                <Globe className="w-12 h-12 text-mono-600 mb-3" />
                <h3 className="font-semibold text-mono-200 text-sm mb-1">Autonomous Browser Ready</h3>
                <p className="text-xs text-mono-400 mb-4">
                  Real headless/headed browser viewport streams here with Catcher proxy capture and interactive takeover.
                </p>
                <div className="text-[11px] text-mono-400 mb-4 font-mono">
                  {detected?.found ? `Detected: ${detected.label}` : "No local Chrome/Edge found"}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={launchDefault}
                    className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition"
                  >
                    Launch Browser
                  </button>
                  {!detected?.found && (
                    <button
                      type="button"
                      onClick={installRuntime}
                      className="px-3 py-1.5 rounded border border-mono-700 bg-mono-900 hover:bg-mono-800 text-mono-200 text-xs font-medium inline-flex items-center gap-1.5 transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Chromium
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {showLog && (
          <div className="w-80 border-l border-mono-800 bg-mono-900/90 flex flex-col shrink-0">
            <div className="px-3 py-2 border-b border-mono-800 flex items-center justify-between text-xs font-semibold text-mono-300">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                Session Action Feed
              </span>
              <span className="text-[10px] text-mono-500 font-normal">Realtime</span>
            </div>
            <div className="flex-1 p-2 overflow-y-auto font-mono text-[11px] space-y-1.5">
              {history.length === 0 ? (
                <div className="text-mono-500 text-center py-6 text-[11px]">No browser actions recorded yet.</div>
              ) : (
                history.map((item) => (
                  <div key={item.id} className="p-2 rounded bg-mono-950 border border-mono-800/80 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[10px] text-mono-500">
                      <span className="flex items-center gap-1 text-sky-400">
                        <Clock className="w-2.5 h-2.5" />
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                      {item.target && <span className="text-mono-400 truncate max-w-[120px]">{item.target}</span>}
                    </div>
                    <div className="text-mono-200 font-semibold truncate">{item.action}</div>
                    {item.url && <div className="text-[10px] text-mono-400 truncate">{item.url}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
