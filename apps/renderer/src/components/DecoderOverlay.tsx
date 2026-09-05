import { ArrowDown, Braces, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { TRANSFORMS, decodeJwt, type Transform } from "@/lib/codec";
import { useT } from "@/lib/i18n";
import { useDecoder } from "@/stores/decoder";

export function DecoderOverlay() {
  const t = useT();
  const open = useDecoder((state) => state.open);
  const seed = useDecoder((state) => state.seed);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setInput(seed);
      setOutput("");
      setError("");
    }
  }, [open, seed]);

  const jwt = useMemo(() => decodeJwt(input), [input]);

  if (!open) return null;

  const apply = (transform: Transform) => {
    try {
      setOutput(transform.run(input));
      setError("");
    } catch (caught) {
      setOutput("");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={() => useDecoder.getState().close()} />
      <div className="wide-enter-fade fixed left-1/2 top-16 z-50 flex max-h-[80vh] w-[min(680px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <Braces className="size-4 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <span className="flex-1 text-[12px] font-medium text-fg">{t("Decoder")}</span>
          <button
            type="button"
            onClick={() => useDecoder.getState().close()}
            className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
            aria-label={t("Close")}
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t("Paste text, a token, or an encoded value…")}
            spellCheck={false}
            rows={4}
            className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
          />

          <div className="mt-2 flex flex-wrap gap-1">
            {TRANSFORMS.map((transform) => (
              <button
                key={transform.id}
                type="button"
                onClick={() => apply(transform)}
                className="rounded-sm border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
              >
                {t(transform.label)}
              </button>
            ))}
          </div>

          {error && <p className="mt-2 text-[11px] text-status-error">{t(error)}</p>}

          {output && (
            <div className="mt-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Output")}</span>
                <button
                  type="button"
                  onClick={() => {
                    setInput(output);
                    setOutput("");
                  }}
                  title={t("Use as input")}
                  className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
                >
                  <ArrowDown className="size-3" strokeWidth={1.75} />
                  {t("Use as input")}
                </button>
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[12px] text-fg">
                {output}
              </pre>
            </div>
          )}

          {jwt && (
            <div className="mt-3 border-t border-line pt-2">
              <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("JSON Web Token")}</span>
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <p className="mb-0.5 text-[10px] text-fg-faint">{t("Header")}</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-syn-property">
                    {jwt.header}
                  </pre>
                </div>
                <div>
                  <p className="mb-0.5 text-[10px] text-fg-faint">{t("Payload")}</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-syn-string">
                    {jwt.payload}
                  </pre>
                </div>
              </div>
              <p className="mt-1 text-[10px] text-fg-faint">
                {t("The signature is not verified — this only reads the token.")}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
