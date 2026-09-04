import { parseHttpMessage, serializeHttpMessage, setHeader } from "@/lib/httpMessage";

import type { PointKind } from "./probes";

export function mutateRequest(text: string, kind: PointKind, name: string, value: string): string | null {
  const msg = parseHttpMessage(text);
  if (!msg) return null;

  if (kind === "query") {
    let url: URL;
    try {
      url = new URL(msg.url);
    } catch {
      return null;
    }
    const params = [...url.searchParams.entries()];
    url.search = "";
    let done = false;
    for (const [n, v] of params) {
      if (!done && n === name) {
        url.searchParams.append(n, value);
        done = true;
      } else {
        url.searchParams.append(n, v);
      }
    }
    return serializeHttpMessage({ ...msg, url: url.toString() });
  }

  if (kind === "header") {
    return serializeHttpMessage({ ...msg, headers: setHeader(msg.headers, name, value) });
  }

  if (kind === "cookie") {
    const idx = msg.headers.findIndex(([n]) => n.toLowerCase() === "cookie");
    if (idx === -1) return null;
    const pairs = msg.headers[idx][1]
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const at = p.indexOf("=");
        return at === -1 ? [p, ""] : [p.slice(0, at).trim(), p.slice(at + 1).trim()];
      });
    let done = false;
    const next = pairs.map(([n, v]) => (!done && n === name ? ((done = true), [n, value]) : [n, v]));
    return serializeHttpMessage({ ...msg, headers: setHeader(msg.headers, "Cookie", next.map(([n, v]) => `${n}=${v}`).join("; ")) });
  }

  if (kind === "path") {
    let url: URL;
    try {
      url = new URL(msg.url);
    } catch {
      return null;
    }
    const segs = url.pathname.split("/");
    const idx = Number(name);
    if (!Number.isInteger(idx) || idx < 0 || idx >= segs.length) return null;
    segs[idx] = encodeURIComponent(value);
    url.pathname = segs.join("/");
    return serializeHttpMessage({ ...msg, url: url.toString() });
  }

  if (kind === "json") {
    try {
      const obj = JSON.parse(msg.body);
      if (obj && typeof obj === "object") {
        (obj as Record<string, unknown>)[name] = value;
        return serializeHttpMessage({ ...msg, body: JSON.stringify(obj) });
      }
    } catch {

    }
    return null;
  }

  const parts = msg.body.split("&").filter(Boolean);
  let done = false;
  const next = parts.map((part) => {
    const at = part.indexOf("=");
    const n = at === -1 ? part : decodeURIComponent(part.slice(0, at));
    if (!done && n === name) {
      done = true;
      return `${encodeURIComponent(n)}=${encodeURIComponent(value)}`;
    }
    return part;
  });
  return serializeHttpMessage({ ...msg, body: next.join("&") });
}
