import { Play, RotateCw, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useEngine } from "@/stores/engine";
import { useWorkspace } from "@/stores/workspace";

export function EnginePanel() {
  const t = useT();
  const status = useEngine((state) => state.status);
  const starting = useEngine((state) => state.starting);
  const error = useEngine((state) => state.error);
  const consoleLines = useEngine((state) => state.console);
  const autoReload = useEngine((state) => state.autoReload);
  const setAutoReload = useEngine((state) => state.setAutoReload);
  const clearConsole = useEngine((state) => state.clearConsole);
  const start = useEngine((state) => state.start);
  const stop = useEngine((state) => state.stop);
  const loadEntries = useEngine((state) => state.loadEntries);
  const poll = useEngine((state) => state.poll);
  const root = useWorkspace((state) => state.root);

  const frame = useRef<HTMLIFrameElement>(null);

  const [address, setAddress] = useState("");
  const [src, setSrc] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);

  const edited = useRef(false);

  const commit = (raw: string) => {
    const text = raw.trim();
    if (!text) {
      setSrc("");
      setAddressError(null);
      return;
    }
    const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      setAddressError(t("That is not an address."));
      return;
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      setAddressError(t("Only 127.0.0.1 and localhost can be previewed here."));
      return;
    }
    setAddressError(null);
    setAddress(withScheme);
    setSrc(withScheme);
  };

  useEffect(() => {
    if (root) void loadEntries(root);
    void poll();
  }, [root, loadEntries, poll]);

  useEffect(() => {
    if (!status.running || !status.url || edited.current) return;
    setAddress(status.url);
    setSrc(status.url);
    setAddressError(null);
  }, [status.running, status.url]);

  useEffect(() => {
    if (status.running) return;
    setSrc((current) => (current && status.url && current.startsWith(status.url) ? "" : current));
  }, [status.running, status.url]);

  useEffect(() => {
    const off = bridge.onEngineConsole((line) =>
      useEngine.getState().pushConsole(line as { level: string; text: string; at: number }),
    );
    return () => off?.();
  }, []);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
        {status.running ? (
          <button
            type="button"
            title={t("Stop the engine")}
            aria-label={t("Stop the engine")}
            onClick={() => void stop()}
            className="flex size-6 items-center justify-center rounded-md text-fg-dim hover:bg-hover hover:text-fg"
          >
            <Square className="size-3.5" strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            title={t("Start the engine")}
            aria-label={t("Start the engine")}
            disabled={starting || !root}
            onClick={() => {

              edited.current = false;
              void start(root);
            }}
            className="flex size-6 items-center justify-center rounded-md text-fg-dim hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <Play className="size-3.5" strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          title={t("Reload")}
          aria-label={t("Reload")}
          disabled={!src}
          onClick={() => {

            if (frame.current) frame.current.src = src;
          }}
          className="flex size-6 items-center justify-center rounded-md text-fg-dim hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <RotateCw className="size-3.5" strokeWidth={2} />
        </button>

        <input
          value={address}
          onChange={(event) => {
            edited.current = true;
            setAddress(event.target.value);
            setAddressError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(address);
          }}
          placeholder={t("http://127.0.0.1:… — or your own dev server")}
          aria-label={t("Preview address")}
          title={
            addressError ??
            t("Press Enter to load. Only 127.0.0.1 and localhost can be framed.")
          }
          className={cn(
            "min-w-0 flex-1 rounded-sm border bg-panel px-2 py-1 font-mono text-[12px] text-fg outline-none placeholder:text-fg-faint",
            addressError ? "border-status-error" : "border-line",
          )}
        />

        <label className="flex shrink-0 items-center gap-1 text-[11px] text-fg-dim">
          <input
            type="checkbox"
            checked={autoReload}
            onChange={(event) => setAutoReload(event.target.checked)}
          />
          {t("Reload on save")}
        </label>
      </div>

      <div className="min-h-0 flex-1">
        {src ? (
          <iframe
            ref={frame}
            src={src}
            title={t("Live preview")}

            className="size-full border-0 bg-white"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-[12px] italic text-fg-dim">
              {addressError ?? error ?? t("Nothing is running.")}
            </p>
            {!addressError && (
              <p className="text-[11px] text-fg-faint">
                {t(
                  "Start the engine to serve this project, or type the address of a dev server you are already running.",
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {consoleLines.length > 0 && (
        <div className="flex max-h-40 shrink-0 flex-col border-t border-line">
          <div className="flex items-center gap-1 px-2 py-1">
            <span className="text-[11px] uppercase tracking-wide text-fg-faint">{t("Console")}</span>
            <button
              type="button"
              title={t("Clear console")}
              aria-label={t("Clear console")}
              onClick={clearConsole}
              className="ml-auto flex size-5 items-center justify-center rounded-md text-fg-dim hover:bg-hover hover:text-fg"
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-2 font-mono text-[11px]">
            {consoleLines.map((line, index) => (
              <p
                key={index}
                className={cn(
                  line.level === "error"
                    ? "text-status-error"
                    : line.level === "warning"
                      ? "text-status-warn"
                      : "text-fg-dim",
                )}
              >
                {line.text}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
