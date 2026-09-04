import { bridge } from "@/lib/bridge";
import { base64Encode } from "@/lib/codec";
import type { PitcherRequest } from "@/stores/pitcher";

import { signAwsV4 } from "./awsSign";
import { resolveVars } from "./vars";

export async function applyAuth(
  req: PitcherRequest,
  headers: [string, string][],
  url: string,
  vars: Record<string, string>,
  body: string | null,
): Promise<string> {
  const a = req.auth;
  let outUrl = url;

  if (a.type === "bearer" && a.bearer.trim()) {
    headers.push(["Authorization", `Bearer ${resolveVars(a.bearer, vars)}`]);
  } else if (a.type === "basic") {
    const u = resolveVars(a.basic.username, vars);
    const p = resolveVars(a.basic.password, vars);
    headers.push(["Authorization", `Basic ${base64Encode(`${u}:${p}`)}`]);
  } else if (a.type === "apikey" && a.apikey.key.trim()) {
    const k = resolveVars(a.apikey.key, vars);
    const v = resolveVars(a.apikey.value, vars);
    if (a.apikey.in === "query") {
      outUrl = addQuery(outUrl, k, v);
    } else {
      headers.push([k, v]);
    }
  } else if (a.type === "oauth2") {
    const token = a.oauth2.token.trim() ? resolveVars(a.oauth2.token, vars) : await fetchOAuthToken(a.oauth2, vars);
    if (token) headers.push(["Authorization", `Bearer ${token}`]);
  } else if (a.type === "awssigv4") {
    const signed = await signAwsV4(req.method, outUrl, headers, body ?? "", {
      accessKey: resolveVars(a.aws.accessKey, vars),
      secretKey: resolveVars(a.aws.secretKey, vars),
      region: resolveVars(a.aws.region, vars) || "us-east-1",
      service: resolveVars(a.aws.service, vars) || "execute-api",
    });
    for (const h of signed) headers.push(h);
  }

  return outUrl;
}

function addQuery(url: string, k: string, v: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return url + (url.includes("?") ? "&" : "?") + `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  }
}

async function fetchOAuthToken(o: PitcherRequest["auth"]["oauth2"], vars: Record<string, string>): Promise<string> {
  const tokenUrl = resolveVars(o.tokenUrl, vars);
  if (!tokenUrl) return "";
  const form: string[] = [];
  const add = (k: string, v: string) => form.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  add("grant_type", o.grant);
  if (o.clientId) add("client_id", resolveVars(o.clientId, vars));
  if (o.clientSecret) add("client_secret", resolveVars(o.clientSecret, vars));
  if (o.scope) add("scope", resolveVars(o.scope, vars));
  if (o.grant === "password") {
    add("username", resolveVars(o.username, vars));
    add("password", resolveVars(o.password, vars));
  }
  const reply = await bridge.httpSend(tokenUrl, "POST", [["Content-Type", "application/x-www-form-urlencoded"]], form.join("&"));
  if (!reply.ok) return "";
  try {
    const j = JSON.parse(reply.body) as { access_token?: unknown };
    return typeof j.access_token === "string" ? j.access_token : "";
  } catch {
    return "";
  }
}
