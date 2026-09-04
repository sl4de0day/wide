import { bridge } from "@/lib/bridge";
import { parseHttpMessage } from "@/lib/httpMessage";

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  signal?: { cancelled: boolean };
  onFound?: (requestText: string, url: string) => void;
  onProgress?: (visited: number, queued: number) => void;
}

const LINK_RE = /(?:href|src|action)\s*=\s*["']([^"'#]+)["']/gi;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function requestText(url: string): string {
  return `GET ${url}\nHost: ${hostOf(url)}\n\n`;
}

export async function crawl(seedUrl: string, opts: CrawlOptions = {}): Promise<string[]> {
  const maxPages = opts.maxPages ?? 60;
  const maxDepth = opts.maxDepth ?? 3;
  let seedHost = "";
  try {
    seedHost = new URL(seedUrl).host;
  } catch {
    return [];
  }

  const visited = new Set<string>();
  const queued = new Set<string>([seedUrl]);
  const found: string[] = [];
  const queue: { url: string; depth: number }[] = [{ url: seedUrl, depth: 0 }];

  while (queue.length && visited.size < maxPages) {
    if (opts.signal?.cancelled) break;
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const text = requestText(url);
    found.push(text);
    opts.onFound?.(text, url);
    opts.onProgress?.(visited.size, queue.length);

    if (depth >= maxDepth) continue;
    const req = parseHttpMessage(text);
    if (!req) continue;
    let reply;
    try {
      reply = await bridge.proxyReplay(req, { followRedirects: true });
    } catch {
      continue;
    }
    if (!reply.ok || !reply.body) continue;
    const ct = (reply.headers ?? []).find(([n]) => n.toLowerCase() === "content-type")?.[1] ?? "";
    if (!/html/i.test(ct) && !reply.body.includes("<a")) continue;

    let m: RegExpExecArray | null;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(reply.body))) {
      let abs: URL;
      try {
        abs = new URL(m[1], url);
      } catch {
        continue;
      }
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (abs.host !== seedHost) continue;
      abs.hash = "";
      const norm = abs.toString();
      if (!visited.has(norm) && !queued.has(norm)) {
        queued.add(norm);
        queue.push({ url: norm, depth: depth + 1 });
      }
    }
  }
  return found;
}
