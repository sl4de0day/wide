import { useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import {
  absoluteEndpoint,
  inlineSourceMap,
  isJavascriptEntry,
  mineJs,
  parseSourceMap,
  severityForSecret,
  sourceMapRef,
  type MinerDependency,
  type MinerSecret,
  type RecoveredSource,
} from "@/lib/jsMiner";
import { cn, copyText } from "@/lib/utils";
import { useCatcher } from "@/stores/catcher";
import { useFindings } from "@/stores/findings";
import { useProxy } from "@/stores/proxy";
import { toast } from "@/stores/toast";

interface Aggregate {
  files: number;
  endpoints: { url: string; source: string }[];
  secrets: (MinerSecret & { source: string })[];
  dependencies: (MinerDependency & { source: string })[];
}

const MAX_BODY = 4 * 1024 * 1024;

const mineCache = new Map<number, ReturnType<typeof mineJs>>();

function mineAll(entries: ReturnType<typeof useProxy.getState>["entries"]): Aggregate {
  const endpoints = new Map<string, string>();
  const secrets: (MinerSecret & { source: string })[] = [];
  const dependencies: (MinerDependency & { source: string })[] = [];
  const depSeen = new Set<string>();
  let files = 0;
  if (mineCache.size > 1000) mineCache.clear();
  for (const entry of entries) {
    if (!entry.resBody || entry.resBody.length > MAX_BODY) continue;
    if (!isJavascriptEntry(entry.url, entry.resHeaders)) continue;
    files += 1;
    let result = mineCache.get(entry.id);
    if (!result) {
      result = mineJs(entry.resBody);
      mineCache.set(entry.id, result);
    }
    for (const endpoint of result.endpoints) if (!endpoints.has(endpoint)) endpoints.set(endpoint, entry.url);
    for (const secret of result.secrets) secrets.push({ ...secret, source: entry.url });
    for (const dep of result.dependencies) {
      const key = `${dep.name}:${dep.version}`;
      if (depSeen.has(key)) continue;
      depSeen.add(key);
      dependencies.push({ ...dep, source: entry.url });
    }
  }
  return {
    files,
    endpoints: [...endpoints.entries()].map(([url, source]) => ({ url, source })).sort((a, b) => a.url.localeCompare(b.url)),
    secrets,
    dependencies,
  };
}

const sourceCache = new Map<number, RecoveredSource[]>();

function recoverAll(entries: ReturnType<typeof useProxy.getState>["entries"]): RecoveredSource[] {
  const byUrl = new Map<string, string>();
  for (const entry of entries) if (entry.resBody) byUrl.set(entry.url, entry.resBody);
  if (sourceCache.size > 500) sourceCache.clear();
  const out: RecoveredSource[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.resBody || !isJavascriptEntry(entry.url, entry.resHeaders)) continue;
    let recovered = sourceCache.get(entry.id);
    if (!recovered) {
      const ref = sourceMapRef(entry.resBody);
      let json = "";
      let pending = false;
      if (ref.startsWith("data:")) json = inlineSourceMap(ref);
      else if (ref) {
        try {
          json = byUrl.get(new URL(ref, entry.url).toString()) ?? "";
        } catch {
          json = "";
        }
        pending = !json;
      }
      recovered = json ? parseSourceMap(json) : [];
      if (!pending) sourceCache.set(entry.id, recovered);
    }
    for (const source of recovered) {
      if (seen.has(source.path)) continue;
      seen.add(source.path);
      out.push(source);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

type Section = "secrets" | "endpoints" | "dependencies" | "sources";

function secretFinding(secret: MinerSecret & { source: string }): { title: string; location: string; detail: string } {
  return {
    title: `${secret.kind} in JavaScript`,
    location: `${secret.source}:${secret.line}`,
    detail: `${secret.kind}\n${secret.value}\n${secret.source}:${secret.line}`,
  };
}

export function MinerView() {
  const t = useT();
  const entries = useProxy((state) => state.entries);
  const [section, setSection] = useState<Section>("secrets");
  const [openSource, setOpenSource] = useState<RecoveredSource | null>(null);
  const result = useMemo(() => mineAll(entries), [entries]);
  const sources = useMemo(() => recoverAll(entries), [entries]);

  const addSecret = (secret: MinerSecret & { source: string }) => {
    const finding = secretFinding(secret);
    const exists = useFindings
      .getState()
      .findings.some((f) => f.title === finding.title && f.location === finding.location);
    if (exists) return false;
    useFindings.getState().add({ ...finding, severity: severityForSecret(secret.kind) });
    return true;
  };

  const addAllSecrets = () => {
    let added = 0;
    for (const secret of result.secrets) if (addSecret(secret)) added += 1;
    toast.success(t("Added {count} findings", { count: added }));
  };

  const sendEndpoint = (endpoint: { url: string; source: string }) => {
    useCatcher.getState().addRepeater({ method: "GET", url: absoluteEndpoint(endpoint.url, endpoint.source), headers: [], body: "" });
    toast.info(t("Sent to Repeater"));
  };

  const tabs: { id: Section; label: string; count: number }[] = [
    { id: "secrets", label: t("Secrets"), count: result.secrets.length },
    { id: "endpoints", label: t("Endpoints"), count: result.endpoints.length },
    { id: "dependencies", label: t("Dependencies"), count: result.dependencies.length },
    { id: "sources", label: t("Sources"), count: sources.length },
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
        <div className="flex items-center gap-2">
          {section === "secrets" && result.secrets.length > 0 && (
            <button
              type="button"
              onClick={addAllSecrets}
              className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              {t("Send all to Findings")}
            </button>
          )}
          <span className="text-[11px] text-fg-faint">{t("{count} JavaScript files scanned", { count: result.files })}</span>
        </div>
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
                <li key={index} className="group px-3 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-medium text-status-error">{secret.kind}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[10px]">
                      <button type="button" onClick={() => addSecret(secret) && toast.success(t("Added {count} findings", { count: 1 }))} className="text-fg-faint hover:text-fg">
                        {t("Add to Findings")}
                      </button>
                      <button type="button" onClick={() => void copyText(secret.value)} className="text-fg-faint hover:text-fg">
                        {t("Copy")}
                      </button>
                    </span>
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
                <li key={endpoint.url} className="flex items-center justify-between gap-2 px-3 py-1">
                  <code className="min-w-0 truncate font-mono text-[11px] text-fg" title={endpoint.url}>{endpoint.url}</code>
                  <span className="flex shrink-0 items-center gap-2 text-[10px]">
                    <button type="button" onClick={() => sendEndpoint(endpoint)} className="text-fg-faint hover:text-fg">
                      {t("Send to Repeater")}
                    </button>
                    <button type="button" onClick={() => void copyText(endpoint.url)} className="text-fg-faint hover:text-fg">
                      {t("Copy")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : section === "dependencies" ? (
          result.dependencies.length === 0 ? (
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
          )
        ) : sources.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">{t("No source maps found.")}</p>
        ) : openSource ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1">
              <button type="button" onClick={() => setOpenSource(null)} className="text-[11px] text-fg-dim hover:text-fg">
                ‹ {t("Back")}
              </button>
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-faint" title={openSource.path}>{openSource.path}</code>
              <button type="button" onClick={() => void copyText(openSource.content)} className="text-[10px] text-fg-faint hover:text-fg">
                {t("Copy")}
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre px-3 py-2 font-mono text-[11px] text-fg">{openSource.content}</pre>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {sources.map((source, index) => (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => setOpenSource(source)}
                  className="block w-full truncate px-3 py-1 text-left font-mono text-[11px] text-fg transition-colors duration-100 hover:bg-hover"
                  title={source.path}
                >
                  {source.path}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
