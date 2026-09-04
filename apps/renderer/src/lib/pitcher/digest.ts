import { md5 } from "./md5";

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

export function parseDigestChallenge(header: string): DigestChallenge | null {
  if (!/digest/i.test(header)) return null;
  const get = (k: string): string | undefined => {
    const r = new RegExp(`${k}\\s*=\\s*"?([^",]+)"?`, "i").exec(header);
    return r ? r[1] : undefined;
  };
  const realm = get("realm");
  const nonce = get("nonce");
  if (!realm || !nonce) return null;
  return { realm, nonce, qop: get("qop"), opaque: get("opaque"), algorithm: get("algorithm") };
}

function randomCnonce(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 8; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildDigestHeader(
  username: string,
  password: string,
  method: string,
  uri: string,
  ch: DigestChallenge,
): string {
  const cnonce = randomCnonce();
  const nc = "00000001";
  let ha1 = md5(`${username}:${ch.realm}:${password}`);
  if ((ch.algorithm ?? "").toLowerCase() === "md5-sess") ha1 = md5(`${ha1}:${ch.nonce}:${cnonce}`);
  const ha2 = md5(`${method.toUpperCase()}:${uri}`);

  const qopList = ch.qop ? ch.qop.split(",").map((q) => q.trim()).filter(Boolean) : [];
  const qop = qopList.includes("auth") ? "auth" : qopList[0];
  const response = qop
    ? md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${ch.nonce}:${ha2}`);

  let header = `Digest username="${username}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${response}"`;
  if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (ch.algorithm) header += `, algorithm=${ch.algorithm}`;
  if (ch.opaque) header += `, opaque="${ch.opaque}"`;
  return header;
}
