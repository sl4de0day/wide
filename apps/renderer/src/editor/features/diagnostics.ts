import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

import { t } from "@/lib/i18n";
import { extname } from "@/lib/utils";
import { useDiagnostics } from "@/stores/diagnostics";

const HASH_EXTS = new Set(["py", "pyi", "pyw", "rb", "rake", "sh", "bash", "zsh", "yaml", "yml", "toml", "tf", "tfvars", "env", "dockerfile", "ps1"]);

function commentPrefix(path: string): string {
  const ext = extname(path).toLowerCase();
  if (HASH_EXTS.has(ext)) return "#";
  if (ext === "sql") return "--";
  return "//";
}

interface Fix {
  name: string;
  apply: (view: EditorView, from: number, to: number) => void;
}

function findBlank(text: string, offset: number): number {
  const lower = text.toLowerCase();
  const at = lower.indexOf("_blank", Math.max(0, offset));
  return at === -1 ? lower.indexOf("_blank") : at;
}

function buildFix(ruleId: string): Fix | null {
  if (ruleId === "wide/loose-equality-secret") {
    return {
      name: t("Use strict equality"),
      apply(view, _from, to) {
        const op = view.state.doc.sliceString(Math.max(0, to - 2), to);
        if (op === "==" || op === "!=") view.dispatch({ changes: { from: to, insert: "=" } });
      },
    };
  }
  if (ruleId === "wide/inner-html") {
    return {
      name: t("Replace with textContent"),
      apply(view, from, to) {
        view.dispatch({ changes: { from, to, insert: "textContent" } });
      },
    };
  }
  if (ruleId === "cwe1022/target-blank-missing-rel-noopener") {
    return {
      name: t('Add rel="noopener noreferrer"'),
      apply(view, from) {
        const line = view.state.doc.lineAt(from);
        if (/\brel\s*=/i.test(line.text)) return;
        const at = findBlank(line.text, from - line.from);
        if (at === -1) return;
        let pos = at + 6;
        while (pos < line.text.length && "\"'`}".includes(line.text[pos])) pos += 1;
        view.dispatch({ changes: { from: line.from + pos, insert: ' rel="noopener noreferrer"' } });
      },
    };
  }
  if (ruleId === "cwe1022/window-open-missing-noopener") {
    return {
      name: t("Add the noopener feature"),
      apply(view, from) {
        const line = view.state.doc.lineAt(from);
        if (/noopener/i.test(line.text)) return;
        const at = findBlank(line.text, from - line.from);
        if (at === -1) return;
        let pos = at + 6;
        if (pos < line.text.length && "\"'`".includes(line.text[pos])) pos += 1;
        let scan = pos;
        while (scan < line.text.length && line.text[scan] === " ") scan += 1;
        if (line.text[scan] !== ")") return;
        view.dispatch({ changes: { from: line.from + pos, insert: ', "noopener,noreferrer"' } });
      },
    };
  }
  if (ruleId === "cwe1021/x-frame-options-weak-value") {
    return {
      name: t("Set X-Frame-Options to DENY"),
      apply(view, from) {
        const line = view.state.doc.lineAt(from);
        const fixed = line.text.replace(/(ALLOWALL|ALLOW-?FROM[^'"`]*)/i, "DENY");
        if (fixed !== line.text) view.dispatch({ changes: { from: line.from, to: line.to, insert: fixed } });
      },
    };
  }
  if (ruleId === "cwe1021/csp-frame-ancestors-wildcard") {
    return {
      name: t("Restrict frame-ancestors to 'self'"),
      apply(view, from, to) {
        const text = view.state.doc.sliceString(from, to);
        const fixed = text.replace("*", "'self'");
        if (fixed !== text) view.dispatch({ changes: { from, to, insert: fixed } });
      },
    };
  }
  return null;
}

function toCodeMirror(view: EditorView, path: string): CmDiagnostic[] {
  const list = useDiagnostics.getState().byFile[path] ?? [];
  const length = view.state.doc.length;
  const prefix = commentPrefix(path);
  const out: CmDiagnostic[] = [];
  for (const item of list) {
    const from = Math.max(0, Math.min(item.from, length));
    const to = Math.max(from, Math.min(item.to, length));
    const ruleId = item.code === undefined ? /\(([^()\s]+)\)\s*$/.exec(item.message)?.[1] ?? "" : "";
    const actions: { name: string; apply: (target: EditorView, from: number, to: number) => void }[] = [];
    if (ruleId) {
      const fix = buildFix(ruleId);
      if (fix) actions.push(fix);
      actions.push({
        name: t("Suppress (wide-ignore)"),
        apply(target: EditorView, at: number) {
          const line = target.state.doc.lineAt(at);
          if (/\bwide-ignore\b/.test(line.text)) return;
          target.dispatch({ changes: { from: line.to, insert: `  ${prefix} wide-ignore[${ruleId}]` } });
        },
      });
    }
    out.push({
      from,

      to: to === from ? Math.min(from + 1, length) : to,
      severity: item.severity === "hint" ? "info" : item.severity,
      message: item.message,
      source: item.code === undefined ? undefined : `code ${item.code}`,
      actions: actions.length ? actions : undefined,
    });
  }
  return out;
}

export function diagnosticMarks(path: string): Extension {
  const pusher = ViewPlugin.fromClass(
    class {
      unsubscribe: () => void;
      seen = useDiagnostics.getState().byFile[path];

      constructor(readonly view: EditorView) {
        this.unsubscribe = useDiagnostics.subscribe((state) => {
          const current = state.byFile[path];
          if (current === this.seen) return;
          this.seen = current;
          this.push();
        });

        if (this.seen) this.push();
      }

      push() {
        const view = this.view;

        queueMicrotask(() => {
          view.dispatch(setDiagnostics(view.state, toCodeMirror(view, path)));
        });
      }

      destroy() {
        this.unsubscribe();
      }
    },
  );

  return [pusher, lintGutter()];
}
