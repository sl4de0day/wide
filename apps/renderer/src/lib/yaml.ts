type Yaml = null | boolean | number | string | Yaml[] | { [key: string]: Yaml };

interface Line {
  indent: number;
  text: string;
}

function preprocess(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let indent = 0;
    while (indent < raw.length && (raw[indent] === " " || raw[indent] === "\t")) indent += 1;
    const body = raw.slice(indent);
    if (body.startsWith("#")) continue;
    if (body === "---" || body === "...") continue;
    out.push({ indent, text: body });
  }
  return out;
}

function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && i > 0 && (text[i - 1] === " " || text[i - 1] === "\t")) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

function unquoteDouble(text: string): string {
  let out = "";
  for (let i = 1; i < text.length - 1; i += 1) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length - 1) {
      const next = text[i + 1];
      i += 1;
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else if (next === "/") out += "/";
      else out += next;
    } else {
      out += ch;
    }
  }
  return out;
}

function scalar(text: string): Yaml {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') return unquoteDouble(trimmed);
  if (trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'") return trimmed.slice(1, -1).replace(/''/g, "'");
  if (trimmed === "~" || trimmed === "null" || trimmed === "Null" || trimmed === "NULL") return null;
  if (trimmed === "true" || trimmed === "True" || trimmed === "TRUE") return true;
  if (trimmed === "false" || trimmed === "False" || trimmed === "FALSE") return false;
  if (/^[-+]?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)(e[-+]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseFlow(text: string): Yaml {
  let pos = 0;
  const s = text;
  const skipWs = () => {
    while (pos < s.length && (s[pos] === " " || s[pos] === "\t")) pos += 1;
  };
  const readScalar = (stops: string): Yaml => {
    skipWs();
    if (s[pos] === '"' || s[pos] === "'") {
      const quote = s[pos];
      let i = pos + 1;
      while (i < s.length && s[i] !== quote) {
        if (quote === '"' && s[i] === "\\") i += 1;
        i += 1;
      }
      const raw = s.slice(pos, i + 1);
      pos = i + 1;
      return quote === '"' ? unquoteDouble(raw) : raw.slice(1, -1).replace(/''/g, "'");
    }
    let i = pos;
    while (i < s.length && !stops.includes(s[i])) i += 1;
    const raw = s.slice(pos, i);
    pos = i;
    return scalar(raw);
  };
  const readValue = (): Yaml => {
    skipWs();
    if (s[pos] === "{") {
      pos += 1;
      const obj: { [key: string]: Yaml } = {};
      skipWs();
      while (pos < s.length && s[pos] !== "}") {
        const key = readScalar(":,}");
        skipWs();
        let value: Yaml = null;
        if (s[pos] === ":") {
          pos += 1;
          value = readValue();
        }
        obj[String(key)] = value;
        skipWs();
        if (s[pos] === ",") pos += 1;
        skipWs();
      }
      pos += 1;
      return obj;
    }
    if (s[pos] === "[") {
      pos += 1;
      const arr: Yaml[] = [];
      skipWs();
      while (pos < s.length && s[pos] !== "]") {
        arr.push(readValue());
        skipWs();
        if (s[pos] === ",") pos += 1;
        skipWs();
      }
      pos += 1;
      return arr;
    }
    return readScalar(",}]");
  };
  return readValue();
}

function splitKey(text: string): { key: string; rest: string } | null {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    else if (ch === ":" && depth === 0 && (i + 1 >= text.length || text[i + 1] === " " || text[i + 1] === "\t")) {
      const rawKey = text.slice(0, i).trim();
      const key = rawKey[0] === '"' ? unquoteDouble(rawKey) : rawKey[0] === "'" ? rawKey.slice(1, -1).replace(/''/g, "'") : rawKey;
      return { key, rest: text.slice(i + 1).trim() };
    }
  }
  return null;
}

function inlineValue(text: string): Yaml {
  const trimmed = text.trim();
  if (trimmed[0] === "{" || trimmed[0] === "[") return parseFlow(trimmed);
  return scalar(stripComment(trimmed));
}

function blockScalar(lines: Line[], start: number, parentIndent: number, folded: boolean): { value: string; next: number } {
  const parts: string[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent > parentIndent) {
    parts.push(lines[i].text);
    i += 1;
  }
  return { value: folded ? parts.join(" ") : parts.join("\n"), next: i };
}

function parseBlock(lines: Line[], start: number, indent: number): { value: Yaml; next: number } {
  const first = lines[start];
  if (first.text === "-" || first.text.startsWith("- ")) return parseSequence(lines, start, indent);
  if (splitKey(first.text)) return parseMap(lines, start, indent);
  return { value: inlineValue(first.text), next: start + 1 };
}

function parseSequence(lines: Line[], start: number, indent: number): { value: Yaml[]; next: number } {
  const arr: Yaml[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && (lines[i].text === "-" || lines[i].text.startsWith("- "))) {
    const marker = lines[i].text === "-" ? 1 : 2;
    const rest = lines[i].text.slice(marker);
    if (rest.trim() === "") {
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const block = parseBlock(lines, i + 1, lines[i + 1].indent);
        arr.push(block.value);
        i = block.next;
      } else {
        arr.push(null);
        i += 1;
      }
    } else if (splitKey(rest)) {
      const childIndent = indent + marker;
      lines[i] = { indent: childIndent, text: rest };
      const block = parseMap(lines, i, childIndent);
      arr.push(block.value);
      i = block.next;
    } else {
      arr.push(inlineValue(rest));
      i += 1;
    }
  }
  return { value: arr, next: i };
}

function parseMap(lines: Line[], start: number, indent: number): { value: { [key: string]: Yaml }; next: number } {
  const obj: { [key: string]: Yaml } = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    if (lines[i].text === "-" || lines[i].text.startsWith("- ")) break;
    const split = splitKey(lines[i].text);
    if (!split) break;
    const { key, rest } = split;
    if (rest === "") {
      const indicator = "";
      void indicator;
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const block = parseBlock(lines, i + 1, lines[i + 1].indent);
        obj[key] = block.value;
        i = block.next;
      } else if (i + 1 < lines.length && lines[i + 1].indent === indent && (lines[i + 1].text === "-" || lines[i + 1].text.startsWith("- "))) {
        const block = parseSequence(lines, i + 1, indent);
        obj[key] = block.value;
        i = block.next;
      } else {
        obj[key] = null;
        i += 1;
      }
    } else if (rest === "|" || rest === "|-" || rest === "|+" || rest === ">" || rest === ">-" || rest === ">+") {
      const block = blockScalar(lines, i + 1, indent, rest[0] === ">");
      obj[key] = block.value;
      i = block.next;
    } else {
      obj[key] = inlineValue(rest);
      i += 1;
    }
  }
  return { value: obj, next: i };
}

export function parseYaml(text: string): unknown {
  try {
    const lines = preprocess(text);
    if (!lines.length) return null;
    return parseBlock(lines, 0, lines[0].indent).value;
  } catch {
    return null;
  }
}
