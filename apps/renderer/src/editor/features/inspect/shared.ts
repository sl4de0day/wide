import type { Text } from "@codemirror/state";

import type { Diagnostic } from "@/lib/bridge";
import type { Rule } from "./rules";
import { translateRuleText } from "./rulesI18n";

export function compose(rule: Rule): string {
  let message = `${translateRuleText(rule.message)}\n\n${translateRuleText(rule.why)}`;
  if (rule.fix) message += `\n\nFix: ${translateRuleText(rule.fix)}`;
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

const IGNORE_MARK = /wide-ignore(?:-(file|next-line))?(?:\[([^\]]*)\])?/;

export interface Suppressions {
  whole: Set<string> | null;
  perLine: Map<number, Set<string>>;
}

export const NO_SUPPRESSIONS: Suppressions = { whole: null, perLine: new Map() };

export function readSuppressions(text: string, ext: string): Suppressions {
  const perLine = new Map<number, Set<string>>();
  let whole: Set<string> | null = null;
  const lines = text.split("\n");
  const mark = (n: number, ids: string[] | null) => {
    const set = perLine.get(n) ?? new Set<string>();
    if (ids === null) set.add("*");
    else for (const id of ids) set.add(id);
    perLine.set(n, set);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const found = IGNORE_MARK.exec(lines[i]);
    if (!found) continue;
    const ids = found[2] ? found[2].split(",").map((part) => part.trim()).filter(Boolean) : null;
    if (found[1] === "file") {
      if (!whole) whole = new Set<string>();
      if (ids === null) whole.add("*");
      else for (const id of ids) whole.add(id);
      continue;
    }
    const standalone = found[1] === "next-line" || isCommentLine(lines[i], ext);
    mark(standalone ? i + 2 : i + 1, ids);
  }
  return { whole, perLine };
}

export function isSuppressed(sup: Suppressions, line: number, ruleId: string): boolean {
  if (sup.whole && (sup.whole.has("*") || sup.whole.has(ruleId))) return true;
  const set = sup.perLine.get(line);
  return Boolean(set && (set.has("*") || set.has(ruleId)));
}

export function ruleIdOf(message: string): string {
  const found = /\(([^()\s]+)\)\s*$/.exec(message);
  return found ? found[1] : "";
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
      if (
        rule.notMatch &&
        rule.notMatch.test(line.text) &&
        !(rule.notMatchUnless && rule.notMatchUnless.test(line.text))
      ) {
        continue;
      }
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
  notMatchUnlessSource?: string;
  notMatchUnlessFlags?: string;
  confidence?: "high" | "medium" | "low";
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
    notMatchUnlessSource: rule.notMatchUnless?.source,
    notMatchUnlessFlags: rule.notMatchUnless?.flags,
    confidence: rule.confidence,
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
    notMatchUnless: s.notMatchUnlessSource
      ? new RegExp(s.notMatchUnlessSource, s.notMatchUnlessFlags)
      : undefined,
    confidence: s.confidence,
    message: s.message,
    why: s.why,
    fix: s.fix,
    cwe: s.cwe,
  };
}
