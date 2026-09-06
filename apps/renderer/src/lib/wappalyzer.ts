export interface WappalyzerRuleset {
  technologies: Record<string, TechnologyDef>;
  categories: Record<string, { name: string }>;
}

interface TechnologyDef {
  cats?: number[];
  html?: string | string[];
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  meta?: Record<string, string | string[]>;
  scriptSrc?: string | string[];
  scripts?: string | string[];
  js?: Record<string, string>;
  url?: string | string[];
  implies?: string | string[];
  icon?: string;
  website?: string;
}

export interface DetectionInput {
  url: string;
  headers: [string, string][];
  cookies: Record<string, string>;
  html: string;
  scriptSrc: string[];
  metas: Record<string, string>;
  js: Record<string, string>;
}

export interface Detection {
  name: string;
  version: string;
  confidence: number;
  categories: string[];
  website: string;
}

interface ParsedPattern {
  regex: RegExp | null;
  version: string;
  confidence: number;
}

const patternCache = new Map<string, ParsedPattern>();

function parsePattern(raw: string): ParsedPattern {
  const cached = patternCache.get(raw);
  if (cached) return cached;
  let regexSource = raw;
  let version = "";
  let confidence = 100;
  const parts = raw.split("\\;");
  if (parts.length > 1) {
    regexSource = parts[0];
    for (const part of parts.slice(1)) {
      if (part.startsWith("version:")) version = part.slice(8);
      else if (part.startsWith("confidence:")) {
        const value = Number(part.slice(11));
        if (Number.isFinite(value)) confidence = value;
      }
    }
  }
  let regex: RegExp | null = null;
  try {
    regex = new RegExp(regexSource.replace(/\//g, "\\/"), "i");
  } catch {
    try {
      regex = new RegExp(regexSource, "i");
    } catch {
      regex = null;
    }
  }
  const parsed = { regex, version, confidence };
  patternCache.set(raw, parsed);
  return parsed;
}

function resolveVersion(template: string, match: RegExpMatchArray | null): string {
  if (!template) return "";
  if (!match) return template.includes("\\") ? "" : template;
  return template.replace(/\\(\d)(?:\?([^:]*):([^)]*))?/g, (_whole, index, ifYes, ifNo) => {
    const group = match[Number(index)];
    if (ifYes !== undefined) return group ? ifYes : ifNo ?? "";
    return group ?? "";
  });
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

interface Hit {
  confidence: number;
  version: string;
}

function testPatterns(patterns: string[], subjects: string[]): Hit | null {
  let best: Hit | null = null;
  for (const raw of patterns) {
    const parsed = parsePattern(raw);
    if (!parsed.regex) continue;
    for (const subject of subjects) {
      if (typeof subject !== "string") continue;
      const match = subject.match(parsed.regex);
      if (!match) continue;
      const version = resolveVersion(parsed.version, match);
      if (!best || parsed.confidence > best.confidence || (version && !best.version)) {
        best = { confidence: parsed.confidence, version: version || (best ? best.version : "") };
      }
    }
  }
  return best;
}

function categoryNames(cats: number[] | undefined, categories: WappalyzerRuleset["categories"]): string[] {
  if (!cats) return [];
  const names: string[] = [];
  for (const id of cats) {
    const entry = categories[String(id)];
    if (entry && entry.name) names.push(entry.name);
  }
  return names;
}

export function analyze(input: DetectionInput, ruleset: WappalyzerRuleset): Detection[] {
  const found = new Map<string, { confidence: number; version: string }>();
  const bump = (name: string, hit: Hit) => {
    const current = found.get(name);
    if (!current) {
      found.set(name, { confidence: Math.min(100, hit.confidence), version: hit.version });
      return;
    }
    current.confidence = Math.min(100, current.confidence + hit.confidence);
    if (hit.version && !current.version) current.version = hit.version;
  };

  const headerMap = new Map<string, string[]>();
  for (const [key, value] of input.headers) {
    const lower = key.toLowerCase();
    const list = headerMap.get(lower) ?? [];
    list.push(value);
    headerMap.set(lower, list);
  }

  const technologies = ruleset.technologies;
  for (const name of Object.keys(technologies)) {
    const def = technologies[name];
    if (!def) continue;

    const urlHit = testPatterns(toArray(def.url), [input.url]);
    if (urlHit) bump(name, urlHit);

    const htmlHit = testPatterns(toArray(def.html), [input.html]);
    if (htmlHit) bump(name, htmlHit);

    const scriptHit = testPatterns([...toArray(def.scriptSrc), ...toArray(def.scripts)], input.scriptSrc);
    if (scriptHit) bump(name, scriptHit);

    if (def.headers) {
      for (const header of Object.keys(def.headers)) {
        const values = headerMap.get(header.toLowerCase());
        if (!values) continue;
        const hit = testPatterns([def.headers[header]], values);
        if (hit) bump(name, hit);
      }
    }

    if (def.cookies) {
      for (const cookie of Object.keys(def.cookies)) {
        const value = input.cookies[cookie];
        if (value === undefined) continue;
        const hit = testPatterns([def.cookies[cookie] || ".*"], [value || cookie]);
        if (hit) bump(name, hit);
      }
    }

    if (def.meta) {
      for (const metaName of Object.keys(def.meta)) {
        const content = input.metas[metaName.toLowerCase()];
        if (content === undefined) continue;
        const hit = testPatterns(toArray(def.meta[metaName]), [content]);
        if (hit) bump(name, hit);
      }
    }

    if (def.js) {
      for (const key of Object.keys(def.js)) {
        const value = input.js[key];
        if (value === undefined) continue;
        const hit = testPatterns([def.js[key] || ".*"], [String(value)]);
        if (hit) bump(name, hit);
      }
    }
  }

  const withImplies = new Map(found);
  let changed = true;
  let guard = 0;
  while (changed && guard < 8) {
    changed = false;
    guard += 1;
    for (const name of [...withImplies.keys()]) {
      const def = technologies[name];
      if (!def) continue;
      for (const implied of toArray(def.implies)) {
        const parsed = parsePattern(implied);
        const impliedName = implied.split("\\;")[0];
        if (!withImplies.has(impliedName) && technologies[impliedName]) {
          withImplies.set(impliedName, { confidence: parsed.confidence, version: "" });
          changed = true;
        }
      }
    }
  }

  const out: Detection[] = [];
  for (const [name, info] of withImplies) {
    const def = technologies[name];
    out.push({
      name,
      version: info.version,
      confidence: info.confidence,
      categories: categoryNames(def?.cats, ruleset.categories),
      website: def?.website ?? "",
    });
  }
  out.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  return out;
}

export const PAGE_SIGNAL_SCRIPT = `(() => {
  const scriptSrc = [];
  for (const s of document.querySelectorAll("script[src]")) scriptSrc.push(s.src);
  const metas = {};
  for (const m of document.querySelectorAll("meta[name], meta[property]")) {
    const key = (m.getAttribute("name") || m.getAttribute("property") || "").toLowerCase();
    if (key) metas[key] = m.getAttribute("content") || "";
  }
  const cookies = {};
  for (const pair of document.cookie.split(";")) {
    const eq = pair.indexOf("=");
    if (eq > 0) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  const probes = ["jQuery","$","React","ReactDOM","Vue","angular","ng","__NEXT_DATA__","__NUXT__","Shopify","wp","Drupal","Backbone","_","gtag","ga","dataLayer","Stripe","gsap","Alpine","Svelte","webpackChunk","moment","axios","Modernizr","WOW"];
  const js = {};
  for (const key of probes) {
    try {
      const value = window[key];
      if (value !== undefined) js[key] = typeof value === "object" ? "1" : String(value).slice(0, 60);
    } catch (e) { void e; }
  }
  return { html: document.documentElement.outerHTML.slice(0, 200000), scriptSrc, metas, cookies, js };
})()`;

export function signalsFromResponse(url: string, headers: [string, string][], body: string): DetectionInput {
  const cookies: Record<string, string> = {};
  const scriptSrc: string[] = [];
  const metas: Record<string, string> = {};
  for (const [key, value] of headers) {
    if (key.toLowerCase() === "set-cookie") {
      const eq = value.indexOf("=");
      if (eq > 0) cookies[value.slice(0, eq).trim()] = value.slice(eq + 1).split(";")[0].trim();
    }
  }
  const scriptRe = /<script[^>]+src=["']?([^"'\s>]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(body))) scriptSrc.push(match[1]);
  const metaRe = /<meta[^>]+(?:name|property)=["']?([^"'\s>]+)["']?[^>]+content=["']?([^"'>]*)/gi;
  while ((match = metaRe.exec(body))) metas[match[1].toLowerCase()] = match[2];
  return { url, headers, cookies, html: body, scriptSrc, metas, js: {} };
}
