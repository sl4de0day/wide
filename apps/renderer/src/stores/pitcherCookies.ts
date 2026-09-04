import { create } from "zustand";

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure?: boolean;

  hostOnly?: boolean;
}

const KEY = "wide.pitcher.cookies";
function load(): { cookies: Cookie[]; enabled: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { cookies: [], enabled: true };
    const parsed = JSON.parse(raw);
    return { cookies: Array.isArray(parsed.cookies) ? parsed.cookies : [], enabled: parsed.enabled !== false };
  } catch {
    return { cookies: [], enabled: true };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

function domainMatch(host: string, domain: string): boolean {
  const d = domain.replace(/^\./, "").toLowerCase();
  const h = host.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}
function pathMatch(reqPath: string, cookiePath: string): boolean {
  if (cookiePath === "/" || reqPath === cookiePath) return true;
  return reqPath.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);
}

export function parseSetCookie(header: string, url: string): Cookie | null {
  const parts = header.split(";").map((p) => p.trim());
  const first = parts.shift();
  if (!first) return null;
  const eq = first.indexOf("=");
  if (eq < 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;
  const host = hostOf(url);

  const cookie: Cookie = { name, value, domain: host, path: "/", hostOnly: true };
  for (const attr of parts) {
    const [k, ...rest] = attr.split("=");
    const key = k.trim().toLowerCase();
    const v = rest.join("=").trim();
    if (key === "domain" && v) {
      const domain = v.replace(/^\./, "").toLowerCase();

      if (domainMatch(host, domain)) {
        cookie.domain = domain;
        cookie.hostOnly = false;
      }
    } else if (key === "path" && v) cookie.path = v;
    else if (key === "secure") cookie.secure = true;
    else if (key === "max-age") {
      const n = Number(v);
      if (!Number.isNaN(n)) cookie.expires = Date.now() + n * 1000;
    } else if (key === "expires" && v) {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) cookie.expires = t;
    }
  }
  return cookie;
}

interface CookieState {
  cookies: Cookie[];
  enabled: boolean;
  setEnabled(on: boolean): void;
  clear(): void;
  remove(name: string, domain: string, path: string): void;

  ingest(headers: [string, string][], url: string): void;

  headerFor(url: string): string;
}

function persist(cookies: Cookie[], enabled: boolean): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ cookies, enabled }));
  } catch {

  }
}

export const usePitcherCookies = create<CookieState>((set, get) => ({
  ...load(),

  setEnabled: (on) =>
    set((s) => {
      persist(s.cookies, on);
      return { enabled: on };
    }),

  clear: () =>
    set(() => {
      persist([], get().enabled);
      return { cookies: [] };
    }),

  remove: (name, domain, path) =>
    set((s) => {
      const cookies = s.cookies.filter((c) => !(c.name === name && c.domain === domain && c.path === path));
      persist(cookies, s.enabled);
      return { cookies };
    }),

  ingest: (headers, url) => {
    const fresh: Cookie[] = [];
    for (const [name, value] of headers) {
      if (name.toLowerCase() !== "set-cookie") continue;
      const c = parseSetCookie(value, url);
      if (c) fresh.push(c);
    }
    if (fresh.length === 0) return;
    set((s) => {
      const cookies = [...s.cookies];
      for (const c of fresh) {
        const i = cookies.findIndex((x) => x.name === c.name && x.domain === c.domain && x.path === c.path);
        if (i >= 0) cookies[i] = c;
        else cookies.push(c);
      }
      persist(cookies, s.enabled);
      return { cookies };
    });
  },

  headerFor: (url) => {
    const s = get();
    if (!s.enabled) return "";
    const host = hostOf(url);
    const path = pathOf(url);
    const now = Date.now();
    const isHttps = url.toLowerCase().startsWith("https:");
    const matches = s.cookies.filter((c) => {
      if (c.expires && c.expires <= now) return false;
      if (c.secure && !isHttps) return false;

      const hostOk = c.hostOnly ? host.toLowerCase() === c.domain.toLowerCase() : domainMatch(host, c.domain);
      return hostOk && pathMatch(path, c.path);
    });
    return matches.map((c) => `${c.name}=${c.value}`).join("; ");
  },
}));
