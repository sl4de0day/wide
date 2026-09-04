import { bridge } from "@/lib/bridge";
import { usePitcherCookies } from "@/stores/pitcherCookies";
import type { Param, PitcherRequest } from "@/stores/pitcher";

import { applyAuth } from "./auth";
import { buildDigestHeader, parseDigestChallenge } from "./digest";
import { resolveVars } from "./vars";

export interface PitcherResponse {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: [string, string][];
  body?: string;
  bytes?: number;
  ms?: number;
  url?: string;
  error?: string;

  sent?: { method: string; url: string; headers: [string, string][]; body: string };
}

interface Reply {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: [string, string][];
  body?: string;
  bytes?: number;
  ms?: number;
  url?: string;
  error?: string;
}

function enabledPairs(params: Param[], vars: Record<string, string>): [string, string][] {
  return params.filter((p) => p.enabled && p.key.trim()).map((p) => [resolveVars(p.key, vars), resolveVars(p.value, vars)]);
}

function buildUrl(req: PitcherRequest, vars: Record<string, string>): string {
  const base = resolveVars(req.url, vars);
  const qp = enabledPairs(req.params, vars);
  if (qp.length === 0) return base;
  try {
    const u = new URL(base);
    for (const [k, v] of qp) u.searchParams.append(k, v);
    return u.toString();
  } catch {
    const q = qp.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    return base + (base.includes("?") ? "&" : "?") + q;
  }
}

const CONTENT_TYPE: Record<string, string> = {
  json: "application/json",
  xml: "application/xml",
  text: "text/plain",
  html: "text/html",
};

function buildBody(req: PitcherRequest, vars: Record<string, string>): { body: string | null; contentType: string | null } {
  const b = req.body;
  if (b.mode === "none" || b.mode === "binary" || b.mode === "multipart") return { body: null, contentType: null };
  if (b.mode === "raw") return { body: resolveVars(b.raw, vars), contentType: CONTENT_TYPE[b.rawType] ?? "text/plain" };
  if (b.mode === "form") {
    const pairs = enabledPairs(b.form, vars);
    return { body: pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"), contentType: "application/x-www-form-urlencoded" };
  }
  if (b.mode === "graphql") {
    let variables: unknown = {};
    try {
      variables = b.graphql.variables.trim() ? JSON.parse(resolveVars(b.graphql.variables, vars)) : {};
    } catch {
      variables = {};
    }
    return { body: JSON.stringify({ query: resolveVars(b.graphql.query, vars), variables }), contentType: "application/json" };
  }
  return { body: null, contentType: null };
}

function hasHeader(headers: [string, string][], name: string): boolean {
  const l = name.toLowerCase();
  return headers.some(([n]) => n.toLowerCase() === l);
}

function headerValue(headers: [string, string][], name: string): string | undefined {
  const l = name.toLowerCase();
  return headers.find(([n]) => n.toLowerCase() === l)?.[1];
}

function pathAndQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

async function dispatch(
  method: string,
  url: string,
  headers: [string, string][],
  body: string | null,
  throughProxy: boolean,
  followRedirects: boolean,
): Promise<Reply> {
  if (throughProxy) {
    const reply = await bridge.proxyReplay({ method, url, headers, body: body ?? "" }, { followRedirects });
    if (!reply.ok) return { ok: false, error: reply.error ?? "The request could not be sent." };
    return { ok: true, status: reply.status, statusText: reply.statusText, headers: reply.headers, body: reply.body, bytes: reply.bytes, ms: reply.ms, url: reply.url };
  }
  const reply = await bridge.httpSend(url, method, headers, body);
  if (!reply.ok) return { ok: false, error: reply.error };
  return { ok: true, status: reply.status, statusText: reply.statusText, headers: reply.headers, body: reply.body, bytes: reply.bytes, ms: reply.ms, url: reply.url };
}

export async function sendPitcher(req: PitcherRequest, vars: Record<string, string>): Promise<PitcherResponse> {
  const url = buildUrl(req, vars);
  const headers = enabledPairs(req.headers, vars);
  const { body, contentType } = buildBody(req, vars);
  if (contentType && !hasHeader(headers, "content-type")) headers.push(["Content-Type", contentType]);

  if (!hasHeader(headers, "cookie")) {
    const jar = usePitcherCookies.getState().headerFor(url);
    if (jar) headers.push(["Cookie", jar]);
  }

  const finalUrl = await applyAuth(req, headers, url, vars, body);

  let reply = await dispatch(req.method, finalUrl, headers, body, req.throughProxy, req.followRedirects);

  if (reply.ok && reply.status === 401 && req.auth.type === "digest") {
    const challenge = parseDigestChallenge(headerValue(reply.headers ?? [], "www-authenticate") ?? "");
    if (challenge) {
      const auth = buildDigestHeader(
        resolveVars(req.auth.digest.username, vars),
        resolveVars(req.auth.digest.password, vars),
        req.method,
        pathAndQuery(finalUrl),
        challenge,
      );
      const retryHeaders = headers.filter(([n]) => n.toLowerCase() !== "authorization");
      retryHeaders.push(["Authorization", auth]);
      reply = await dispatch(req.method, finalUrl, retryHeaders, body, req.throughProxy, req.followRedirects);
    }
  }

  const sent = { method: req.method, url: finalUrl, headers, body: body ?? "" };
  if (!reply.ok) return { ok: false, error: reply.error, sent };

  usePitcherCookies.getState().ingest(reply.headers ?? [], reply.url ?? finalUrl);

  return {
    ok: true,
    status: reply.status,
    statusText: reply.statusText,
    headers: reply.headers,
    body: reply.body,
    bytes: reply.bytes,
    ms: reply.ms,
    url: reply.url,
    sent,
  };
}
