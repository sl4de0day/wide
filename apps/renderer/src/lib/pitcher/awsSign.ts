

const enc = new TextEncoder();

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function toBuf(s: string): Uint8Array<ArrayBuffer> {
  const src = enc.encode(s);
  const out = new Uint8Array(src.length);
  out.set(src);
  return out;
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toBuf(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, toBuf(data));
  return new Uint8Array(sig);
}

function amzDate(now: Date): { date: string; dateTime: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");

  return { date: iso.slice(0, 8), dateTime: iso };
}

export interface AwsCreds {
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  sessionToken?: string;
}

export async function signAwsV4(
  method: string,
  url: string,
  headers: [string, string][],
  body: string,
  creds: AwsCreds,
  now: Date = new Date(),
): Promise<[string, string][]> {
  const u = new URL(url);
  const { date, dateTime } = amzDate(now);
  const payloadHash = await sha256Hex(body ?? "");

  const canon = new Map<string, string>();
  canon.set("host", u.host);
  canon.set("x-amz-date", dateTime);
  for (const [k, v] of headers) {
    const lk = k.toLowerCase();
    if (lk === "content-type" || lk === "x-amz-content-sha256") canon.set(lk, v.trim());
  }
  canon.set("x-amz-content-sha256", payloadHash);
  if (creds.sessionToken) canon.set("x-amz-security-token", creds.sessionToken);

  const sortedKeys = [...canon.keys()].sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${canon.get(k)}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const qsPairs = [...u.searchParams.entries()].map(([k, v]) => [rfc3986(k), rfc3986(v)] as [string, string]);
  qsPairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const canonicalQuery = qsPairs.map(([k, v]) => `${k}=${v}`).join("&");

  const canonicalUri = (u.pathname || "/").split("/").map(rfc3986).join("/") || "/";
  const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${date}/${creds.region}/${creds.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateTime, scope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(toBuf(`AWS4${creds.secretKey}`), date);
  const kRegion = await hmac(kDate, creds.region);
  const kService = await hmac(kRegion, creds.service);
  const kSigning = await hmac(kService, "aws4_request");
  const sigBytes = await hmac(kSigning, stringToSign);
  const signature = [...sigBytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const out: [string, string][] = [
    ["x-amz-date", dateTime],
    ["x-amz-content-sha256", payloadHash],
    ["Authorization", authorization],
  ];
  if (creds.sessionToken) out.push(["x-amz-security-token", creds.sessionToken]);
  return out;
}
