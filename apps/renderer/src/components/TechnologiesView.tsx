import { useEffect, useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import { analyze, signalsFromResponse, type Detection, type WappalyzerRuleset } from "@/lib/wappalyzer";
import { loadWappalyzerRuleset } from "@/lib/wappalyzerRuleset";
import { useProxy } from "@/stores/proxy";

const MAX_BODY = 2 * 1024 * 1024;

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
  const out: { host: string; detections: Detection[] }[] = [];
  for (const [host, entry] of latest) {
    const input = signalsFromResponse(entry.url, entry.resHeaders, entry.resBody);
    const detections = analyze(input, ruleset);
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-dim">{t("Technologies")}</span>
        <span className="text-[11px] text-fg-faint">{t("{count} hosts", { count: groups.length })}</span>
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
