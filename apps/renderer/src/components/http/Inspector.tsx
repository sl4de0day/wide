import { useMemo } from "react";

import { parseHttpMessage, serializeHttpMessage, setHeader, type HttpMessage } from "@/lib/httpMessage";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface InsertionPoint {
  kind: "query" | "cookie" | "header" | "body" | "path" | "json";
  name: string;
  value: string;
}

function headerValue(headers: [string, string][], name: string): string | null {
  const lower = name.toLowerCase();
  const found = headers.find(([n]) => n.toLowerCase() === lower);
  return found ? found[1] : null;
}

function parseCookiePairs(cookie: string): [string, string][] {
  return cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf("=");
      return at === -1 ? [part, ""] : [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    });
}

function serializeCookies(pairs: [string, string][]): string {
  return pairs.map(([n, v]) => `${n}=${v}`).join("; ");
}

function bodyKind(msg: HttpMessage): "form" | "json" | "none" {
  const ct = (headerValue(msg.headers, "content-type") ?? "").toLowerCase();
  if (/x-www-form-urlencoded/.test(ct)) return "form";
  if (/json/.test(ct)) return "json";
  if (!ct && msg.body.trim()) {
    if (msg.body.trim().startsWith("{") || msg.body.trim().startsWith("[")) return "json";
    if (/^[^=&\s]+=/.test(msg.body.trim())) return "form";
  }
  return msg.body.trim() ? "none" : "none";
}

export function enumerateInsertionPoints(text: string): InsertionPoint[] {
  const msg = parseHttpMessage(text);
  if (!msg) return [];
  const points: InsertionPoint[] = [];
  try {
    const url = new URL(msg.url);
    for (const [name, value] of url.searchParams.entries()) points.push({ kind: "query", name, value });

    const segs = url.pathname.split("/");
    segs.forEach((seg, i) => {
      if (seg) points.push({ kind: "path", name: String(i), value: decodeURIComponent(seg) });
    });
  } catch {

  }

  if (bodyKind(msg) === "json") {
    try {
      const obj = JSON.parse(msg.body);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const [name, value] of Object.entries(obj as Record<string, unknown>)) {
          if (typeof value === "string" || typeof value === "number") points.push({ kind: "json", name, value: String(value) });
        }
      }
    } catch {

    }
  }
  const cookie = headerValue(msg.headers, "cookie");
  if (cookie) for (const [name, value] of parseCookiePairs(cookie)) points.push({ kind: "cookie", name, value });
  for (const [name, value] of msg.headers) {
    if (name.toLowerCase() === "cookie") continue;
    points.push({ kind: "header", name, value });
  }
  if (bodyKind(msg) === "form") {
    for (const part of msg.body.split("&")) {
      const at = part.indexOf("=");
      if (at === -1) continue;
      points.push({ kind: "body", name: decodeURIComponent(part.slice(0, at)), value: decodeURIComponent(part.slice(at + 1)) });
    }
  }
  return points;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line">
      <div className="bg-chrome px-2 py-1 text-[10px] uppercase tracking-wide text-fg-faint">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  name,
  value,
  readOnly,
  onName,
  onValue,
}: {
  name: string;
  value: string;
  readOnly: boolean;
  onName?: (v: string) => void;
  onValue?: (v: string) => void;
}) {
  const cellCls = "min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-[11px] outline-none";
  return (
    <div className="flex items-center border-t border-line/50 first:border-t-0">
      <input
        value={name}
        readOnly={readOnly || !onName}
        onChange={(e) => onName?.(e.target.value)}
        className={cn(cellCls, "w-2/5 flex-none text-syn-property", (readOnly || !onName) && "cursor-default")}
      />
      <span className="text-syn-punct">=</span>
      <input
        value={value}
        readOnly={readOnly}
        onChange={(e) => onValue?.(e.target.value)}
        className={cn(cellCls, "text-syn-string", readOnly && "cursor-default")}
      />
    </div>
  );
}

