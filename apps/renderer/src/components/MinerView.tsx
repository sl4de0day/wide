import { useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import { isJavascriptEntry, mineJs, type MinerDependency, type MinerSecret } from "@/lib/jsMiner";
import { cn, copyText } from "@/lib/utils";
import { useProxy } from "@/stores/proxy";

interface Aggregate {
  files: number;
  endpoints: string[];
  secrets: (MinerSecret & { source: string })[];
  dependencies: (MinerDependency & { source: string })[];
}

const MAX_BODY = 4 * 1024 * 1024;

function mineAll(entries: ReturnType<typeof useProxy.getState>["entries"]): Aggregate {
  const endpoints = new Set<string>();
  const secrets: (MinerSecret & { source: string })[] = [];
  const dependencies: (MinerDependency & { source: string })[] = [];
  const depSeen = new Set<string>();
  let files = 0;
  for (const entry of entries) {
    if (!entry.resBody || entry.resBody.length > MAX_BODY) continue;
    if (!isJavascriptEntry(entry.url, entry.resHeaders)) continue;
    files += 1;
    const result = mineJs(entry.resBody);
    for (const endpoint of result.endpoints) endpoints.add(endpoint);
    for (const secret of result.secrets) secrets.push({ ...secret, source: entry.url });
    for (const dep of result.dependencies) {
      const key = `${dep.name}:${dep.version}`;
      if (depSeen.has(key)) continue;
      depSeen.add(key);
      dependencies.push({ ...dep, source: entry.url });
    }
  }
  return { files, endpoints: [...endpoints].sort(), secrets, dependencies };
}

type Section = "endpoints" | "secrets" | "dependencies";

export function MinerView() {
  const t = useT();
  const entries = useProxy((state) => state.entries);
  const [section, setSection] = useState<Section>("secrets");
  const result = useMemo(() => mineAll(entries), [entries]);

  const tabs: { id: Section; label: string; count: number }[] = [
    { id: "secrets", label: t("Secrets"), count: result.secrets.length },
    { id: "endpoints", label: t("Endpoints"), count: result.endpoints.length },
    { id: "dependencies", label: t("Dependencies"), count: result.dependencies.length },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSection(tab.id)}
              className={cn(
                "rounded-sm px-2 py-0.5 text-[12px] transition-colors duration-100",
                section === tab.id ? "bg-selected text-fg-bright" : "text-fg-dim hover:bg-hover hover:text-fg",
              )}
            >
              {tab.label}
              <span className="ml-1.5 text-fg-faint">{tab.count}</span>
            </button>
          ))}
        </div>
        <span className="text-[11px] text-fg-faint">{t("{count} JavaScript files scanned", { count: result.files })}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {result.files === 0 ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">
            {t("No JavaScript captured yet. Turn on the Catcher proxy and browse a target.")}
          </p>
        ) : section === "secrets" ? (
          result.secrets.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-fg-faint">{t("No secrets found.")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {result.secrets.map((secret, index) => (
                <li key={index} className="px-3 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-medium text-status-error">{secret.kind}</span>
                    <button
                      type="button"
                      onClick={() => void copyText(secret.value)}
                      className="shrink-0 text-[10px] text-fg-faint hover:text-fg"
                    >
                      {t("Copy")}
                    </button>
                  </div>
                  <code className="block truncate font-mono text-[11px] text-fg" title={secret.value}>{secret.value}</code>
                  <span className="block truncate text-[10px] text-fg-faint" title={secret.source}>{secret.source}</span>
                </li>
              ))}
            </ul>
          )
        ) : section === "endpoints" ? (
          result.endpoints.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-fg-faint">{t("No endpoints found.")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {result.endpoints.map((endpoint) => (
                <li key={endpoint} className="flex items-center justify-between gap-2 px-3 py-1">
                  <code className="min-w-0 truncate font-mono text-[11px] text-fg" title={endpoint}>{endpoint}</code>
                  <button
                    type="button"
                    onClick={() => void copyText(endpoint)}
                    className="shrink-0 text-[10px] text-fg-faint hover:text-fg"
                  >
                    {t("Copy")}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : result.dependencies.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">{t("No dependencies found.")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {result.dependencies.map((dep, index) => (
              <li key={index} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                <span className="text-[12px] text-fg">{dep.name}</span>
                {dep.version && <span className="font-mono text-[11px] text-fg-dim">{dep.version}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
