import type { ReactNode } from "react";

interface MarkState {
  query: string;
  count: number;
  active: number;
}

function withMarks(text: string, state: MarkState, keyBase: string): ReactNode {
  if (!state.query) return text;
  const lower = text.toLowerCase();
  const q = state.query.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(q, from);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    const idx = state.count;
    state.count += 1;
    parts.push(
      <mark
        key={`${keyBase}-m${idx}`}
        data-match={idx}
        className={idx === state.active ? "rounded-sm bg-amber-400 text-black" : "rounded-sm bg-amber-400/25 text-inherit"}
      >
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

export function markText(text: string, query: string, active = 0): { nodes: ReactNode; count: number } {
  if (!query) return { nodes: text, count: 0 };
  const state: MarkState = { query, count: 0, active };
  const nodes = withMarks(text, state, "b");
  return { nodes, count: state.count };
}

function span(cls: string, content: ReactNode, key: string): ReactNode {
  return (
    <span key={key} className={cls}>
      {content}
    </span>
  );
}

const HEADER_LINE = /^([^:\s][^:]*)(:)(.*)$/;

function highlightLine(line: string, index: number, isFirst: boolean, state: MarkState): ReactNode {
  const key = `l${index}`;
  if (isFirst) {
    if (/^HTTP\//i.test(line)) {

      const m = line.match(/^(\S+)(\s+)(\d{3})(.*)$/);
      if (m) {
        return (
          <span key={key}>
            {span("text-syn-comment", withMarks(m[1], state, `${key}v`), `${key}v`)}
            {m[2]}
            {span("text-syn-number font-medium", withMarks(m[3], state, `${key}c`), `${key}c`)}
            {span("text-fg-dim", withMarks(m[4], state, `${key}r`), `${key}r`)}
          </span>
        );
      }
    } else {

      const m = line.match(/^(\S+)(\s+)(\S+)(.*)$/);
      if (m) {
        return (
          <span key={key}>
            {span("text-syn-keyword font-medium", withMarks(m[1], state, `${key}m`), `${key}m`)}
            {m[2]}
            {span("text-syn-function", withMarks(m[3], state, `${key}u`), `${key}u`)}
            {span("text-fg-faint", withMarks(m[4], state, `${key}x`), `${key}x`)}
          </span>
        );
      }
    }
    return <span key={key}>{withMarks(line, state, key)}</span>;
  }
  const h = line.match(HEADER_LINE);
  if (h) {
    return (
      <span key={key}>
        {span("text-syn-property", withMarks(h[1], state, `${key}n`), `${key}n`)}
        {span("text-syn-punct", ":", `${key}c`)}
        {span("text-syn-string", withMarks(h[3], state, `${key}v`), `${key}v`)}
      </span>
    );
  }
  return <span key={key}>{withMarks(line, state, key)}</span>;
}

export function highlightHttp(
  text: string,
  query = "",
  active = 0,
): { nodes: ReactNode; count: number } {
  const state: MarkState = { query, count: 0, active };
  const normalised = text.replace(/\r\n/g, "\n");
  const blank = normalised.indexOf("\n\n");
  const headEnd = blank === -1 ? normalised.length : blank;
  const lines = normalised.split("\n");
  let offset = 0;
  let firstSeen = false;
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    const inHead = offset <= headEnd;
    const isFirst = inHead && !firstSeen && line.trim() !== "";
    if (isFirst) firstSeen = true;
    if (inHead && line !== "") {
      out.push(highlightLine(line, i, isFirst, state));
    } else {

      out.push(<span key={`l${i}`} className="text-fg">{withMarks(line, state, `l${i}`)}</span>);
    }
    if (i < lines.length - 1) out.push("\n");
    offset += line.length + 1;
  });
  return { nodes: out, count: state.count };
}
