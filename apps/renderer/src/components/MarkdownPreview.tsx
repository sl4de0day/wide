import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useEditor } from "@/stores/editor";

const STYLE = `
:root{color-scheme:light dark}
body{margin:0;padding:28px 36px;max-width:920px;font:15px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f24;background:#ffffff}
@media (prefers-color-scheme:dark){body{color:#e6e9ee;background:#161a1f}code,pre{background:#12161b!important}th,td,blockquote{border-color:#2b333c!important}a{color:#6cb6ff}}
h1,h2{border-bottom:1px solid #e2e6ea;padding-bottom:.3em}
h1,h2,h3,h4{margin:1.4em 0 .5em;line-height:1.25}
code{background:#f0f2f5;border-radius:4px;padding:.15em .35em;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:#f0f2f5;border-radius:8px;padding:14px;overflow:auto}
pre code{background:none;padding:0}
blockquote{margin:0;padding:0 1em;border-left:4px solid #d8dde3;color:#6b7480}
table{border-collapse:collapse}
th,td{border:1px solid #d8dde3;padding:6px 12px}
img{max-width:100%}
a{color:#0969da}
`;

export function MarkdownPreview({ sourcePath }: { sourcePath: string }) {
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
    return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${html}</body></html>`;
  }, [liveContent, diskContent]);

  return <iframe title="Markdown preview" sandbox="" srcDoc={doc} className="h-full w-full border-0 bg-canvas" />;
}
