export interface MinerSecret {
  kind: string;
  value: string;
  line: number;
}

export interface MinerDependency {
  name: string;
  version: string;
}

export interface MinerResult {
  endpoints: string[];
  secrets: MinerSecret[];
  dependencies: MinerDependency[];
}

const SECRET_RULES: { kind: string; regex: RegExp }[] = [
  { kind: "AWS Access Key ID", regex: /\b((?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16})\b/g },
  { kind: "AWS Secret Access Key", regex: /\baws_secret_access_key["']?\s*[:=]\s*["']([A-Za-z0-9/+=]{40})["']/gi },
  { kind: "Google API Key", regex: /\b(AIza[0-9A-Za-z_-]{35})\b/g },
  { kind: "Google OAuth Client ID", regex: /\b([0-9]+-[0-9a-z_]{32}\.apps\.googleusercontent\.com)\b/g },
  { kind: "Firebase Cloud Messaging Key", regex: /\b(AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140})\b/g },
  { kind: "Slack Token", regex: /\b(xox[baprs]-[0-9A-Za-z-]{10,48})\b/g },
  { kind: "Slack Webhook", regex: /(https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9_]+)/g },
  { kind: "GitHub Token", regex: /\b((?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{36,255})\b/g },
  { kind: "GitLab Token", regex: /\b(glpat-[A-Za-z0-9_-]{20})\b/g },
  { kind: "Stripe Secret Key", regex: /\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,99})\b/g },
  { kind: "Stripe Publishable Key", regex: /\b(pk_(?:live|test)_[A-Za-z0-9]{24,99})\b/g },
  { kind: "Twilio Account SID", regex: /\b(AC[0-9a-fA-F]{32})\b/g },
  { kind: "SendGrid API Key", regex: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g },
  { kind: "Mailgun API Key", regex: /\b(key-[0-9a-zA-Z]{32})\b/g },
  { kind: "npm Token", regex: /\b(npm_[A-Za-z0-9]{36})\b/g },
  { kind: "JSON Web Token", regex: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g },
  { kind: "Private Key", regex: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----)/g },
  { kind: "Generic API Key", regex: /(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|auth[_-]?token)["']?\s*[:=]\s*["']([A-Za-z0-9_\-.=]{16,64})["']/gi },
  { kind: "Basic Auth in URL", regex: /(https?:\/\/[^/\s:@"']+:[^/\s:@"']+@[^/\s"']+)/g },
];

const ENDPOINT_RULES: RegExp[] = [
  /["'`]((?:https?:)?\/\/[a-zA-Z0-9.\-_]+(?::\d+)?(?:\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?)["'`]/g,
  /["'`](\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._~:?#[\]@!$&'()*+,;=%-]*)*)["'`]/g,
];

const DEPENDENCY_RULES: { name: string; regex: RegExp }[] = [
  { name: "jQuery", regex: /jquery[.-]?v?(\d+\.\d+(?:\.\d+)?)/i },
  { name: "React", regex: /react(?:\.production|\.development)?[.-]?v?(\d+\.\d+\.\d+)/i },
  { name: "Angular", regex: /angular[.-]?v?(\d+\.\d+\.\d+)/i },
  { name: "Vue.js", regex: /vue[@.-]?v?(\d+\.\d+\.\d+)/i },
  { name: "Bootstrap", regex: /bootstrap[.-]?v?(\d+\.\d+\.\d+)/i },
  { name: "Lodash", regex: /lodash[.-]?v?(\d+\.\d+\.\d+)/i },
  { name: "Moment.js", regex: /moment[.-]?v?(\d+\.\d+\.\d+)/i },
  { name: "D3.js", regex: /\bd3[.-]?v?(\d+\.\d+\.\d+)/i },
  { name: "GSAP", regex: /gsap[.-]?v?(\d+\.\d+\.\d+)/i },
  { name: "Axios", regex: /axios[@/.-]?v?(\d+\.\d+\.\d+)/i },
];

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function looksLikeAsset(path: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp|ico|css|woff2?|ttf|eot|mp4|webm|map)(?:[?#]|$)/i.test(path);
}

export function mineJs(text: string): MinerResult {
  const endpoints = new Set<string>();
  for (const rule of ENDPOINT_RULES) {
    rule.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.exec(text))) {
      const value = match[1];
      if (!value || value.length < 2 || value.length > 400) continue;
      if (looksLikeAsset(value)) continue;
      if (/^\/[a-z]$/i.test(value)) continue;
      endpoints.add(value);
    }
  }

  const secrets: MinerSecret[] = [];
  const secretSeen = new Set<string>();
  for (const rule of SECRET_RULES) {
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(text))) {
      const value = match[1] ?? match[0];
      const key = `${rule.kind}:${value}`;
      if (secretSeen.has(key)) continue;
      secretSeen.add(key);
      secrets.push({ kind: rule.kind, value, line: lineOf(text, match.index) });
      if (secrets.length > 200) break;
    }
  }

  const dependencies: MinerDependency[] = [];
  const depSeen = new Set<string>();
  for (const rule of DEPENDENCY_RULES) {
    const match = rule.regex.exec(text);
    if (!match) continue;
    const version = match[1] ?? "";
    const key = `${rule.name}:${version}`;
    if (depSeen.has(key)) continue;
    depSeen.add(key);
    dependencies.push({ name: rule.name, version });
  }
  const banner = /(?:@license|\/\*!)\s*([A-Za-z][A-Za-z0-9 .-]{1,30}?)\s+v?(\d+\.\d+\.\d+)/g;
  let bannerMatch: RegExpExecArray | null;
  while ((bannerMatch = banner.exec(text))) {
    const name = bannerMatch[1].trim();
    const key = `${name}:${bannerMatch[2]}`;
    if (depSeen.has(key)) continue;
    depSeen.add(key);
    dependencies.push({ name, version: bannerMatch[2] });
    if (dependencies.length > 60) break;
  }

  return {
    endpoints: [...endpoints].sort(),
    secrets,
    dependencies,
  };
}

export function isJavascriptEntry(url: string, headers: [string, string][]): boolean {
  const type = headers.find(([k]) => k.toLowerCase() === "content-type")?.[1]?.toLowerCase() ?? "";
  if (type.includes("javascript") || type.includes("ecmascript")) return true;
  return /\.(?:js|mjs|cjs|jsx)(?:[?#]|$)/i.test(url);
}
