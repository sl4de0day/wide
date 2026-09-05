import { ArrowLeft, ArrowRight, ArrowUpRight, Bug, ChevronDown, ChevronUp, Code2, Cookie, Download, Frame, List, Lock, Maximize2, Minimize2, Plus, Radar, RotateCw, Search, ShieldAlert, ShieldCheck, Smartphone, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CookiePanel } from "@/components/browser/CookiePanel";
import { DeviceBar } from "@/components/browser/DeviceBar";
import { DomInvaderPanel } from "@/components/browser/DomInvader";
import { BrowserRequestsPanel } from "@/components/browser/RequestsPanel";
import { clickjackingPocForUrl } from "@/lib/poc/generate";
import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { passiveChecks } from "@/lib/passiveScan";
import { cn } from "@/lib/utils";
import { useBrowser } from "@/stores/browser";
import { useBrowserData } from "@/stores/browserData";
import { useCatcher } from "@/stores/catcher";
import { useFindings } from "@/stores/findings";
import { useProxy } from "@/stores/proxy";

function hostInScope(host: string, scope: string[]): boolean {
  if (!host) return false;
  return scope.some((raw) => {
    const s = raw.toLowerCase();
    if (s.startsWith("*.")) return host === s.slice(2) || host.endsWith(s.slice(1));
    return host === s;
  });
}

const navigatedUrls = new Map<string, string>();
const faviconCache = new Map<string, string>();
const faviconPending = new Set<string>();

const faviconScript = (url: string) => `(async () => {
  try {
    const response = await fetch(${JSON.stringify(url)}, { cache: "force-cache", credentials: "omit" });
    if (!response.ok) return "";
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size > 65536) return "";
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    return "";
  }
})()`;

