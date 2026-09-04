import { ArrowUpRight, ChevronDown, ChevronRight, Crosshair, Flag, Globe, Plus, Radar, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import type { ProxyEntry } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCatcher } from "@/stores/catcher";
import { useFindings } from "@/stores/findings";
import { useIntruder } from "@/stores/intruder";
import { useProxy } from "@/stores/proxy";
import { useScanner } from "@/stores/scanner";
import { openInBrowser } from "@/lib/browserActions";

function statusTone(status: number): string {
  if (status >= 500 || status === 0) return "text-status-error";
  if (status >= 400) return "text-amber-400";
  if (status >= 300) return "text-fg-faint";
  return "text-emerald-400";
}

function dissect(entry: ProxyEntry): { host: string; segments: string[] } {
  try {
    const url = new URL(entry.url);
    return { host: url.host, segments: url.pathname.split("/").filter(Boolean) };
  } catch {
    return { host: entry.host || "—", segments: entry.url.split("/").filter(Boolean) };
  }
}

function hostInScope(host: string, scope: string[]): boolean {
  const h = host.replace(/:\d+$/, "").toLowerCase();
  return scope.some((pattern) => {
    const base = pattern.toLowerCase();
    if (base.startsWith("*.")) {
      const b = base.slice(2);
      return h === b || h.endsWith("." + b);
    }
    return h === base;
  });
}

interface TreeNode {

  label: string;

  key: string;
  children: Map<string, TreeNode>;

  entries: ProxyEntry[];

  count: number;
}

function newNode(label: string, key: string): TreeNode {
  return { label, key, children: new Map(), entries: [], count: 0 };
}

function childOf(parent: TreeNode, label: string): TreeNode {
  let child = parent.children.get(label);
  if (!child) {
    child = newNode(label, parent.key + "/" + label);
    parent.children.set(label, child);
  }
  return child;
}

function fillCounts(node: TreeNode): number {
  let total = node.entries.length;
  for (const child of node.children.values()) total += fillCounts(child);
  node.count = total;
  return total;
}

function buildTree(entries: ProxyEntry[]): TreeNode {
  const root = newNode("", "");
  for (const entry of entries) {
    const { host, segments } = dissect(entry);
    let node = childOf(root, host);
    for (const segment of segments) node = childOf(node, segment);
    node.entries.push(entry);
  }
  fillCounts(root);
  return root;
}

const intruderSeed = (entry: ProxyEntry): string =>
  `${entry.method} ${entry.url}\n` +
  entry.reqHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") +
  `\n\n${entry.reqBody}`;

function RequestActions({ entry }: { entry: ProxyEntry }) {
  const t = useT();
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          openInBrowser(entry.url);
        }}
        title={t("Open in browser")}
        aria-label={t("Open in browser")}
        className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        <Globe className="size-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          useCatcher.getState().addRepeater({ method: entry.method, url: entry.url, headers: entry.reqHeaders, body: entry.reqBody });
        }}
        title={t("Send to Repeater")}
        aria-label={t("Send to Repeater")}
        className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        <ArrowUpRight className="size-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          useIntruder.getState().openIntruder(intruderSeed(entry));
        }}
        title={t("Send to Intruder")}
        aria-label={t("Send to Intruder")}
        className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        <Crosshair className="size-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          useScanner.getState().scan(intruderSeed(entry));
          useCatcher.getState().show("scanner");
        }}
        title={t("Active scan")}
        aria-label={t("Active scan")}
        className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        <Radar className="size-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          useFindings.getState().add({
            title: `${entry.method} ${entry.host}`,
            severity: "info",
            location: entry.url,
            detail:
              `Request:\n${entry.method} ${entry.url}\n` +
              entry.reqHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") +
              (entry.reqBody ? `\n\n${entry.reqBody}` : "") +
              `\n\nResponse: ${entry.status}\n` +
              entry.resHeaders.map(([n, v]) => `${n}: ${v}`).join("\n"),
          });
        }}
        title={t("Send to findings")}
        aria-label={t("Send to findings")}
        className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        <Flag className="size-3.5" strokeWidth={2} />
      </button>
    </span>
  );
}

function RequestRow({ entry, depth }: { entry: ProxyEntry; depth: number }) {
  const { host } = dissect(entry);
  const path = (() => {
    try {
      const url = new URL(entry.url);
      return (url.pathname + url.search) || "/";
    } catch {
      return entry.url;
    }
  })();
  return (
    <div
      className="group flex items-center gap-2 border-b border-line/50 py-1 pr-2 hover:bg-hover"
      style={{ paddingLeft: 8 + depth * 12 }}
      title={`${entry.method} ${entry.url}`}
    >
      <span className={cn("w-8 shrink-0 font-mono text-[10px] tabular-nums", statusTone(entry.status))}>
        {entry.status || "—"}
      </span>
      <span className="w-10 shrink-0 font-mono text-[10px] text-fg-dim">{entry.method}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg-faint">{path === "/" ? host : path}</span>
      <RequestActions entry={entry} />
    </div>
  );
}

