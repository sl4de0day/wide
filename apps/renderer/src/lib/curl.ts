

export interface ParsedCurl {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}

function tokenise(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, " ").trim();
  const words: string[] = [];
  let word = "";
  let quote: '"' | "'" | null = null;
  let has = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && i + 1 < text.length && /["\\$`]/.test(text[i + 1])) {
        word += text[i + 1];
        i += 1;
      } else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === "\\" && i + 1 < text.length) {
      word += text[i + 1];
      i += 1;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has) {
        words.push(word);
        word = "";
        has = false;
      }
      continue;
    }
    word += ch;
    has = true;
  }
  if (has) words.push(word);
  return words;
}

const VALUE_FLAGS = new Set([
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "-X",
  "--request",
  "-u",
  "--user",
  "-b",
  "--cookie",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "-T",
  "--upload-file",
]);

export function parseCurl(input: string): ParsedCurl | null {
  const words = tokenise(input);
  if (words.length === 0 || !/^curl$/i.test(words[0])) return null;

  let method = "";
  let url = "";
  const headers: [string, string][] = [];
  const dataParts: string[] = [];

  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    const takesValue = VALUE_FLAGS.has(word);
    const value = takesValue ? words[i + 1] ?? "" : "";
    if (takesValue) i += 1;

    if (word === "-X" || word === "--request") {
      method = value.toUpperCase();
    } else if (word === "-H" || word === "--header") {
      const at = value.indexOf(":");
      if (at > 0) headers.push([value.slice(0, at).trim(), value.slice(at + 1).trim()]);
    } else if (word === "-d" || word === "--data" || word === "--data-raw" || word === "--data-binary" || word === "--data-urlencode") {
      dataParts.push(value.replace(/^\$/, ""));
    } else if (word === "-u" || word === "--user") {
      headers.push(["Authorization", `Basic ${btoa(value)}`]);
    } else if (word === "-b" || word === "--cookie") {
      headers.push(["Cookie", value]);
    } else if (word === "-A" || word === "--user-agent") {
      headers.push(["User-Agent", value]);
    } else if (word === "-e" || word === "--referer") {
      headers.push(["Referer", value]);
    } else if (word === "--url") {
      url = words[i + 1] ?? "";
      i += 1;
    } else if (!word.startsWith("-") && !url) {

      url = word;
    }

  }

  if (!url) return null;
  const body = dataParts.join("&");
  if (!method) method = body ? "POST" : "GET";

  if (body && !headers.some(([name]) => name.toLowerCase() === "content-type")) {
    headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
  }
  return { method, url, headers, body };
}