function resolveFavicon(tabId: string, url: string): void {
  if (!tabId || !/^https?:\/\//i.test(url)) return;
  const cached = faviconCache.get(url);
  if (cached) {
    useBrowser.getState().ingest({ tabId, favicon: cached });
    return;
  }
  if (faviconPending.has(url)) return;
  faviconPending.add(url);
  void bridge
    .browserCdp(tabId, "Runtime.evaluate", { expression: faviconScript(url), awaitPromise: true, returnByValue: true })
    .then((reply) => {
      faviconPending.delete(url);
      if (!reply.ok) return;
      const value = (reply.result as { result?: { value?: string } } | undefined)?.result?.value;
      if (typeof value !== "string" || !value) return;
      if (faviconCache.size > 200) faviconCache.clear();
      faviconCache.set(url, value);
      useBrowser.getState().ingest({ tabId, favicon: value });
    })
    .catch(() => faviconPending.delete(url));
}

function bareHost(value: string): string {
  return String(value || "").toLowerCase().replace(/:\d+$/, "");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function toUrl(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

export function BrowserView() {
  const t = useT();
  const surface = useRef<HTMLDivElement>(null);
  const devtoolsSurface = useRef<HTMLDivElement>(null);

  const shownUrls = useRef<Map<string, string>>(navigatedUrls);
  const frame = useRef(0);

  const devtoolsOpenRef = useRef(false);

  const tabs = useBrowser((state) => state.tabs);
  const activeId = useBrowser((state) => state.activeId);
  const active = tabs.find((tab) => tab.id === activeId);
  const activeUrl = active?.url ?? "";

  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);

  const [fullscreen, setFullscreen] = useState(false);

  const [devtoolsOpen, setDevtoolsOpen] = useState(false);

  const [drawer, setDrawer] = useState<"requests" | "cookies" | "dominvader" | null>(null);

  const [showDevice, setShowDevice] = useState(false);
  const [find, setFind] = useState<string | null>(null);

  const [download, setDownload] = useState<{ url: string; path: string } | null>(null);

  const proxyRunning = useProxy((state) => state.running);
  const proxyScope = useProxy((state) => state.scope);
  const entries = useProxy((state) => state.entries);
  const bookmarks = useBrowserData((state) => state.bookmarks);
  const historyEntries = useBrowserData((state) => state.history);

  const activeHost = useMemo(() => hostOf(activeUrl), [activeUrl]);
  const inScope = useMemo(() => hostInScope(activeHost, proxyScope), [activeHost, proxyScope]);
  const requestCount = useMemo(
    () => (activeHost ? entries.filter((e) => bareHost(e.host) === activeHost).length : 0),
    [entries, activeHost],
  );

  const matchEntry = useMemo(() => {
    if (!activeUrl) return null;
    for (let i = entries.length - 1; i >= 0; i -= 1) if (entries[i].url === activeUrl) return entries[i];
    return null;
  }, [entries, activeUrl]);
  const issues = useMemo(() => (matchEntry ? passiveChecks(matchEntry) : []), [matchEntry]);
  const isBookmarked = bookmarks.some((b) => b.url === activeUrl);
  const suggestions = useMemo(
    () => (editing && address ? useBrowserData.getState().suggestions(address, 7) : []),

    [address, editing, bookmarks, historyEntries],
  );

  useEffect(() => {
    void useProxy.getState().refresh();
  }, []);

  const toggleProxy = () => {
    const proxy = useProxy.getState();
    void (proxy.running ? proxy.stop() : proxy.start());
  };
  const scopeHost = () => {
    if (!activeHost || inScope) return;
    void useProxy.getState().setScope([...proxyScope, activeHost]);
  };
  const sendToRepeater = () => {
    if (matchEntry) {
      useCatcher.getState().addRepeater({ method: matchEntry.method, url: matchEntry.url, headers: matchEntry.reqHeaders, body: matchEntry.reqBody });
    } else if (activeUrl) {
      useCatcher.getState().addRepeater({ method: "GET", url: activeUrl, headers: [], body: "" });
    }
  };
  const addSecurityToFindings = () => {
    for (const issue of issues) {
      useFindings.getState().add({ title: issue.title, severity: issue.severity, location: activeUrl, detail: issue.detail });
    }
  };
  const runFind = (backwards: boolean) => {
    if (!find) return;
    const expr = `window.find(${JSON.stringify(find)}, false, ${backwards ? "true" : "false"}, true)`;
    void bridge.browserCdp(useBrowser.getState().activeId, "Runtime.evaluate", { expression: expr });
  };

  useEffect(() => {
    useBrowser.getState().ensureOne();
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    bridge.browserFullscreen(fullscreen);
    place();

  }, [fullscreen]);

  const place = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const ratio = window.devicePixelRatio || 1;
      const box = (element: HTMLDivElement) => {
        const rect = element.getBoundingClientRect();
        return [
          Math.round(rect.left * ratio),
          Math.round(rect.top * ratio),
          Math.round(rect.width * ratio),
          Math.round(rect.height * ratio),
        ] as const;
      };
      if (surface.current) {
        const [x, y, w, h] = box(surface.current);

        const state = useBrowser.getState();
        const showPage = Boolean(state.active()?.url) && !devtoolsOpenRef.current && w > 0 && h > 0;
        bridge.browserPlace(state.activeId, x, y, w, h, showPage);
      }
      if (devtoolsOpenRef.current && devtoolsSurface.current) {
        const [x, y, w, h] = box(devtoolsSurface.current);
        bridge.devtoolsPlace(x, y, w, h, true);
      } else {
        bridge.devtoolsPlace(0, 0, 0, 0, false);
      }
    });
  };

  useEffect(() => {
    place();
    const observer = new ResizeObserver(() => place());
    if (surface.current) observer.observe(surface.current);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      if (frame.current) cancelAnimationFrame(frame.current);

      bridge.browserPlace(useBrowser.getState().activeId, 0, 0, 0, 0, false);
      bridge.devtoolsPlace(0, 0, 0, 0, false);
      void bridge.browserDevtools(false);
    };

  }, []);

  useEffect(() => {
    return bridge.onBrowserEvent((event) => {

      if (event.url !== undefined) {
        const id = event.tabId || useBrowser.getState().activeId;
        if (id) shownUrls.current.set(id, event.url);
      }
      if (event.devtoolsToggle) setDevtoolsOpen((open) => !open);
      if (event.exitFullscreen) setFullscreen(false);
      if (event.download) setDownload(event.download);
      useBrowser.getState().ingest(event);
      if (event.favicon) resolveFavicon(event.tabId || useBrowser.getState().activeId, event.favicon);

      const reportId = event.tabId || useBrowser.getState().activeId;
      const reportTab = useBrowser.getState().tabs.find((tab) => tab.id === reportId);
      if (reportTab?.url) useBrowserData.getState().visit(reportTab.url, reportTab.title);
    });
  }, []);

  useEffect(() => {
    place();

  }, [drawer, showDevice, suggestions.length, download]);

  useEffect(() => {
    if (!download) return;
    const id = setTimeout(() => setDownload(null), 6000);
    return () => clearTimeout(id);
  }, [download]);

  useEffect(() => {
    devtoolsOpenRef.current = devtoolsOpen;
    void bridge.browserDevtools(
      devtoolsOpen,
      useBrowser.getState().active()?.url ?? "",
      useBrowser.getState().activeId,
    );
    place();

  }, [devtoolsOpen]);

  useEffect(() => {
    if (activeId) bridge.browserActivate(activeId);
    place();

  }, [activeId]);

  useEffect(() => {
    if (activeUrl && shownUrls.current.get(activeId) !== activeUrl) {
      shownUrls.current.set(activeId, activeUrl);
      void bridge.browserNavigate(activeId, activeUrl);
    }
    place();

  }, [activeId, activeUrl]);

  useEffect(() => {
    if (!editing) setAddress(activeUrl);
  }, [activeId, activeUrl, editing]);

  const go = (text: string) => {
    const target = toUrl(text);
    if (!target) return;
    setEditing(false);
    setAddress(target);

    shownUrls.current.set(activeId, target);
    useBrowser.getState().commit(target);
    void bridge.browserNavigate(activeId, target);
    place();
  };

  const closeTab = (id: string) => {
    bridge.browserClose(id);
    shownUrls.current.delete(id);

    useBrowser.getState().closeTab(id);
  };

  const secure = activeUrl.startsWith("https://");
  const loading = active?.loading ?? false;
  const canBack = active?.canBack ?? false;
  const canForward = active?.canForward ?? false;

  return (
    <div className={cn("relative flex h-full flex-col bg-canvas", fullscreen && "fixed inset-0 z-50")}>
      {

}
      {!fullscreen && (
      <>
      {}
      <div className="flex shrink-0 items-center border-b border-line bg-chrome px-1.5 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "group flex min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px]",
              tab.id === activeId ? "bg-canvas text-fg" : "text-fg-dim hover:bg-hover",
            )}
          >
            {tab.favicon && (
              <img
                src={tab.favicon}
                alt=""
                className="size-3.5 shrink-0 rounded-sm"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            )}
            <button
              type="button"
              onClick={() => useBrowser.getState().selectTab(tab.id)}
              className="max-w-40 truncate text-left"
              title={tab.url || t("New tab")}
            >
              {tab.title || tab.url || t("New tab")}
            </button>
            <button
              type="button"
              onClick={() => closeTab(tab.id)}
              title={t("Close")}
              aria-label={t("Close")}
              className="flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-fg"
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => useBrowser.getState().newTab()}
          title={t("New tab")}
          aria-label={t("New tab")}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <Plus className="size-4" strokeWidth={1.75} />
        </button>
        </div>
        <button
          type="button"
          onClick={() => setFullscreen((on) => !on)}
          title={fullscreen ? t("Exit fullscreen (Esc)") : t("Fullscreen")}
          aria-label={fullscreen ? t("Exit fullscreen (Esc)") : t("Fullscreen")}
          className="ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          {fullscreen ? <Minimize2 className="size-3.5" strokeWidth={1.75} /> : <Maximize2 className="size-3.5" strokeWidth={1.75} />}
        </button>
      </div>

      {}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <button
          type="button"
          disabled={!canBack}
          onClick={() => bridge.browserBack(activeId)}
          title={t("Back")}
          aria-label={t("Back")}
          className="rounded-sm p-1 text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          disabled={!canForward}
          onClick={() => bridge.browserForward(activeId)}
          title={t("Forward")}
          aria-label={t("Forward")}
          className="rounded-sm p-1 text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => (loading ? bridge.browserStop(activeId) : bridge.browserReload(activeId))}
          title={loading ? t("Stop") : t("Reload")}
          aria-label={loading ? t("Stop") : t("Reload")}
          className="rounded-sm p-1 text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          {loading ? <X className="size-4" strokeWidth={2} /> : <RotateCw className="size-4" strokeWidth={1.75} />}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line bg-panel px-2 focus-within:border-accent">
          {activeUrl && (
            <Lock
              className={cn("size-3 shrink-0", secure ? "text-emerald-400" : "text-fg-faint")}
              strokeWidth={1.75}
              aria-label={secure ? t("Secure") : t("Not secure")}
            />
          )}
          <input
            value={address}
            onChange={(event) => {
              setEditing(true);
              setAddress(event.target.value);
            }}
            onFocus={(event) => {
              setEditing(true);
              event.target.select();
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                go(address);
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setAddress(activeUrl);
                setEditing(false);
                event.currentTarget.blur();
              }
            }}
            placeholder={t("Enter a URL")}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint"
          />
        </div>

        {
}
        <button
          type="button"
          onClick={toggleProxy}
          title={proxyRunning ? t("Proxied through Catcher — click to stop") : t("Route through Catcher proxy")}
          aria-label={t("Catcher proxy")}
          aria-pressed={proxyRunning}
          className={cn(
            "ml-1 rounded-sm p-1 transition-colors duration-100 hover:bg-hover",
            proxyRunning ? "text-emerald-400" : "text-fg-dim hover:text-fg",
          )}
        >
          <Radar className="size-4" strokeWidth={1.75} />
        </button>
        {activeHost && (
          <button
            type="button"
            onClick={scopeHost}
            disabled={inScope}
            title={inScope ? t("This host is in the proxy scope") : t("Add this host to the proxy scope (decrypt & capture)")}
            aria-label={t("Scope this host")}
            className={cn(
              "rounded-sm p-1 transition-colors duration-100 hover:bg-hover",
              inScope ? "text-emerald-400" : "text-fg-dim hover:text-fg",
            )}
          >
            <ShieldCheck className="size-4" strokeWidth={1.75} />
          </button>
        )}
        {issues.length > 0 && (
          <button
            type="button"
            onClick={addSecurityToFindings}
            title={`${issues.map((i) => i.title).join(", ")} — ${t("add to Findings")}`}
            aria-label={t("Security issues")}
            className="relative rounded-sm p-1 text-amber-400 transition-colors duration-100 hover:bg-hover"
          >
            <ShieldAlert className="size-4" strokeWidth={1.75} />
            <span className="absolute -right-0.5 -top-0.5 rounded-full bg-amber-500 px-1 text-[8px] font-bold leading-tight text-black">{issues.length}</span>
          </button>
        )}
        {activeUrl && (
          <button
            type="button"
            onClick={sendToRepeater}
            title={t("Send this request to Repeater")}
            aria-label={t("Send to Repeater")}
            className="rounded-sm p-1 text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <ArrowUpRight className="size-4" strokeWidth={1.75} />
          </button>
        )}
        {activeUrl && (
          <button
            type="button"
            onClick={() => useBrowserData.getState().toggleBookmark(activeUrl, active?.title || activeUrl)}
            title={isBookmarked ? t("Remove bookmark") : t("Bookmark this page")}
            aria-label={t("Bookmark")}
            className={cn("rounded-sm p-1 transition-colors duration-100 hover:bg-hover", isBookmarked ? "text-amber-400" : "text-fg-dim hover:text-fg")}
          >
            <Star className="size-4" strokeWidth={1.75} fill={isBookmarked ? "currentColor" : "none"} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setDrawer((d) => (d === "requests" ? null : "requests"))}
          title={t("This page's captured requests")}
          aria-label={t("Requests")}
          aria-pressed={drawer === "requests"}
          className={cn(
            "relative rounded-sm p-1 transition-colors duration-100 hover:bg-hover hover:text-fg",
            drawer === "requests" ? "text-fg" : "text-fg-dim",
          )}
        >
          <List className="size-4" strokeWidth={1.75} />
          {requestCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 text-[8px] font-bold leading-tight text-bg">{requestCount > 99 ? "99+" : requestCount}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setDrawer((d) => (d === "cookies" ? null : "cookies"))}
          title={t("Cookies")}
          aria-label={t("Cookies")}
          aria-pressed={drawer === "cookies"}
          className={cn("rounded-sm p-1 transition-colors duration-100 hover:bg-hover hover:text-fg", drawer === "cookies" ? "text-fg" : "text-fg-dim")}
        >
          <Cookie className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => setShowDevice((v) => !v)}
          title={t("Device emulation")}
          aria-label={t("Device emulation")}
          aria-pressed={showDevice}
          className={cn("rounded-sm p-1 transition-colors duration-100 hover:bg-hover hover:text-fg", showDevice ? "text-fg" : "text-fg-dim")}
        >
          <Smartphone className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => setFind((f) => (f === null ? "" : null))}
          title={t("Find in page")}
          aria-label={t("Find in page")}
          aria-pressed={find !== null}
          className={cn("rounded-sm p-1 transition-colors duration-100 hover:bg-hover hover:text-fg", find !== null ? "text-fg" : "text-fg-dim")}
        >
          <Search className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => setDrawer((d) => (d === "dominvader" ? null : "dominvader"))}
          title={t("DOM Invader")}
          aria-label={t("DOM Invader")}
          aria-pressed={drawer === "dominvader"}
          className={cn("rounded-sm p-1 transition-colors duration-100 hover:bg-hover hover:text-fg", drawer === "dominvader" ? "text-fg" : "text-fg-dim")}
        >
          <Bug className="size-4" strokeWidth={1.75} />
        </button>
        {activeUrl && (
          <button
            type="button"
            onClick={() => void clickjackingPocForUrl(activeUrl)}
            title={t("Clickjacking PoC")}
            aria-label={t("Clickjacking PoC")}
            className="rounded-sm p-1 text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <Frame className="size-4" strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setDevtoolsOpen((open) => !open)}
          title={t("Developer tools (F12)")}
          aria-label={t("Developer tools (F12)")}
          className={cn(
            "rounded-sm p-1 transition-colors duration-100 hover:bg-hover hover:text-fg",
            devtoolsOpen ? "text-fg" : "text-fg-dim",
          )}
        >
          <Code2 className="size-4" strokeWidth={1.75} />
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="max-h-[min(16rem,40%)] shrink-0 overflow-auto border-b border-line bg-panel">
          {suggestions.map((s) => (
            <button
              key={s.url}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                go(s.url);
              }}
              className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] hover:bg-hover"
            >
              {s.bookmarked ? (
                <Star className="size-3 shrink-0 text-amber-400" strokeWidth={1.75} fill="currentColor" />
              ) : (
                <span className="size-3 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate text-fg">{s.title}</span>
              <span className="max-w-[45%] shrink-0 truncate text-[10px] text-fg-faint">{s.url}</span>
            </button>
          ))}
        </div>
      )}

      {showDevice && <DeviceBar tabId={activeId} />}

      {find !== null && (
        <div className="flex shrink-0 items-center gap-1 border-b border-line bg-chrome px-2 py-1">
          <Search className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <input
            autoFocus
            value={find}
            onChange={(event) => setFind(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runFind(event.shiftKey);
              } else if (event.key === "Escape") {
                setFind(null);
              }
            }}
            placeholder={t("Find in page")}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-faint"
          />
          <button type="button" onClick={() => runFind(true)} title={t("Previous match")} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg">
            <ChevronUp className="size-3.5" strokeWidth={2} />
          </button>
          <button type="button" onClick={() => runFind(false)} title={t("Next match")} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg">
            <ChevronDown className="size-3.5" strokeWidth={2} />
          </button>
          <button type="button" onClick={() => setFind(null)} title={t("Close")} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg">
            <X className="size-3.5" strokeWidth={2} />
          </button>
        </div>
      )}
      </>
      )}

      {
}
      {

}
      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={surface} className={cn("min-h-0", devtoolsOpen && !fullscreen ? "h-0" : "flex-1")}>
          {!activeUrl && !devtoolsOpen && (
            <div className="flex h-full items-center justify-center">
              <p className="text-[13px] text-fg-faint">{t("Enter a URL to open a page.")}</p>
            </div>
          )}
        </div>
        {devtoolsOpen && !fullscreen && <div ref={devtoolsSurface} className="min-h-0 flex-1" />}
        {drawer && !fullscreen && (
          <div className="h-64 shrink-0 border-t border-line">
            {drawer === "requests" ? (
              <BrowserRequestsPanel host={activeHost || null} />
            ) : drawer === "cookies" ? (
              <CookiePanel tabId={activeId} />
            ) : (
              <DomInvaderPanel tabId={activeId} />
            )}
          </div>
        )}
      </div>

      {download && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3 py-1.5 text-[11px]">
          <Download className="size-3.5 shrink-0 text-emerald-400" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-fg" title={download.path || download.url}>
            {download.path || download.url}
          </span>
          <button
            type="button"
            onClick={() => setDownload(null)}
            title={t("Close")}
            aria-label={t("Close")}
            className="shrink-0 text-fg-faint hover:text-fg"
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}
