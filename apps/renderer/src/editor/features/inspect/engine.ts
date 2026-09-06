import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import type { Diagnostic } from "@/lib/bridge";
import { useDiagnostics } from "@/stores/diagnostics";
import { useSettings } from "@/stores/settings";
import type { Rule } from "./rules";
import { runRouteAudit } from "./routes";
import {
  compose,
  isSecurity,
  isSuppressed,
  NO_SUPPRESSIONS,
  readSuppressions,
  ruleIdOf,
  runTextPass,
  serializeTextRule,
  type SerializedTextRule,
  type Suppressions,
} from "./shared";
import { loadRuleDictionary } from "./rulesI18n";
import { runTaint, runToctou, TAINT_LANGUAGES } from "./taint";
import { runFlow, setWorkerProjectRules, type FlowResult } from "./workerClient";

let builtInPromise: Promise<Rule[]> | null = null;
function loadBuiltInRules(): Promise<Rule[]> {
  if (!builtInPromise) builtInPromise = import("./rules").then((m) => m.BUILT_IN_RULES);
  return builtInPromise;
}

function runNodePass(view: EditorView, rules: Rule[], ext: string, securityOn: boolean): FlowResult {
  const security: Diagnostic[] = [];
  const inspection: Diagnostic[] = [];
  const nodeRules = rules.filter(
    (rule) =>
      rule.node &&
      !rule.text &&
      Array.isArray(rule.languages) &&
      rule.languages.includes(ext) &&
      (securityOn || !isSecurity(rule)),
  );
  if (nodeRules.length === 0) return { security, inspection };

  const doc = view.state.doc;
  const seen = new Set<string>();
  const push = (from: number, to: number, rule: Rule) => {
    const key = `${rule.id}:${from}`;
    if (seen.has(key)) return;
    seen.add(key);
    (isSecurity(rule) ? security : inspection).push({ from, to, severity: rule.severity, message: compose(rule) });
  };

  const tree = syntaxTree(view.state);
  if (tree.length > 0) {
    tree.iterate({
      enter(node) {
        for (const rule of nodeRules) {
          if (node.name !== rule.node) continue;
          const text = doc.sliceString(node.from, node.to);
          if (rule.match && !rule.match.test(text)) continue;
          if (
            rule.notMatch &&
            rule.notMatch.test(text) &&
            !(rule.notMatchUnless && rule.notMatchUnless.test(text))
          ) {
            continue;
          }
          if (rule.within) {
            const parent = node.node.parent;
            if (!parent || parent.name !== rule.within) continue;
          }
          push(node.from, node.to, rule);
        }
      },
    });
  }
  return { security, inspection };
}

interface ProjectRule {
  id?: string;
  languages?: string[];
  severity?: string;
  category?: string;
  node?: string;
  match?: string;
  within?: string;
  text?: string;
  notMatch?: string;
  message?: string;
  why?: string;
  fix?: string;
  cwe?: string;
}

export function parseProjectRules(source: string): { rules: Rule[]; errors: string[] } {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return { rules: [], errors: [`.wide/rules.json is not valid JSON: ${(error as Error).message}`] };
  }
  if (!Array.isArray(raw)) {
    return { rules: [], errors: [".wide/rules.json must be a list of rules."] };
  }

  const rules: Rule[] = [];
  raw.forEach((entry: ProjectRule, index) => {

    if (!entry || typeof entry !== "object") {
      errors.push(`rule ${index + 1} is not an object.`);
      return;
    }
    const where = entry.id ? `rule "${entry.id}"` : `rule ${index + 1}`;

    if ((!entry.node && !entry.text) || (!entry.match && !entry.text) || !entry.message) {
      errors.push(`${where} needs "message" and either "node"+"match" or "text".`);
      return;
    }

    if (entry.languages !== undefined && !Array.isArray(entry.languages)) {
      errors.push(`${where} has a "languages" that is not a list.`);
      return;
    }
    let match: RegExp | undefined;
    let text: RegExp | undefined;
    let notMatch: RegExp | undefined;
    try {
      if (entry.match) match = new RegExp(entry.match);
      if (entry.text) text = new RegExp(entry.text);
      if (entry.notMatch) notMatch = new RegExp(entry.notMatch);
    } catch (error) {
      errors.push(`${where} has an invalid pattern: ${(error as Error).message}`);
      return;
    }
    rules.push({
      id: entry.id ?? `project/rule-${index + 1}`,
      languages: entry.languages ?? [],
      severity: entry.severity === "error" ? "error" : entry.severity === "info" ? "info" : "warning",
      category: entry.category === "quality" ? "quality" : "security",
      node: entry.node,
      match,
      within: entry.within,
      text,
      notMatch,
      message: entry.message,
      why: entry.why ?? "",
      fix: entry.fix,
      cwe: entry.cwe,
    });
  });
  return { rules, errors };
}

const RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

export interface SecurityConfig {
  disable: Set<string>;
  severity: Record<string, "error" | "warning" | "info">;
  minConfidence: "high" | "medium" | "low";
}