export function Inspector({
  text,
  onChange,
  className,
}: {
  text: string;
  onChange?: (next: string) => void;
  className?: string;
}) {
  const t = useT();
  const msg = useMemo(() => parseHttpMessage(text), [text]);
  const readOnly = !onChange;
  const emit = (next: HttpMessage) => onChange?.(serializeHttpMessage(next));

  if (!msg) {
    return <div className={cn("p-3 text-[11px] text-fg-faint", className)}>{t("The request does not parse yet.")}</div>;
  }

  let url: URL | null = null;
  try {
    url = new URL(msg.url);
  } catch {

  }
  const query: [string, string][] = url ? [...url.searchParams.entries()] : [];
  const setQueryValue = (index: number, value: string) => {
    if (!url) return;
    const next = new URL(url.toString());
    const params = [...url.searchParams.entries()];
    params[index] = [params[index][0], value];
    next.search = "";
    for (const [n, v] of params) next.searchParams.append(n, v);
    emit({ ...msg, url: next.toString() });
  };

  const cookieRaw = headerValue(msg.headers, "cookie");
  const cookies = cookieRaw ? parseCookiePairs(cookieRaw) : [];
  const setCookieValue = (index: number, value: string) => {
    const pairs = [...cookies];
    pairs[index] = [pairs[index][0], value];
    emit({ ...msg, headers: setHeader(msg.headers, "Cookie", serializeCookies(pairs)) });
  };

  const nonCookieHeaders = msg.headers.filter(([n]) => n.toLowerCase() !== "cookie");
  const setHeaderValue = (name: string, value: string) => {
    emit({ ...msg, headers: setHeader(msg.headers, name, value) });
  };

  const kind = bodyKind(msg);
  const formParams: [string, string][] =
    kind === "form"
      ? msg.body
          .split("&")
          .filter(Boolean)
          .map((part) => {
            const at = part.indexOf("=");
            return at === -1 ? [part, ""] : [decodeURIComponent(part.slice(0, at)), decodeURIComponent(part.slice(at + 1))];
          })
      : [];
  const setFormValue = (index: number, value: string) => {
    const pairs = [...formParams];
    pairs[index] = [pairs[index][0], value];
    const body = pairs.map(([n, v]) => `${encodeURIComponent(n)}=${encodeURIComponent(v)}`).join("&");
    emit({ ...msg, body });
  };
  const jsonPretty = useMemo(() => {
    if (kind !== "json") return "";
    try {
      return JSON.stringify(JSON.parse(msg.body), null, 2);
    } catch {
      return msg.body;
    }
  }, [kind, msg.body]);

  return (
    <div className={cn("min-h-0 overflow-auto text-fg", className)}>
      {query.length > 0 && (
        <Section title={t("Query parameters")}>
          {query.map(([name, value], i) => (
            <Row key={`q${i}`} name={name} value={value} readOnly={readOnly} onValue={(v) => setQueryValue(i, v)} />
          ))}
        </Section>
      )}
      {cookies.length > 0 && (
        <Section title={t("Cookies")}>
          {cookies.map(([name, value], i) => (
            <Row key={`c${i}`} name={name} value={value} readOnly={readOnly} onValue={(v) => setCookieValue(i, v)} />
          ))}
        </Section>
      )}
      <Section title={t("Headers")}>
        {nonCookieHeaders.map(([name, value], i) => (
          <Row key={`h${i}`} name={name} value={value} readOnly={readOnly} onValue={(v) => setHeaderValue(name, v)} />
        ))}
      </Section>
      {kind === "form" && formParams.length > 0 && (
        <Section title={t("Body parameters")}>
          {formParams.map(([name, value], i) => (
            <Row key={`b${i}`} name={name} value={value} readOnly={readOnly} onValue={(v) => setFormValue(i, v)} />
          ))}
        </Section>
      )}
      {kind === "json" && (
        <Section title={t("Body (JSON)")}>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all px-2 py-1 font-mono text-[11px] text-syn-string">
            {jsonPretty}
          </pre>
        </Section>
      )}
    </div>
  );
}
