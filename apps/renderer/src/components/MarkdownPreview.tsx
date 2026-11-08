import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { useEditor } from "@/stores/editor";
import { useSettings } from "@/stores/settings";

const STYLE = `
:root { color-scheme: dark; }
body {
  margin: 0;
  padding: 28px 36px;
  max-width: 920px;
  font: 14px/1.65 var(--font-ui, system-ui, -apple-system, sans-serif);
  color: var(--fg, #d8dee9);
  background: var(--canvas, #2e3440);
}
h1, h2 {
  border-bottom: 1px solid var(--line, rgba(255,255,255,0.1));
  padding-bottom: .3em;
  color: var(--fg-bright, #eceff4);
}
h1, h2, h3, h4 {
  margin: 1.4em 0 .5em;
  line-height: 1.25;
  color: var(--fg-bright, #eceff4);
}
code {
  background: var(--panel, #1e2030);
  color: var(--syn-keyword, var(--accent, #81a1c1));
  border-radius: 4px;
  padding: .15em .35em;
  font: 12px var(--font-mono, monospace);
}
pre {
  background: var(--panel, #1e2030);
  border: 1px solid var(--line, rgba(255,255,255,0.1));
  border-radius: 8px;
  padding: 14px;
  overflow: auto;
}
pre code {
  background: none;
  padding: 0;
}
blockquote {
  margin: 0;
  padding: 0 1em;
  border-left: 4px solid var(--accent, #5e81ac);
  color: var(--fg-dim, #9aa6bd);
}
table { border-collapse: collapse; }
th, td {
  border: 1px solid var(--line, rgba(255,255,255,0.1));
  padding: 6px 12px;
}
img { max-width: 100%; }
a { color: var(--accent, #5e81ac); }
`;

export function MarkdownPreview({ sourcePath }: { sourcePath: string }) {
  const t = useT();
  const theme = useSettings((state) => state.theme);
  const liveContent = useEditor((state) => {
    const tab = state.tabs.find((t) => t.path === sourcePath && t.kind === "file");
    return tab && tab.kind === "file" ? tab.content : null;
  });
  const [diskContent, setDiskContent] = useState<string | null>(null);

  useEffect(() => {
    if (liveContent !== null) return;
    let alive = true;
    void bridge.readFile(sourcePath).then((r) => {
      if (alive) setDiskContent(r.error ? "" : r.content);
    });
    return () => {
      alive = false;
    };
  }, [sourcePath, liveContent]);

  const doc = useMemo(() => {
    const md = liveContent ?? diskContent ?? "";
    let html = "";
    try {
      html = marked.parse(md, { async: false, gfm: true, breaks: false }) as string;
    } catch {
      html = "";
    }
    const styles = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
    const canvas = styles?.getPropertyValue("--canvas") || "#2e3440";
    const panel = styles?.getPropertyValue("--panel") || "#2e3440";
    const fg = styles?.getPropertyValue("--fg") || "#d8dee9";
    const fgBright = styles?.getPropertyValue("--fg-bright") || "#eceff4";
    const fgDim = styles?.getPropertyValue("--fg-dim") || "#9aa6bd";
    const line = styles?.getPropertyValue("--line") || "rgba(255,255,255,0.1)";
    const accent = styles?.getPropertyValue("--accent") || "#5e81ac";
    const synKeyword = styles?.getPropertyValue("--syn-keyword") || "#81a1c1";

    const vars = `:root { --canvas: ${canvas}; --panel: ${panel}; --fg: ${fg}; --fg-bright: ${fgBright}; --fg-dim: ${fgDim}; --line: ${line}; --accent: ${accent}; --syn-keyword: ${synKeyword}; }`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>${vars}${STYLE}</style></head><body>${html}</body></html>`;
  }, [liveContent, diskContent, theme]);

  return <iframe title={t("Markdown preview")} sandbox="" srcDoc={doc} className="h-full w-full border-0 bg-canvas" />;
}
