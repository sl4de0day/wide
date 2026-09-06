import { useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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

  const run = async () => {
    if (!query.trim() || !tabId) return;
    setBusy(true);
    const reply = await bridge.browserCdp(tabId, "Runtime.evaluate", {
      expression: buildExpr(query, mode),
      returnByValue: true,
    });
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
            if (e.key === "Enter") void run();
          }}
          placeholder={mode === "css" ? t("Type a CSS selector…") : t("Type an XPath expression…")}
          className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !query.trim()}
          className="shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-50"
        >
          {t("Test")}
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
        {result?.error ? (
          <p className="px-3 py-2 text-[12px] text-status-error">{result.error}</p>
        ) : result ? (
          <>
            <p className="px-3 py-1.5 text-[11px] text-fg-dim">
              {t("{count} matches", { count: result.count ?? 0 })}
            </p>
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
