import { Fragment, type ReactNode } from "react";

export type ChatSegment = { type: "code"; lang: string; code: string } | { type: "prose"; text: string };

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g;

export function splitChatSegments(text: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(text)) !== null) {
    if (m.index > last) {
      const prose = text.slice(last, m.index);
      if (prose.trim()) out.push({ type: "prose", text: prose });
    }
    out.push({ type: "code", lang: (m[1] || "").trim(), code: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  const tail = text.slice(last);
  if (tail.trim()) out.push({ type: "prose", text: tail });
  return out.length ? out : [{ type: "prose", text }];
}

const INLINE = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+))/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2] !== undefined) {
      nodes.push(<strong key={key} className="font-semibold text-fg-bright">{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      nodes.push(<code key={key} className="rounded-sm bg-panel px-1 py-0.5 font-mono text-[12px] text-fg">{m[3]}</code>);
    } else if (m[4] !== undefined && m[5] !== undefined) {
      nodes.push(<a key={key} href={m[5]} className="text-accent underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">{m[4]}</a>);
    } else if (m[6] !== undefined) {
      nodes.push(<a key={key} href={m[6]} className="text-accent underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">{m[6]}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderProse(text: string): ReactNode {
  const lines = text.replace(/\n+$/, "").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(
      <p key={`p-${key++}`} className="whitespace-pre-wrap">
        {renderInline(para.join("\n"), `p${key}`)}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${key++}`} className="ml-4 list-disc space-y-0.5">
        {list.map((item, idx) => (
          <li key={idx}>{renderInline(item, `li${key}-${idx}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push(
        <p key={`h-${key++}`} className="pt-1 font-semibold text-fg-bright">
          {renderInline(heading[2], `h${key}`)}
        </p>,
      );
    } else if (bullet) {
      flushPara();
      list.push(bullet[1]);
    } else if (line.trim() === "") {
      flushList();
      flushPara();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushList();
  flushPara();
  return <Fragment>{blocks}</Fragment>;
}