function TreeRow({
  node,
  depth,
  scope,
  expanded,
  toggle,
}: {
  node: TreeNode;
  depth: number;
  scope: string[];
  expanded: Set<string>;
  toggle: (key: string) => void;
}) {
  const t = useT();
  const isHost = depth === 0;
  const open = expanded.has(node.key);
  const childNodes = [...node.children.values()];
  const hasKids = childNodes.length > 0 || node.entries.length > 0;
  const count = node.count;
  const inScope = isHost && hostInScope(node.label, scope);
  const latest = node.entries.length > 0 ? node.entries[node.entries.length - 1] : null;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 border-b border-line py-1 pr-2 transition-colors duration-100",
          hasKids ? "cursor-pointer hover:bg-hover" : "",
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => hasKids && toggle(node.key)}
      >
        <span className="w-3 shrink-0 text-fg-faint">
          {hasKids ? (
            open ? <ChevronDown className="size-3" strokeWidth={2} /> : <ChevronRight className="size-3" strokeWidth={2} />
          ) : null}
        </span>
        {isHost && (
          inScope ? (
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-400" strokeWidth={1.75} />
          ) : (
            <Globe className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
          )
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px]",
            isHost ? "font-medium text-fg" : "font-mono text-fg-dim",
          )}
        >
          {node.label || "/"}
        </span>
        {latest && (
          <span className={cn("shrink-0 font-mono text-[10px] tabular-nums", statusTone(latest.status))}>
            {latest.status || "—"}
          </span>
        )}
        {isHost && !inScope && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              const host = node.label.replace(/:\d+$/, "").toLowerCase();
              const current = useProxy.getState().scope;
              if (!current.includes(host)) void useProxy.getState().setScope([...current, host]);
            }}
            title={t("Add to scope")}
            aria-label={t("Add to scope")}
            className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <Plus className="size-3" strokeWidth={2} />
          </button>
        )}
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-fg-faint">{count}</span>
      </div>

      {open && (
        <div>
          {childNodes.map((child) => (
            <TreeRow key={child.key} node={child} depth={depth + 1} scope={scope} expanded={expanded} toggle={toggle} />
          ))}
          {node.entries.map((entry) => (
            <RequestRow key={entry.id} entry={entry} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeBar() {
  const t = useT();
  const scope = useProxy((state) => state.scope);
  const [draft, setDraft] = useState("");

  const add = () => {
    const host = draft.trim().toLowerCase();
    if (!host || scope.includes(host)) {
      setDraft("");
      return;
    }
    void useProxy.getState().setScope([...scope, host]);
    setDraft("");
  };

  return (
    <div className="shrink-0 border-b border-line px-2 py-2">
      <p className="pb-1.5 text-[10px] uppercase tracking-wide text-fg-faint">{t("Scope")}</p>
      {scope.length > 0 && (
        <div className="flex flex-wrap gap-1 pb-1.5">
          {scope.map((host) => (
            <span key={host} className="flex items-center gap-1 rounded-sm bg-panel px-1.5 py-0.5 text-[11px] text-fg-dim">
              <span className="font-mono">{host}</span>
              <button
                type="button"
                onClick={() => void useProxy.getState().setScope(scope.filter((h) => h !== host))}
                title={t("Remove from scope")}
                aria-label={t("Remove from scope")}
                className="text-fg-faint hover:text-fg"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 rounded-md border border-line bg-panel px-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={t("example.com or *.example.com")}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-1 text-[12px] text-fg outline-none placeholder:text-fg-faint"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          title={t("Add to scope")}
          aria-label={t("Add to scope")}
          className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-30"
        >
          <Plus className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

export function TargetPanel() {
  const t = useT();
  const entries = useProxy((state) => state.entries);
  const scope = useProxy((state) => state.scope);
  const [scopeOnly, setScopeOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void useProxy.getState().refresh();
  }, []);

  const shown = useMemo(
    () => (scopeOnly ? entries.filter((entry) => hostInScope(dissect(entry).host, scope)) : entries),
    [entries, scope, scopeOnly],
  );
  const tree = useMemo(() => buildTree(shown), [shown]);
  const hosts = useMemo(() => [...tree.children.values()], [tree]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const expandAll = () => {
    const keys = new Set<string>();
    const walk = (node: TreeNode) => {
      if (node.children.size > 0 || node.entries.length > 0) keys.add(node.key);
      for (const child of node.children.values()) walk(child);
    };
    for (const host of hosts) walk(host);
    setExpanded(keys);
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Target")}>
        <span className="flex-1" />
        {hosts.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setScopeOnly((v) => !v)}
              title={scopeOnly ? t("Showing in-scope hosts only") : t("Show in-scope only")}
              aria-label={t("Show in-scope only")}
              aria-pressed={scopeOnly}
              className={cn(
                "rounded-sm p-1 transition-colors duration-100 hover:bg-hover",
                scopeOnly ? "bg-selected text-emerald-400" : "text-fg-faint hover:text-fg",
              )}
            >
              <ShieldCheck className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => (expanded.size > 0 ? setExpanded(new Set()) : expandAll())}
              title={expanded.size > 0 ? t("Collapse all") : t("Expand all")}
              aria-label={expanded.size > 0 ? t("Collapse all") : t("Expand all")}
              className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              {expanded.size > 0 ? <ChevronDown className="size-3.5" strokeWidth={2} /> : <ChevronRight className="size-3.5" strokeWidth={2} />}
            </button>
          </>
        )}
      </PanelHeader>

      <ScopeBar />

      <div className="min-h-0 flex-1 overflow-auto">
        {hosts.length === 0 ? (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-fg-faint">
            {scopeOnly
              ? t("No in-scope traffic yet. Add a host to the scope, or turn off the in-scope filter.")
              : t("The site map fills in as the proxy captures traffic. Start the proxy and browse a target.")}
          </p>
        ) : (
          hosts.map((host) => (
            <TreeRow key={host.key} node={host} depth={0} scope={scope} expanded={expanded} toggle={toggle} />
          ))
        )}
      </div>
    </div>
  );
}
