import { ArrowUpRight, ChevronDown, ChevronRight, Copy, Crosshair, FileJson, Flag, Globe, MoreHorizontal, Plus, Radar, Search, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import type { ProxyEntry } from "@/lib/bridge";
import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { hostInScope } from "@/lib/scope";
import { cn, copyText } from "@/lib/utils";
import { useCatcher } from "@/stores/catcher";
import { useFindings } from "@/stores/findings";
import { useIntruder } from "@/stores/intruder";
import { useProxy } from "@/stores/proxy";
import { useScanner } from "@/stores/scanner";
import { toast } from "@/stores/toast";
import { useWorkspace } from "@/stores/workspace";
import { openInBrowser } from "@/lib/browserActions";

function statusTone(status: number): string {
  if (status >= 500 || status === 0) return "text-status-error";
  if (status >= 400) return "text-amber-400";
  if (status >= 300) return "text-fg-faint";
  return "text-emerald-400";
}

function methodBadgeColor(method: string): string {
  const m = (method || "").toUpperCase();
  if (m === "GET") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  if (m === "POST") return "border-accent/40 bg-accent/10 text-accent";
  if (m === "PUT") return "border-amber-500/40 bg-amber-500/10 text-amber-400";
  if (m === "DELETE") return "border-rose-500/40 bg-rose-500/10 text-rose-400";
  if (m === "PATCH") return "border-purple-500/40 bg-purple-500/10 text-purple-400";
  if (m === "WS") return "border-teal-500/40 bg-teal-500/10 text-teal-400";
  return "border-line bg-panel text-fg-dim";
}

function isSensitivePath(path: string): boolean {
  return /(auth|login|signin|admin|account|token|session|secret|passwd|password|oauth|graphql|v1|v2|api)/i.test(path);
}

function dissect(entry: ProxyEntry): { host: string; segments: string[]; pathname: string } {
  try {
    const url = new URL(entry.url);
    return { host: url.host, segments: url.pathname.split("/").filter(Boolean), pathname: url.pathname };
  } catch {
    const parts = entry.url.split("/").filter(Boolean);
    return { host: entry.host || "—", segments: parts, pathname: entry.url };
  }
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
            pocRequest:
              `${entry.method} ${entry.url} HTTP/1.1\n` +
              entry.reqHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") +
              (entry.reqBody ? `\n\n${entry.reqBody}` : ""),
            pocResponse:
              `HTTP/1.1 ${entry.status}\n` +
              entry.resHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") +
              (entry.resBody ? `\n\n${entry.resBody}` : ""),
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

function RequestRow({
  entry,
  depth,
  selected,
  onSelect,
}: {
  entry: ProxyEntry;
  depth: number;
  selected: boolean;
  onSelect: (entry: ProxyEntry) => void;
}) {
  const { host } = dissect(entry);
  const path = (() => {
    try {
      const url = new URL(entry.url);
      return (url.pathname + url.search) || "/";
    } catch {
      return entry.url;
    }
  })();
  const issues = useProxy((state) => state.issueCounts[entry.id]);

  return (
    <div
      onClick={() => onSelect(entry)}
      className={cn(
        "group flex cursor-pointer items-center gap-2 border-b border-line/50 py-1 pr-2 transition-colors duration-100",
        selected ? "bg-selected" : "hover:bg-hover",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
      title={`${entry.method} ${entry.url}`}
    >
      <span className={cn("w-8 shrink-0 font-mono text-[10px] tabular-nums", statusTone(entry.status))}>
        {entry.status || "—"}
      </span>
      <span className={cn("rounded-sm border px-1 py-0.2 font-mono text-[9px] font-semibold", methodBadgeColor(entry.method))}>
        {entry.method}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg-faint">
        {path === "/" ? host : path}
      </span>
      {issues ? (
        <span className="shrink-0 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 py-0.2 font-mono text-[9px] font-semibold text-amber-400">
          {issues}
        </span>
      ) : null}
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
  selectedEntry,
  onSelectEntry,
}: {
  node: TreeNode;
  depth: number;
  scope: string[];
  expanded: Set<string>;
  toggle: (key: string) => void;
  selectedEntry: ProxyEntry | null;
  onSelectEntry: (entry: ProxyEntry) => void;
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
            <TreeRow
              key={child.key}
              node={child}
              depth={depth + 1}
              scope={scope}
              expanded={expanded}
              toggle={toggle}
              selectedEntry={selectedEntry}
              onSelectEntry={onSelectEntry}
            />
          ))}
          {node.entries.map((entry) => (
            <RequestRow
              key={entry.id}
              entry={entry}
              depth={depth + 1}
              selected={selectedEntry?.id === entry.id}
              onSelect={onSelectEntry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EndpointInspector({
  entry,
  onClose,
}: {
  entry: ProxyEntry;
  onClose: () => void;
}) {
  const t = useT();
  const params = useMemo(() => {
    const list: { name: string; value: string; source: "query" | "body" }[] = [];
    try {
      const url = new URL(entry.url);
      url.searchParams.forEach((val, key) => list.push({ name: key, value: val, source: "query" }));
    } catch {
      void 0;
    }
    if (entry.reqBody) {
      try {
        const parsed = JSON.parse(entry.reqBody);
        if (typeof parsed === "object" && parsed !== null) {
          for (const [k, v] of Object.entries(parsed)) {
            list.push({ name: k, value: typeof v === "object" ? JSON.stringify(v) : String(v), source: "body" });
          }
        }
      } catch {
        const formParams = new URLSearchParams(entry.reqBody);
        formParams.forEach((val, key) => list.push({ name: key, value: val, source: "body" }));
      }
    }
    return list;
  }, [entry]);

  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-line bg-canvas">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold", methodBadgeColor(entry.method))}>
            {entry.method}
          </span>
          <span className="truncate font-mono text-[11px] text-fg" title={entry.url}>
            {entry.url}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <RequestActions entry={entry} />
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-fg-faint hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-auto p-3 text-[11px]">
        <div className="w-1/2 border-r border-line pr-3">
          <p className="pb-1 text-[10px] uppercase tracking-wide text-fg-faint">{t("Parameters Discovered")} ({params.length})</p>
          {params.length === 0 ? (
            <p className="text-[10px] text-fg-faint">{t("No query or body parameters detected.")}</p>
          ) : (
            <div className="flex max-h-40 flex-col gap-1 overflow-auto">
              {params.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2 rounded-sm border border-line bg-panel px-2 py-0.5">
                  <span className="rounded-sm bg-canvas px-1 font-mono text-[9px] uppercase text-fg-faint">{p.source}</span>
                  <span className="font-mono text-[10px] font-semibold text-accent">{p.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg-dim">{p.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="w-1/2 pl-3">
          <p className="pb-1 text-[10px] uppercase tracking-wide text-fg-faint">{t("Headers & Status")}</p>
          <div className="flex items-center gap-2 pb-1.5 font-mono text-[10px]">
            <span className="text-fg-faint">Status:</span>
            <span className={statusTone(entry.status)}>{entry.status || "—"}</span>
            <span className="text-fg-faint ml-2">Host:</span>
            <span className="text-fg-dim">{entry.host}</span>
          </div>
          <div className="max-h-36 overflow-auto rounded-sm border border-line bg-panel p-1.5 font-mono text-[10px]">
            {entry.reqHeaders.map(([k, v], idx) => (
              <div key={idx} className="truncate">
                <span className="text-syn-property">{k}:</span> <span className="text-fg-dim">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
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
          placeholder={t("example.com (subdomains included)")}
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
  const [filterMode, setFilterMode] = useState<"all" | "scope" | "api" | "sensitive">("all");
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedEntry, setSelectedEntry] = useState<ProxyEntry | null>(null);

  useEffect(() => {
    void useProxy.getState().refresh();
  }, []);

  const stats = useMemo(() => {
    const hosts = new Set<string>();
    const uniqueUrls = new Set<string>();
    let sensitiveCount = 0;
    const params = new Set<string>();

    for (const entry of entries) {
      const { host, pathname } = dissect(entry);
      if (host) hosts.add(host);
      uniqueUrls.add(entry.url);
      if (isSensitivePath(pathname)) sensitiveCount += 1;
      try {
        const u = new URL(entry.url);
        u.searchParams.forEach((_, k) => params.add(k));
      } catch {
        void 0;
      }
    }
    return {
      totalHosts: hosts.size,
      totalEndpoints: uniqueUrls.size,
      sensitiveCount,
      totalParams: params.size,
    };
  }, [entries]);

  const shown = useMemo(() => {
    return entries.filter((entry) => {
      const { host, pathname } = dissect(entry);
      if (filterMode === "scope" && !hostInScope(host, scope)) return false;
      if (filterMode === "api" && !pathname.includes("/api")) return false;
      if (filterMode === "sensitive" && !isSensitivePath(pathname)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!entry.url.toLowerCase().includes(q) && !(entry.method || "").toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [entries, filterMode, search, scope]);

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

  const copyUrlList = async () => {
    const urls = Array.from(new Set(shown.map((e) => e.url))).join("\n");
    if (await copyText(urls)) {
      toast.success(t("Copied {count} endpoint URLs.", { count: urls.split("\n").filter(Boolean).length }));
    }
  };

  const exportOpenApi = async () => {
    const pathsObj: Record<string, Record<string, unknown>> = {};
    for (const entry of shown) {
      try {
        const u = new URL(entry.url);
        const path = u.pathname || "/";
        const method = (entry.method || "get").toLowerCase();
        if (!pathsObj[path]) pathsObj[path] = {};
        const queryParams: { name: string; in: string; schema: { type: string } }[] = [];
        u.searchParams.forEach((_, key) => {
          queryParams.push({ name: key, in: "query", schema: { type: "string" } });
        });
        pathsObj[path][method] = {
          summary: `${entry.method} ${path}`,
          parameters: queryParams,
          responses: {
            [String(entry.status || 200)]: { description: `Status ${entry.status || 200} response` },
          },
        };
      } catch {
        void 0;
      }
    }
    const spec = {
      openapi: "3.0.3",
      info: { title: "Discovered Attack Surface API", version: "1.0.0" },
      paths: pathsObj,
    };
    const jsonStr = JSON.stringify(spec, null, 2);
    const root = useWorkspace.getState().root;
    if (root) {
      await bridge.writeFile(`${root}/wide-openapi-spec.json`, jsonStr);
      toast.success(t("Exported OpenAPI specification to wide-openapi-spec.json."));
    } else {
      await copyText(jsonStr);
      toast.success(t("Copied OpenAPI specification to clipboard."));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Target")}>
        <div className="flex items-center gap-1">
          {hosts.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => (expanded.size > 0 ? setExpanded(new Set()) : expandAll())}
                title={expanded.size > 0 ? t("Collapse all") : t("Expand all")}
                aria-label={expanded.size > 0 ? t("Collapse all") : t("Expand all")}
                className="rounded-md p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
              >
                {expanded.size > 0 ? <ChevronDown className="size-3.5" strokeWidth={2} /> : <ChevronRight className="size-3.5" strokeWidth={2} />}
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  title={t("More actions")}
                  aria-label={t("More actions")}
                  aria-expanded={menuOpen}
                  className={cn(
                    "rounded-md p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg",
                    menuOpen && "bg-hover text-fg",
                  )}
                >
                  <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-[400]" onClick={() => setMenuOpen(false)} />
                    <div className="wide-pop-up absolute right-0 top-full z-[401] mt-1 w-52 overflow-hidden rounded-md border border-line bg-panel p-1 shadow-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          void copyUrlList();
                        }}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11px] text-fg transition-colors hover:bg-hover"
                      >
                        <Copy className="size-3.5 text-fg-faint" strokeWidth={1.75} />
                        <span>{t("Copy discovered URLs")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          void exportOpenApi();
                        }}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11px] text-fg transition-colors hover:bg-hover"
                      >
                        <FileJson className="size-3.5 text-fg-faint" strokeWidth={1.75} />
                        <span>{t("Export OpenAPI 3.0 skeleton")}</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </PanelHeader>

      <div className="flex shrink-0 items-center justify-between border-b border-line bg-chrome px-3 py-1.5 text-[10px] text-fg-faint">
        <div className="flex items-center gap-3 font-mono">
          <span>Hosts: <strong className="text-fg">{stats.totalHosts}</strong></span>
          <span>Endpoints: <strong className="text-fg">{stats.totalEndpoints}</strong></span>
          <span>Sensitive: <strong className="text-amber-400">{stats.sensitiveCount}</strong></span>
          <span>Params: <strong className="text-accent">{stats.totalParams}</strong></span>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
        <div className="flex min-w-[140px] flex-1 items-center gap-1 rounded-sm border border-line bg-panel px-2">
          <Search className="size-3 text-fg-faint" strokeWidth={1.75} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Filter attack surface…")}
            className="min-w-0 flex-1 bg-transparent py-0.5 text-[11px] text-fg outline-none placeholder:text-fg-faint"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="text-fg-faint hover:text-fg">
              <X className="size-3" strokeWidth={1.75} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(["all", "scope", "api", "sensitive"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterMode(mode)}
              className={cn(
                "rounded-sm border px-1.5 py-0.5 text-[10px] capitalize transition-colors duration-100",
                filterMode === mode ? "border-accent bg-selected text-fg-bright font-medium" : "border-line text-fg-faint hover:bg-hover hover:text-fg",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <ScopeBar />

      <div className="min-h-0 flex-1 overflow-auto">
        {hosts.length === 0 ? (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-fg-faint">
            {filterMode !== "all" || search
              ? t("No endpoints matched the active filter.")
              : t("The site map fills in as the proxy captures traffic. Start the proxy and browse a target.")}
          </p>
        ) : (
          hosts.map((host) => (
            <TreeRow
              key={host.key}
              node={host}
              depth={0}
              scope={scope}
              expanded={expanded}
              toggle={toggle}
              selectedEntry={selectedEntry}
              onSelectEntry={setSelectedEntry}
            />
          ))
        )}
      </div>

      {selectedEntry && (
        <EndpointInspector
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </div>
  );
}