let securityConfig: SecurityConfig = { disable: new Set(), severity: {}, minConfidence: "low" };

export function parseSecurityConfig(source: string): SecurityConfig {
  const empty: SecurityConfig = { disable: new Set(), severity: {}, minConfidence: "low" };
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return empty;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const entry = raw as { disable?: unknown; severity?: unknown; minConfidence?: unknown };
  return {
    disable: new Set(
      Array.isArray(entry.disable) ? entry.disable.filter((v): v is string => typeof v === "string") : [],
    ),
    severity:
      entry.severity && typeof entry.severity === "object" && !Array.isArray(entry.severity)
        ? (entry.severity as Record<string, "error" | "warning" | "info">)
        : {},
    minConfidence:
      entry.minConfidence === "high" || entry.minConfidence === "medium" ? entry.minConfidence : "low",
  };
}

export function setSecurityConfig(config: SecurityConfig): void {
  securityConfig = config;
}

const ruleConfidence = new Map<string, string>([
  ["wide/route-missing-auth", "low"],
  ["wide/route-missing-rate-limit", "low"],
  ["wide/toctou-race", "low"],
]);

function applyPolicy(list: Diagnostic[], sup: Suppressions, doc: { lineAt(pos: number): { number: number } }): Diagnostic[] {
  const floor = RANK[securityConfig.minConfidence] ?? 0;
  const kept: Diagnostic[] = [];
  for (const item of list) {
    const id = ruleIdOf(item.message);
    if (id && securityConfig.disable.has(id)) continue;
    if (id) {
      const confidence = ruleConfidence.get(id);
      if (confidence && (RANK[confidence] ?? 2) < floor) continue;
    }
    let line: number;
    try {
      line = doc.lineAt(item.from).number;
    } catch {
      line = 0;
    }
    if (line && isSuppressed(sup, line, id)) continue;
    const override = id ? securityConfig.severity[id] : undefined;
    kept.push(override ? { ...item, severity: override } : item);
  }
  return kept;
}

let confidenceLoaded = false;
let projectRules: Rule[] = [];

export function setProjectRules(rules: Rule[]): void {
  projectRules = rules;

  const serial = rules.map(serializeTextRule).filter((r): r is SerializedTextRule => r !== null);
  setWorkerProjectRules(serial);
}

export function inspections(ext: string, filePath: string): Extension {
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;
      unsubscribe: (() => void) | null = null;
      destroyed = false;
      reqSeq = 0;

      constructor(readonly view: EditorView) {

        void loadRuleDictionary(useSettings.getState().language);
        this.schedule(300);

        this.unsubscribe = useSettings.subscribe((state, previous) => {
          if (state.securityLint !== previous.securityLint) this.schedule(0);
          if (state.language !== previous.language) {
            void loadRuleDictionary(state.language).then(() => this.schedule(0));
          }
        });
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.schedule(400);
      }

      flowOnMain(all: Rule[], securityOn: boolean): FlowResult {
        const doc = this.view.state.doc;
        const { security, inspection } = runTextPass(doc, all, ext, securityOn);
        if (securityOn && TAINT_LANGUAGES.has(ext)) {
          security.push(...runTaint(doc), ...runToctou(doc), ...runRouteAudit(doc));
        }
        return { security, inspection };
      }

      schedule(delay: number) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(async () => {
          this.timer = null;
          const reqId = (this.reqSeq += 1);
          const builtIn = await loadBuiltInRules();
          if (this.destroyed || reqId !== this.reqSeq) return;
          const all = projectRules.length ? [...builtIn, ...projectRules] : builtIn;
          if (!confidenceLoaded) {
            confidenceLoaded = true;
            for (const rule of builtIn) if (rule.confidence) ruleConfidence.set(rule.id, rule.confidence);
          }
          const securityOn = useSettings.getState().securityLint;

          const node = runNodePass(this.view, all, ext, securityOn);

          const docText = this.view.state.doc.toString();
          let flow: FlowResult;
          try {
            flow = await runFlow(docText, ext, securityOn);
          } catch {
            flow = this.flowOnMain(all, securityOn);
          }

          if (this.destroyed || reqId !== this.reqSeq) return;

          const doc = this.view.state.doc;
          const sup = securityOn ? readSuppressions(docText, ext) : NO_SUPPRESSIONS;
          const store = useDiagnostics.getState();
          store.setFor(filePath, "security", applyPolicy([...node.security, ...flow.security], sup, doc));
          store.setFor(filePath, "inspection", applyPolicy([...node.inspection, ...flow.inspection], sup, doc));
        }, delay);
      }

      destroy() {
        this.destroyed = true;
        if (this.timer) clearTimeout(this.timer);
        this.unsubscribe?.();
        const store = useDiagnostics.getState();
        store.setFor(filePath, "security", []);
        store.setFor(filePath, "inspection", []);
      }
    },
  );
}
