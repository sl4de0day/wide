

function looksLikeJson(body: string): boolean {
  const t = body.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

function looksLikeMarkup(body: string): boolean {
  return body.trimStart().startsWith("<");
}

function prettyMarkup(src: string): string {
  const broken = src.replace(/>\s*</g, ">\n<").trim();
  let depth = 0;
  const out: string[] = [];
  for (const raw of broken.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const isClosing = /^<\//.test(line);
    const isSelfContained = /^<[^!?][^>]*>.*<\/[^>]+>\s*$/.test(line);
    const isSelfClosing = /\/>\s*$/.test(line) || /^<(\?|!)/.test(line);
    const isOpening = /^<[^!?/]/.test(line) && !isSelfContained && !isSelfClosing;
    if (isClosing) depth = Math.max(0, depth - 1);
    out.push("  ".repeat(depth) + line);
    if (isOpening) depth += 1;
  }
  return out.join("\n");
}

export function prettyBody(body: string, contentType: string | null): string {
  const type = (contentType ?? "").toLowerCase();
  if (/json/.test(type) || (!type && looksLikeJson(body))) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {

    }
  }
  if (/xml|html/.test(type) || (!type && looksLikeMarkup(body))) {
    try {
      return prettyMarkup(body);
    } catch {
      return body;
    }
  }
  return body;
}
