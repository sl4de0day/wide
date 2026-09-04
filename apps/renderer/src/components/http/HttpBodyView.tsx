import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { hexDump } from "@/lib/codec";
import { useT } from "@/lib/i18n";
import { prettyBody } from "@/lib/prettyBody";
import { cn } from "@/lib/utils";

import { FindBar } from "./FindBar";
import { markText } from "./highlightHttp";

type Mode = "pretty" | "raw" | "hex" | "render";

const MODES: { id: Mode; label: string }[] = [
  { id: "pretty", label: "Pretty" },
  { id: "raw", label: "Raw" },
  { id: "hex", label: "Hex" },
  { id: "render", label: "Render" },
];

function contentTypeOf(headers: [string, string][]): string | null {
  const h = headers.find(([n]) => n.toLowerCase() === "content-type");
  return h ? h[1] : null;
}

function initialMode(ct: string | null): Mode {
  if (!ct) return "raw";
  if (/html/i.test(ct)) return "render";
  if (/json|xml/i.test(ct)) return "pretty";
  return "raw";
}

export function HttpBodyView({
  body,
  headers,
  truncated,
  className,
}: {
  body: string;
  headers: [string, string][];
  truncated?: boolean;
  className?: string;
}) {
  const t = useT();
  const ct = useMemo(() => contentTypeOf(headers), [headers]);
  const [mode, setMode] = useState<Mode>(() => initialMode(ct));
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMode(initialMode(ct)), [ct]);

  const text = useMemo(() => {
    if (mode === "pretty") return prettyBody(body, ct);
    if (mode === "hex") return hexDump(body);
    return body;
  }, [mode, body, ct]);

  const searchable = findOpen && mode !== "render";
  const { nodes, count } = useMemo(
    () => (searchable ? markText(text, query, active) : { nodes: text, count: 0 }),
    [searchable, text, query, active],
  );

  useEffect(() => {
    if (!searchable || count === 0) return;
    const clamped = ((active % count) + count) % count;
    if (clamped !== active) {
      setActive(clamped);
      return;
    }
    const el = scrollRef.current?.querySelector(`[data-match="${clamped}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, count, searchable, text]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && mode !== "render") {
      event.preventDefault();
      setFindOpen(true);
    } else if (event.key === "Escape" && findOpen) {
      setFindOpen(false);
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)} onKeyDown={onKeyDown}>
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              "rounded-sm px-2 py-0.5 text-[11px] transition-colors duration-100",
              mode === m.id ? "bg-selected text-fg" : "text-fg-faint hover:bg-hover hover:text-fg",
            )}
          >
            {t(m.label)}
          </button>
        ))}
        <div className="flex-1" />
        {mode !== "render" && (
          <button
            type="button"
            onClick={() => setFindOpen((v) => !v)}
            className={cn("rounded-sm p-1 transition-colors duration-100", findOpen ? "bg-selected text-fg" : "text-fg-faint hover:bg-hover hover:text-fg")}
            aria-label={t("Find")}
          >
            <Search className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {searchable && (
        <div className="flex shrink-0 justify-end border-b border-line px-2 py-1">
          <FindBar
            query={query}
            onQuery={(q) => {
              setQuery(q);
              setActive(0);
            }}
            active={active}
            count={count}
            onStep={(d) => setActive((a) => a + d)}
            onClose={() => setFindOpen(false)}
          />
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {mode === "render" ? (
          <iframe title={t("Rendered response")} srcDoc={body} sandbox="" className="h-full w-full border-0 bg-white" />
        ) : (
          <pre className="whitespace-pre-wrap break-all p-2 font-mono text-[12px] leading-[1.5] text-fg">
            {nodes}
            {truncated && <span className="text-status-warn"> …({t("truncated")})</span>}
          </pre>
        )}
      </div>
    </div>
  );
}
