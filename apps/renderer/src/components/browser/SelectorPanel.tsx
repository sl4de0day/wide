import { useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn, copyText } from "@/lib/utils";
import { toast } from "@/stores/toast";

type Mode = "css" | "xpath";

interface MatchItem {
  tag: string;
  text: string;
  attrs: string;
}

interface Outcome {
  count?: number;
  items?: MatchItem[];
  error?: string;
}

const CLEAR_EXPR = `(() => {
  for (const el of document.querySelectorAll("[data-wide-sel]")) {
    el.style.outline = el.getAttribute("data-wide-outline") || "";
    el.removeAttribute("data-wide-sel");
    el.removeAttribute("data-wide-outline");
  }
  return true;
})()`;

const PICK_INSTALL = `(() => {
  if (window.__wideePickCleanup) window.__wideePickCleanup();
  window.__wideePickResult = "";
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  const pathOf = (node) => {
    if (node.id) return "#" + esc(node.id);
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1 && cur.tagName !== "HTML") {
      if (cur.id) { parts.unshift("#" + esc(cur.id)); break; }
      let sel = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) sel += ":nth-of-type(" + (same.indexOf(cur) + 1) + ")";
      }
      parts.unshift(sel);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };
  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { window.__wideePickResult = pathOf(e.target); } catch (err) { window.__wideePickResult = ""; }
    if (window.__wideePickCleanup) window.__wideePickCleanup();
  };
  window.__wideePickCleanup = () => {
    document.removeEventListener("click", onClick, true);
    window.__wideePickCleanup = null;
  };
  document.addEventListener("click", onClick, true);
  return true;
})()`;

const PICK_READ = `(window.__wideePickResult || "")`;

function buildExpr(query: string, mode: Mode): string {
  return `(() => {
  for (const el of document.querySelectorAll("[data-wide-sel]")) {
    el.style.outline = el.getAttribute("data-wide-outline") || "";
    el.removeAttribute("data-wide-sel");
    el.removeAttribute("data-wide-outline");
  }
  let nodes = [];
  try {
    if (${JSON.stringify(mode)} === "xpath") {
      const r = document.evaluate(${JSON.stringify(query)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < r.snapshotLength; i++) nodes.push(r.snapshotItem(i));
    } else {
      nodes = Array.from(document.querySelectorAll(${JSON.stringify(query)}));
    }
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
  const items = [];
  let count = 0;
  for (const node of nodes) {
    if (!node || node.nodeType !== 1) continue;
    count++;
    if (count <= 100) {
      node.setAttribute("data-wide-outline", node.style.outline || "");
      node.setAttribute("data-wide-sel", "1");
      node.style.outline = "2px solid #f6a821";
      const attrs = [];
      for (const a of node.attributes) { if (a.name.indexOf("data-wide") !== 0) attrs.push(a.name + (a.value ? '="' + a.value + '"' : "")); }
      items.push({ tag: node.tagName.toLowerCase(), text: (node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80), attrs: attrs.slice(0, 6).join(" ") });
    }
    if (count === 1 && node.scrollIntoView) node.scrollIntoView({ block: "center" });
  }
  return { count, items };
})()`;
}

export function SelectorPanel({ tabId }: { tabId: string }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("css");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const doTest = async (q: string, m: Mode) => {
    if (!q.trim() || !tabId) return;
    setBusy(true);
    const reply = await bridge.browserCdp(tabId, "Runtime.evaluate", { expression: buildExpr(q, m), returnByValue: true });
    setBusy(false);
    if (!reply.ok) {
      setResult({ error: t("The page could not be read.") });
      return;
    }
    const value = (reply.result as { result?: { value?: Outcome } } | undefined)?.result?.value;
    setResult(value ?? { count: 0, items: [] });
  };

  const clear = () => {
    setResult(null);
    setQuery("");
    void bridge.browserCdp(tabId, "Runtime.evaluate", { expression: CLEAR_EXPR });
  };

  const pick = async () => {
    if (!tabId) return;
    setPicking(true);
    await bridge.browserCdp(tabId, "Runtime.evaluate", { expression: PICK_INSTALL });
    const started = Date.now();
    const poll = async () => {
      const reply = await bridge.browserCdp(tabId, "Runtime.evaluate", { expression: PICK_READ, returnByValue: true });
      const value = (reply.result as { result?: { value?: string } } | undefined)?.result?.value;
      if (value) {
        setPicking(false);
        setMode("css");
        setQuery(value);
        void doTest(value, "css");
      } else if (Date.now() - started < 20000) {
        setTimeout(poll, 400);
      } else {
        setPicking(false);
      }
    };
    void poll();
  };

  const copySnippet = async (kind: "playwright" | "query") => {
    if (!query.trim()) return;
    const q = JSON.stringify(query);
    let snippet: string;
    if (kind === "playwright") {
      snippet = mode === "xpath" ? `await page.locator(${JSON.stringify(`xpath=${query}`)})` : `await page.locator(${q})`;
    } else {
      snippet =
        mode === "xpath"
          ? `document.evaluate(${q}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)`
          : `document.querySelectorAll(${q})`;
    }
    await copyText(snippet);
    toast.success(t("Copied to clipboard"));
  };

  const hasMatches = (result?.count ?? 0) > 0;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
        <div className="flex overflow-hidden rounded-sm border border-line">
          {(["css", "xpath"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "px-2 py-0.5 text-[11px] transition-colors duration-100",
                mode === m ? "bg-selected text-fg-bright" : "text-fg-dim hover:bg-hover hover:text-fg",
              )}
            >
              {m === "css" ? t("CSS") : t("XPath")}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void doTest(query, mode);
          }}
          placeholder={mode === "css" ? t("Type a CSS selector…") : t("Type an XPath expression…")}
          className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
        />
        <button
          type="button"
          onClick={() => void doTest(query, mode)}
          disabled={busy || !query.trim()}
          className="shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-50"
        >
          {t("Test")}
        </button>
        <button
          type="button"
          onClick={() => void pick()}
          className={cn(
            "shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] transition-colors duration-100 hover:bg-hover hover:text-fg",
            picking ? "text-fg" : "text-fg-dim",
          )}
        >
          {t("Pick element")}
        </button>
        <button
          type="button"
          onClick={clear}
          className="shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          {t("Clear")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {picking ? (
          <p className="px-3 py-2 text-[12px] text-fg-dim">{t("Click an element in the page…")}</p>
        ) : result?.error ? (
          <p className="px-3 py-2 text-[12px] text-status-error">{result.error}</p>
        ) : result ? (
          <>
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-fg-dim">{t("{count} matches", { count: result.count ?? 0 })}</span>
              {hasMatches && (
                <span className="flex items-center gap-2 text-[10px]">
                  <button type="button" onClick={() => void copySnippet("playwright")} className="text-fg-faint hover:text-fg">
                    {t("Copy Playwright")}
                  </button>
                  <button type="button" onClick={() => void copySnippet("query")} className="text-fg-faint hover:text-fg">
                    {t("Copy querySelectorAll")}
                  </button>
                </span>
              )}
            </div>
            <ul className="divide-y divide-line">
              {(result.items ?? []).map((item, index) => (
                <li key={index} className="px-3 py-1 font-mono text-[11px]">
                  <span className="text-fg">{item.tag}</span>
                  {item.attrs && <span className="ml-1 text-fg-dim">{item.attrs}</span>}
                  {item.text && <span className="block truncate text-fg-faint">{item.text}</span>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="px-3 py-2 text-[12px] text-fg-faint">{t("Type a selector and Test to highlight matches on the page.")}</p>
        )}
      </div>
    </div>
  );
}
