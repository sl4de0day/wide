

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
