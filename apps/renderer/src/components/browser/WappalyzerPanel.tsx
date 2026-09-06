import { LoaderCircle, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { analyze, PAGE_SIGNAL_SCRIPT, type Detection, type DetectionInput } from "@/lib/wappalyzer";
import { loadWappalyzerRuleset } from "@/lib/wappalyzerRuleset";
import { useFindings } from "@/stores/findings";
import { useProxy } from "@/stores/proxy";
import { toast } from "@/stores/toast";

interface PageSignals {
  html: string;
  scriptSrc: string[];
  metas: Record<string, string>;
  cookies: Record<string, string>;
  js: Record<string, string>;
}

export function WappalyzerPanel({ tabId, url }: { tabId: string; url: string }) {
  const t = useT();
  const [detections, setDetections] = useState<Detection[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState(false);

  const scan = useCallback(async () => {
    if (!tabId || !url) {
      setError(t("Open a page in the browser first."));
      return;
    }
    setBusy(true);
    setError("");
    const ruleset = await loadWappalyzerRuleset();
    if (!ruleset) {
      setBusy(false);
      setError(t("The Wappalyzer ruleset is not ready yet."));
      return;
    }
    const reply = await bridge.browserCdp(tabId, "Runtime.evaluate", {
      expression: PAGE_SIGNAL_SCRIPT,
      returnByValue: true,
    });
    const signals = (reply.result as { result?: { value?: PageSignals } } | undefined)?.result?.value;
    if (!reply.ok || !signals) {
      setBusy(false);
      setError(t("The page could not be read."));
      return;
    }
    const entries = useProxy.getState().entries;
    let headers: [string, string][] = [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].url === url && entries[i].resHeaders.length) {
        headers = entries[i].resHeaders;
        break;
      }
    }
    const input: DetectionInput = {
      url,
      headers,
      cookies: signals.cookies ?? {},
      html: signals.html ?? "",
      scriptSrc: signals.scriptSrc ?? [],
      metas: signals.metas ?? {},
      js: signals.js ?? {},
    };
    setDetections(analyze(input, ruleset));
    setScanned(true);
    setBusy(false);
  }, [tabId, url, t]);

  useEffect(() => {
    void scan();
  }, [scan]);

  const sendToFindings = () => {
    let added = 0;
    for (const tech of detections) {
      const title = tech.version ? `${tech.name} ${tech.version}` : tech.name;
      const exists = useFindings.getState().findings.some((f) => f.title === title && f.location === url);
      if (exists) continue;
      useFindings.getState().add({ title, severity: "info", location: url, detail: tech.categories.join(", ") });
      added += 1;
    }
    toast.success(t("Added {count} findings", { count: added }));
  };

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-dim">
          {t("Technologies")}
          {detections.length > 0 && <span className="ml-1.5 text-fg-faint">{detections.length}</span>}
        </span>
        <div className="flex items-center gap-2">
          {detections.length > 0 && (
            <button
              type="button"
              onClick={sendToFindings}
              className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              {t("Send all to Findings")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void scan()}
            disabled={busy}
            title={t("Rescan")}
            aria-label={t("Rescan")}
            className="rounded-sm p-1 text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-50"
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} /> : <RotateCw className="size-3.5" strokeWidth={1.75} />}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="px-3 py-3 text-[12px] text-fg-dim">{error}</p>
        ) : detections.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">
            {scanned && !busy ? t("No technologies detected.") : t("Scanning…")}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {detections.map((tech) => (
              <li key={tech.name} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0">
                  <span className="text-[12px] text-fg">{tech.name}</span>
                  {tech.version && <span className="ml-1.5 font-mono text-[11px] text-fg-dim">{tech.version}</span>}
                  {tech.categories.length > 0 && (
                    <span className="block truncate text-[11px] text-fg-faint">{tech.categories.join(", ")}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-fg-faint">{tech.confidence}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
