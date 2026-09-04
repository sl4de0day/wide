import type { Text } from "@codemirror/state";

import type { Diagnostic } from "@/lib/bridge";
import type { Rule } from "./rules";

export function compose(rule: Rule): string {
  let message = `${rule.message}\n\n${rule.why}`;
  if (rule.fix) message += `\n\nFix: ${rule.fix}`;
  message += `\n\n${rule.cwe ? `${rule.cwe} · ` : ""}(${rule.id})`;
  return message;
}

export const isSecurity = (rule: Rule) => (rule.category ?? "security") === "security";

const COMMENT_PREFIXES: Record<string, string[]> = {
  sql: ["--"],
  erl: ["%"],
  hrl: ["%"],
  py: ["#"],
  pyi: ["#"],
  pyw: ["#"],
  rb: ["#"],
  yml: ["#"],
  yaml: ["#"],
};

export function isCommentLine(line: string, ext: string): boolean {
  const trimmed = line.trimStart();
  if (!trimmed) return false;

  const prefixes = COMMENT_PREFIXES[ext] ?? ["//"];
  if (prefixes.some((prefix) => trimmed.startsWith(prefix))) return true;

  return trimmed.startsWith("/*") || trimmed.startsWith("*");
}

const compiledText = new WeakMap<Rule, RegExp>();
function textRegex(rule: Rule): RegExp {
  let re = compiledText.get(rule);
  if (!re) {
    const flags = rule.text!.flags.includes("g") ? rule.text!.flags : `${rule.text!.flags}g`;
    re = new RegExp(rule.text!.source, flags);
    compiledText.set(rule, re);
  }
  return re;
}

export function runTextPass(
  doc: Text,
  rules: Rule[],
  ext: string,
  securityOn: boolean,
): { security: Diagnostic[]; inspection: Diagnostic[] } {
  const security: Diagnostic[] = [];
  const inspection: Diagnostic[] = [];
  const textRules = rules.filter(
    (rule) =>
      rule.text &&
      Array.isArray(rule.languages) &&
      rule.languages.includes(ext) &&
      (securityOn || !isSecurity(rule)),
  );
  if (textRules.length === 0) return { security, inspection };

  const seen = new Set<string>();
  const push = (from: number, to: number, rule: Rule) => {
    const key = `${rule.id}:${from}`;
    if (seen.has(key)) return;
    seen.add(key);
    (isSecurity(rule) ? security : inspection).push({ from, to, severity: rule.severity, message: compose(rule) });
  };

  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    if (isCommentLine(line.text, ext)) continue;
    for (const rule of textRules) {
      if (rule.notMatch && rule.notMatch.test(line.text)) continue;
      const re = textRegex(rule);
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line.text)) !== null) {
        const from = line.from + match.index;
        push(from, from + match[0].length, rule);
        if (match.index === re.lastIndex) re.lastIndex += 1;
      }
    }
  }
  return { security, inspection };
}

export interface SerializedTextRule {
  id: string;
  languages: string[];
  severity: Rule["severity"];
  category: "security" | "quality";
  textSource: string;
  textFlags: string;
  notMatchSource?: string;
  notMatchFlags?: string;
  message: string;
  why: string;
  fix?: string;
  cwe?: string;
}

export function serializeTextRule(rule: Rule): SerializedTextRule | null {
  if (!rule.text) return null;
  return {
    id: rule.id,
    languages: Array.isArray(rule.languages) ? rule.languages : [],
    severity: rule.severity,
    category: isSecurity(rule) ? "security" : "quality",
    textSource: rule.text.source,
    textFlags: rule.text.flags,
    notMatchSource: rule.notMatch?.source,
    notMatchFlags: rule.notMatch?.flags,
    message: rule.message,
    why: rule.why ?? "",
    fix: rule.fix,
    cwe: rule.cwe,
  };
}

export function deserializeTextRule(s: SerializedTextRule): Rule {
  return {
    id: s.id,
    languages: s.languages,
    severity: s.severity,
    category: s.category,
    text: new RegExp(s.textSource, s.textFlags),
    notMatch: s.notMatchSource ? new RegExp(s.notMatchSource, s.notMatchFlags) : undefined,
    message: s.message,
    why: s.why,
    fix: s.fix,
    cwe: s.cwe,
  };
}
