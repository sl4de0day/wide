import { useEffect, useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import { analyze, signalsFromResponse, type Detection, type WappalyzerRuleset } from "@/lib/wappalyzer";
import { loadWappalyzerRuleset } from "@/lib/wappalyzerRuleset";
import { useFindings } from "@/stores/findings";
import { useProxy } from "@/stores/proxy";
import { toast } from "@/stores/toast";

const MAX_BODY = 2 * 1024 * 1024;

const detectionCache = new Map<number, Detection[]>();

function isHtml(headers: [string, string][]): boolean {
  const type = headers.find(([k]) => k.toLowerCase() === "content-type")?.[1]?.toLowerCase() ?? "";
  return type.includes("text/html") || type.includes("application/xhtml");
}

function detectByHost(
  entries: ReturnType<typeof useProxy.getState>["entries"],
  ruleset: WappalyzerRuleset,
): { host: string; detections: Detection[] }[] {
  const latest = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    if (!entry.host || !entry.resBody || entry.resBody.length > MAX_BODY) continue;
    if (!isHtml(entry.resHeaders)) continue;
    const current = latest.get(entry.host);
    if (!current || entry.at > current.at) latest.set(entry.host, entry);
  }
  if (detectionCache.size > 500) detectionCache.clear();
  const out: { host: string; detections: Detection[] }[] = [];
  for (const [host, entry] of latest) {
    let detections = detectionCache.get(entry.id);
    if (!detections) {
      const input = signalsFromResponse(entry.url, entry.resHeaders, entry.resBody);
      detections = analyze(input, ruleset);
      detectionCache.set(entry.id, detections);
    }
    if (detections.length) out.push({ host, detections });
  }
  out.sort((a, b) => a.host.localeCompare(b.host));
  return out;
}

export function TechnologiesView() {
  const t = useT();
  const entries = useProxy((state) => state.entries);
  const [ruleset, setRuleset] = useState<WappalyzerRuleset | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void loadWappalyzerRuleset().then((loaded) => {
      if (!alive) return;
      if (loaded) setRuleset(loaded);
      else setError(t("The Wappalyzer ruleset is not ready yet."));
    });
    return () => {
      alive = false;
    };
  }, [t]);

  const groups = useMemo(() => (ruleset ? detectByHost(entries, ruleset) : []), [entries, ruleset]);

  const sendToFindings = () => {
    let added = 0;
    for (const group of groups) {
      for (const tech of group.detections) {
        const title = tech.version ? `${tech.name} ${tech.version}` : tech.name;
        const exists = useFindings.getState().findings.some((f) => f.title === title && f.location === group.host);
        if (exists) continue;
        useFindings.getState().add({ title, severity: "info", location: group.host, detail: tech.categories.join(", ") });
        added += 1;
      }
    }
    toast.success(t("Added {count} findings", { count: added }));
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-dim">{t("Technologies")}</span>
        <div className="flex items-center gap-2">
          {groups.length > 0 && (
            <button
              type="button"
              onClick={sendToFindings}
              className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              {t("Send all to Findings")}
            </button>
          )}
          <span className="text-[11px] text-fg-faint">{t("{count} hosts", { count: groups.length })}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="px-3 py-3 text-[12px] text-fg-dim">{error}</p>
        ) : groups.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">
            {t("No pages captured yet. Turn on the Catcher proxy and browse a target.")}
          </p>
        ) : (
          <ul>
            {groups.map((group) => (
              <li key={group.host} className="border-b border-line">
                <div className="bg-chrome px-3 py-1 text-[11px] font-medium text-fg-dim">{group.host}</div>
                <ul className="divide-y divide-line">
                  {group.detections.map((tech) => (
                    <li key={tech.name} className="flex items-baseline justify-between gap-3 px-3 py-1">
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
