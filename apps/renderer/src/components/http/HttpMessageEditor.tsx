import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { FindBar } from "./FindBar";
import { highlightHttp } from "./highlightHttp";

const SHARED =
  "m-0 border-0 p-2 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words tracking-normal";

function nthMatch(text: string, query: string, n: number): [number, number] | null {
  if (!query) return null;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let from = 0;
  let count = 0;
  let at = lower.indexOf(q, from);
  while (at !== -1) {
    if (count === n) return [at, at + q.length];
    count += 1;
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  return null;
}

export function HttpMessageEditor({
  value,
  onChange,
  readOnly = false,
  className,
  placeholder,
}: {
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const { nodes, count } = useMemo(() => highlightHttp(value, findOpen ? query : "", active), [value, query, active, findOpen]);

  const sync = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (ta && pre) {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
  };
  useLayoutEffect(sync, [value]);

  useEffect(() => {
    if (!findOpen || count === 0) return;
    const clamped = ((active % count) + count) % count;
    if (clamped !== active) {
      setActive(clamped);
      return;
    }
    const range = nthMatch(value, query, clamped);
    const ta = taRef.current;
    if (range && ta) {
      ta.focus();
      ta.setSelectionRange(range[0], range[1]);
      sync();
    }
  }, [active, count, findOpen, query, value]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFindOpen(true);
    } else if (event.key === "Escape" && findOpen) {
      event.preventDefault();
      setFindOpen(false);
      taRef.current?.focus();
    }
  };

  return (
    <div className={cn("relative flex min-h-0 flex-col", className)} onKeyDown={onKeyDown}>
      {findOpen && (
        <div className="absolute right-2 top-2 z-10">
          <FindBar
            query={query}
            onQuery={(q) => {
              setQuery(q);
              setActive(0);
            }}
            active={active}
            count={count}
            onStep={(d) => setActive((a) => a + d)}
            onClose={() => {
              setFindOpen(false);
              taRef.current?.focus();
            }}
          />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <pre ref={preRef} aria-hidden className={cn(SHARED, "pointer-events-none absolute inset-0 overflow-hidden text-fg")}>
          {nodes}
          {"\n"}
        </pre>
        <textarea
          ref={taRef}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          onScroll={sync}
          placeholder={placeholder}
          spellCheck={false}
          className={cn(
            SHARED,
            "absolute inset-0 resize-none overflow-auto bg-transparent text-transparent caret-fg outline-none placeholder:text-fg-faint",
          )}
        />
      </div>
    </div>
  );
}
