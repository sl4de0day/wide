

const utf8 = new TextDecoder();
const bytesEnc = new TextEncoder();

export function bytesToBase64(input: Uint8Array): string {
  let binary = "";
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(input: string): Uint8Array {
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function normaliseBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  return remainder ? padded + "=".repeat(4 - remainder) : padded;
}

export function base64Encode(value: string): string {
  return bytesToBase64(bytesEnc.encode(value));
}
export function base64Decode(value: string): string {
  return utf8.decode(base64ToBytes(value.trim()));
}
export function base64UrlEncode(value: string): string {
  return bytesToBase64(bytesEnc.encode(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function base64UrlDecode(value: string): string {
  return utf8.decode(base64ToBytes(normaliseBase64Url(value.trim())));
}
export function urlEncode(value: string): string {
  return encodeURIComponent(value);
}
export function urlDecode(value: string): string {
  return decodeURIComponent(value.trim());
}

export function urlEncodeAll(value: string): string {
  return [...bytesEnc.encode(value)].map((b) => "%" + b.toString(16).padStart(2, "0").toUpperCase()).join("");
}
export function hexEncode(value: string): string {
  return [...bytesEnc.encode(value)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function hexDecode(value: string): string {
  return utf8.decode(
    Uint8Array.from(value.trim().replace(/[^0-9a-fA-F]/g, "").match(/.{1,2}/g) ?? [], (b) => parseInt(b, 16)),
  );
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function htmlEncode(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
export function htmlDecode(value: string): string {

  const el = document.createElement("textarea");
  el.innerHTML = value;
  return el.value;
}

export type Transform = { id: string; label: string; run: (value: string) => string };

export const TRANSFORMS: Transform[] = [
  { id: "b64d", label: "Base64 decode", run: base64Decode },
  { id: "b64e", label: "Base64 encode", run: base64Encode },
  { id: "b64ud", label: "Base64URL decode", run: base64UrlDecode },
  { id: "b64ue", label: "Base64URL encode", run: base64UrlEncode },
  { id: "urld", label: "URL decode", run: urlDecode },
  { id: "urle", label: "URL encode", run: urlEncode },
  { id: "hexd", label: "Hex decode", run: hexDecode },
  { id: "hexe", label: "Hex encode", run: hexEncode },
  { id: "htmld", label: "HTML decode", run: htmlDecode },
  { id: "htmle", label: "HTML encode", run: htmlEncode },
];

export function decodeJwt(value: string): { header: string; payload: string } | null {
  const parts = value.trim().split(".");
  if (parts.length < 2) return null;
  try {
    const header = JSON.parse(utf8.decode(base64ToBytes(normaliseBase64Url(parts[0]))));
    const payload = JSON.parse(utf8.decode(base64ToBytes(normaliseBase64Url(parts[1]))));
    const withTimes = (obj: Record<string, unknown>) => {
      const copy: Record<string, unknown> = { ...obj };
      for (const key of ["exp", "iat", "nbf"]) {
        if (typeof copy[key] === "number") {
          copy[`${key} (readable)`] = new Date((copy[key] as number) * 1000).toISOString();
        }
      }
      return copy;
    };
    return {
      header: JSON.stringify(header, null, 2),
      payload: JSON.stringify(withTimes(payload as Record<string, unknown>), null, 2),
    };
  } catch {
    return null;
  }
}

export function hexDump(input: Uint8Array | string): string {
  const data = typeof input === "string" ? bytesEnc.encode(input) : input;
  const lines: string[] = [];
  for (let offset = 0; offset < data.length; offset += 16) {
    const slice = data.subarray(offset, offset + 16);
    const hex: string[] = [];
    let ascii = "";
    for (let i = 0; i < 16; i += 1) {
      if (i < slice.length) {
        const b = slice[i];
        hex.push(b.toString(16).padStart(2, "0"));
        ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
      } else {
        hex.push("  ");
      }
      if (i === 7) hex.push("");
    }
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex.join(" ")}  ${ascii}`);
  }
  return lines.join("\n");
}

export function md5Hex(input: string): string {
  const msg = bytesEnc.encode(input);
  function rol(x: number, c: number): number {
    return (x << c) | (x >>> (32 - c));
  }
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const bitLen = msg.length * 8;
  const withOne = new Uint8Array((((msg.length + 8) >> 6) + 1) * 64);
  withOne.set(msg);
  withOne[msg.length] = 0x80;
  const view = new DataView(withOne.buffer);
  view.setUint32(withOne.length - 8, bitLen >>> 0, true);
  view.setUint32(withOne.length - 4, Math.floor(bitLen / 4294967296), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < withOne.length; off += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i += 1) M[i] = view.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i += 1) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + rol(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0 >>> 0, true);
  ov.setUint32(4, b0 >>> 0, true);
  ov.setUint32(8, c0 >>> 0, true);
  ov.setUint32(12, d0 >>> 0, true);
  return [...out].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function subtleHash(algo: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512", value: string): Promise<string> {
  const digest = await crypto.subtle.digest(algo, bytesEnc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type AsyncTransform = { id: string; label: string; run: (value: string) => string | Promise<string> };

export const HASH_TRANSFORMS: AsyncTransform[] = [
  { id: "md5", label: "MD5", run: (v) => md5Hex(v) },
  { id: "sha1", label: "SHA-1", run: (v) => subtleHash("SHA-1", v) },
  { id: "sha256", label: "SHA-256", run: (v) => subtleHash("SHA-256", v) },
  { id: "sha512", label: "SHA-512", run: (v) => subtleHash("SHA-512", v) },
];

export function smartDecode(value: string): { label: string; output: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (decodeJwt(trimmed)) {
    const jwt = decodeJwt(trimmed)!;
    return { label: "JWT", output: `${jwt.header}\n\n${jwt.payload}` };
  }
  if (/%[0-9a-fA-F]{2}/.test(trimmed)) {
    try {
      const out = urlDecode(trimmed);
      if (out !== trimmed) return { label: "URL", output: out };
    } catch {
      void 0;
    }
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0 && trimmed.length >= 4) {
    try {
      const out = hexDecode(trimmed);
      if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(out)) return { label: "Hex", output: out };
    } catch {
      void 0;
    }
  }
  if (/^[A-Za-z0-9+/_-]{8,}={0,2}$/.test(trimmed)) {
    try {
      const out = /[-_]/.test(trimmed) ? base64UrlDecode(trimmed) : base64Decode(trimmed);
      if (out && /^[\x09\x0a\x0d\x20-\x7e]*$/.test(out)) return { label: "Base64", output: out };
    } catch {
      void 0;
    }
  }
  return null;
}
