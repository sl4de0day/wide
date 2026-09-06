import type { ProxyEntry } from "@/lib/bridge";

function headerVal(headers: [string, string][] | undefined, name: string): string {
  const found = (headers || []).find(([k]) => k.toLowerCase() === name);
  return found ? found[1] : "";
}

export function toHar(entries: ProxyEntry[]): string {
  const doc = {
    log: {
      version: "1.2",
      creator: { name: "Wide Catcher", version: "1.0" },
      entries: entries
        .filter((e) => !e.websocket)
        .map((e) => ({
          startedDateTime: new Date(e.at || Date.now()).toISOString(),
          time: e.ms || 0,
          request: {
            method: (e.method || "GET").toUpperCase(),
            url: e.url,
            httpVersion: "HTTP/1.1",
            cookies: [],
            headers: (e.reqHeaders || []).map(([name, value]) => ({ name, value })),
            queryString: [],
            headersSize: -1,
            bodySize: e.reqBody ? e.reqBody.length : 0,
            ...(e.reqBody ? { postData: { mimeType: headerVal(e.reqHeaders, "content-type") || "text/plain", text: e.reqBody } } : {}),
          },
          response: {
            status: e.status || 0,
            statusText: "",
            httpVersion: "HTTP/1.1",
            cookies: [],
            headers: (e.resHeaders || []).map(([name, value]) => ({ name, value })),
            content: { size: e.resBody ? e.resBody.length : 0, mimeType: headerVal(e.resHeaders, "content-type") || "", text: e.resBody || "" },
            redirectURL: headerVal(e.resHeaders, "location"),
            headersSize: -1,
            bodySize: e.resBody ? e.resBody.length : 0,
          },
          cache: {},
          timings: { send: 0, wait: e.ms || 0, receive: 0 },
        })),
    },
  };
  return JSON.stringify(doc, null, 2);
}

export function fromHar(json: string): ProxyEntry[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return [];
  }
  const entries = (doc as { log?: { entries?: unknown[] } })?.log?.entries;
  if (!Array.isArray(entries)) return [];
  const out: ProxyEntry[] = [];
  let base = Date.now();
  for (const raw of entries) {
    const e = raw as {
      startedDateTime?: string;
      time?: number;
      request?: { method?: string; url?: string; headers?: { name: string; value: string }[]; postData?: { text?: string } };
      response?: { status?: number; headers?: { name: string; value: string }[]; content?: { text?: string } };
    };
    const req = e.request || {};
    const res = e.response || {};
    let host = "";
    let scheme: "http" | "https" = "https";
    try {
      const u = new URL(req.url || "");
      host = u.host;
      scheme = u.protocol === "http:" ? "http" : "https";
    } catch {
      void 0;
    }
    out.push({
      id: base++,
      at: Date.parse(e.startedDateTime || "") || Date.now(),
      ms: Math.round(e.time || 0),
      method: (req.method || "GET").toUpperCase(),
      url: req.url || "",
      host,
      scheme,
      status: res.status || 0,
      reqHeaders: (req.headers || []).map((h) => [h.name, h.value] as [string, string]),
      reqBody: req.postData?.text || "",
      resHeaders: (res.headers || []).map((h) => [h.name, h.value] as [string, string]),
      resBody: res.content?.text || "",
    });
  }
  return out;
}
