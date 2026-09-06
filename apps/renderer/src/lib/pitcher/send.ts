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
  truncated?: boolean;

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
  truncated?: boolean;
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

async function buildBody(
  req: PitcherRequest,
  vars: Record<string, string>,
): Promise<{ body: string | null; contentType: string | null; base64: boolean }> {
  const b = req.body;
  if (b.mode === "none") return { body: null, contentType: null, base64: false };
  if (b.mode === "raw") return { body: resolveVars(b.raw, vars), contentType: CONTENT_TYPE[b.rawType] ?? "text/plain", base64: false };
  if (b.mode === "form") {
    const pairs = enabledPairs(b.form, vars);
    return { body: pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"), contentType: "application/x-www-form-urlencoded", base64: false };
  }
  if (b.mode === "graphql") {
    let variables: unknown = {};
    try {
      variables = b.graphql.variables.trim() ? JSON.parse(resolveVars(b.graphql.variables, vars)) : {};
    } catch {
      variables = {};
    }
    return { body: JSON.stringify({ query: resolveVars(b.graphql.query, vars), variables }), contentType: "application/json", base64: false };
  }
  if (b.mode === "binary") {
    const path = resolveVars(b.binaryPath, vars).trim();
    if (!path) return { body: null, contentType: null, base64: false };
    const file = await bridge.readBinary(path);
    if (!file.ok || !file.base64) return { body: null, contentType: null, base64: false };
    return { body: file.base64, contentType: "application/octet-stream", base64: true };
  }
  if (b.mode === "multipart") {
    const boundary = `----WideFormBoundary${Math.random().toString(36).slice(2)}`;
    const parts: Uint8Array[] = [];
    const enc = new TextEncoder();
    const push = (chunk: string) => parts.push(enc.encode(chunk));
    for (const field of b.form) {
      if (!field.enabled || !field.key.trim()) continue;
      const value = resolveVars(field.value, vars);
      if (value.startsWith("@")) {
        const file = await bridge.readBinary(value.slice(1).trim());
        if (file.ok && file.base64) {
          push(
            `--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"; filename="${file.name ?? "file"}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
          );
          const bin = atob(file.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          parts.push(bytes);
          push("\r\n");
          continue;
        }
      }
      push(`--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"\r\n\r\n${value}\r\n`);
    }
    push(`--${boundary}--\r\n`);
    let total = 0;
    for (const chunk of parts) total += chunk.length;
    const merged = new Uint8Array(total);
    let at = 0;
    for (const chunk of parts) { merged.set(chunk, at); at += chunk.length; }
    let binary = "";
    for (let i = 0; i < merged.length; i += 1) binary += String.fromCharCode(merged[i]);
    return { body: btoa(binary), contentType: `multipart/form-data; boundary=${boundary}`, base64: true };
  }

  return { body: null, contentType: null, base64: false };
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
  insecure: boolean,
  base64: boolean,
): Promise<Reply> {
  if (throughProxy && !base64) {
    const reply = await bridge.proxyReplay({ method, url, headers, body: body ?? "" }, { followRedirects });
    if (!reply.ok) return { ok: false, error: reply.error ?? "The request could not be sent." };
    return { ok: true, status: reply.status, statusText: reply.statusText, headers: reply.headers, body: reply.body, bytes: reply.bytes, ms: reply.ms, url: reply.url, truncated: reply.truncated };
  }
  const reply = await bridge.httpSend(url, method, headers, body, { insecure, bodyBase64: base64 });
  if (!reply.ok) return { ok: false, error: reply.error };
  return { ok: true, status: reply.status, statusText: reply.statusText, headers: reply.headers, body: reply.body, bytes: reply.bytes, ms: reply.ms, url: reply.url, truncated: reply.truncated };
}

export async function sendPitcher(req: PitcherRequest, vars: Record<string, string>, inheritedAuth?: PitcherRequest["auth"]): Promise<PitcherResponse> {
  const effReq = req.auth.type === "inherit" && inheritedAuth ? { ...req, auth: inheritedAuth } : req;
  const url = buildUrl(req, vars);
  const headers = enabledPairs(req.headers, vars);
  const { body, contentType, base64 } = await buildBody(effReq, vars);
  if (contentType && !hasHeader(headers, "content-type")) headers.push(["Content-Type", contentType]);

  if (!hasHeader(headers, "cookie")) {
    const jar = usePitcherCookies.getState().headerFor(url);
    if (jar) headers.push(["Cookie", jar]);
  }

  const finalUrl = await applyAuth(effReq, headers, url, vars, body);

  let reply = await dispatch(req.method, finalUrl, headers, body, req.throughProxy, req.followRedirects, effReq.insecure ?? false, base64);

  if (reply.ok && reply.status === 401 && effReq.auth.type === "digest") {
    const challenge = parseDigestChallenge(headerValue(reply.headers ?? [], "www-authenticate") ?? "");
    if (challenge) {
      const auth = buildDigestHeader(
        resolveVars(effReq.auth.digest.username, vars),
        resolveVars(effReq.auth.digest.password, vars),
        req.method,
        pathAndQuery(finalUrl),
        challenge,
      );
      const retryHeaders = headers.filter(([n]) => n.toLowerCase() !== "authorization");
      retryHeaders.push(["Authorization", auth]);
      reply = await dispatch(req.method, finalUrl, retryHeaders, body, req.throughProxy, req.followRedirects, effReq.insecure ?? false, base64);
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
    truncated: reply.truncated,
    sent,
  };
}
