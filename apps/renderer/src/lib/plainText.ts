

const FENCE = /^[ \t]*(?:`{3,}|~{3,})[^\n]*$/;

const RULE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;

function plainLine(line: string): string {

  let out = line.replace(/^([ \t]*)#{1,6}[ \t]+/, "$1");

  out = out.replace(/^([ \t]*)>[ \t]?/, "$1");

  out = out.replace(/^([ \t]*)[-*+][ \t]+(?=\S)/, "$1");
  return out;
}

function plainInline(line: string): string {

  let out = line.replace(/\*\*(?=\S)([^*]+?)(?<=\S)\*\*/g, "$1");
  out = out.replace(/__(?=\S)([^_]+?)(?<=\S)__/g, "$1");

  out = out.replace(/`([^`\n]+)`/g, "$1");

  out = out.replace(/\[([^\]\n]+)\]\((\S+?)\)/g, (_all, text: string, href: string) =>
    text === href ? text : `${text} (${href})`,
  );
  return out;
}

export function plainText(text: string): string {
  if (!text) return text;

  if (!/[`*_#>[\-+]/.test(text)) return text;

  const lines = text.split("\n");
  const out: string[] = [];

  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (RULE.test(line)) continue;
    out.push(plainInline(plainLine(line)));
  }
  return out.join("\n");
}

export function createStripper(): (text: string) => string {
  let consumed = 0;
  let done = "";
  let inFence = false;
  let seen = "";

  return (text: string): string => {

    if (!text.startsWith(seen)) {
      consumed = 0;
      done = "";
      inFence = false;
    }
    seen = text;

    const lastBreak = text.lastIndexOf("\n");
    if (lastBreak + 1 > consumed) {
      const chunk = text.slice(consumed, lastBreak + 1);
      const lines = chunk.split("\n");

      lines.pop();
      for (const line of lines) {
        if (FENCE.test(line)) {
          inFence = !inFence;
          continue;
        }
        if (inFence) {
          done += `${line}\n`;
          continue;
        }
        if (RULE.test(line)) continue;
        done += `${plainInline(plainLine(line))}\n`;
      }
      consumed = lastBreak + 1;
    }

    const tail = text.slice(consumed);
    if (!tail) return done;

    if (FENCE.test(tail)) return done.slice(0, -1);
    if (inFence) return done + tail;
    if (RULE.test(tail)) return done.slice(0, -1);
    return done + plainInline(plainLine(tail));
  };
}
