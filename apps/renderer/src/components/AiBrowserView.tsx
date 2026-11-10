import { useEffect, useRef, useState } from "react";
import { Activity, Clock, Globe, Lock, ShieldCheck, Terminal, Maximize2, Minimize2 } from "lucide-react";
import { useAiBrowser } from "@/stores/aiBrowser";

export function AiBrowserView() {
  const url = useAiBrowser((s) => s.url);
  const title = useAiBrowser((s) => s.title);
  const lastAction = useAiBrowser((s) => s.lastAction);
  const frame = useAiBrowser((s) => s.frame);
  const history = useAiBrowser((s) => s.history);
  const status = useAiBrowser((s) => s.status);

  const [showLog, setShowLog] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history.length]);

  return (
    <div className={`flex flex-col h-full w-full bg-mono-950 text-mono-200 select-none ${fullscreen ? "fixed inset-0 z-50" : ""}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-mono-800 bg-mono-900 text-xs">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-400" />
          <span className="font-semibold text-mono-100">AI Browser Stream</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Lock className="w-3 h-3" />
            READ ONLY
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {status.toUpperCase()}
          </span>
        </div>

        <div className="flex-1 max-w-xl mx-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-mono-950 border border-mono-800 rounded text-mono-300 font-mono text-[11px] truncate">
            <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
            <span className="truncate">{url || "about:blank"}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLog(!showLog)}
            className={`px-2 py-1 rounded text-[11px] border border-mono-800 flex items-center gap-1 transition ${showLog ? "bg-mono-800 text-mono-100" : "bg-mono-950 text-mono-400 hover:text-mono-200"}`}
          >
            <Terminal className="w-3 h-3" />
            Activity Log ({history.length})
          </button>
          <button
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
              <span className="font-semibold text-mono-300 truncate">{title}</span>
              <span className="text-mono-500">|</span>
              <span className="text-mono-400 truncate">Last Action: {lastAction}</span>
            </div>
            <div className="flex items-center gap-1.5 text-mono-400 shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
              <span>User input disabled to prevent session collision</span>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-4 bg-mono-950 overflow-auto">
            {frame ? (
              <div className="relative border border-mono-800 rounded-lg shadow-2xl overflow-hidden max-w-full max-h-full bg-mono-900">
                <img
                  src={frame}
                  alt="AI Browser Screencast"
                  className="w-full h-auto object-contain pointer-events-none select-none max-h-[calc(100vh-140px)]"
                  draggable={false}
                />
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-mono-950/80 border border-mono-700/60 text-[10px] text-mono-300 font-mono pointer-events-none">
                  LIVE STREAM
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-mono-800 rounded-lg max-w-md">
                <Globe className="w-12 h-12 text-mono-600 mb-3 animate-pulse" />
                <h3 className="font-semibold text-mono-200 text-sm mb-1">Autonomous Browser Ready</h3>
                <p className="text-xs text-mono-400 mb-4">
                  The AI agent will stream its browser viewport live into this tab as it navigates web pages and interacts with elements.
                </p>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-mono-900 border border-mono-800 text-[11px] text-mono-400">
                  <Lock className="w-3 h-3 text-amber-400" />
                  <span>Interaction is autonomous and strictly read-only</span>
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
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
