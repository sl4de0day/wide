import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import type { Diagnostic } from "@/lib/bridge";
import { useDiagnostics } from "@/stores/diagnostics";
import { useSettings } from "@/stores/settings";
import type { Rule } from "./rules";
import { runRouteAudit } from "./routes";
import { compose, isSecurity, runTextPass, serializeTextRule, type SerializedTextRule } from "./shared";
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
          if (rule.notMatch && rule.notMatch.test(text)) continue;
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

        this.schedule(300);

        this.unsubscribe = useSettings.subscribe((state, previous) => {
          if (state.securityLint !== previous.securityLint) this.schedule(0);
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

          const store = useDiagnostics.getState();
          store.setFor(filePath, "security", [...node.security, ...flow.security]);
          store.setFor(filePath, "inspection", [...node.inspection, ...flow.inspection]);
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
