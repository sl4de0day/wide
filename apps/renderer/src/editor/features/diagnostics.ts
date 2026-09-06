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

function toCodeMirror(view: EditorView, path: string): CmDiagnostic[] {
  const list = useDiagnostics.getState().byFile[path] ?? [];
  const length = view.state.doc.length;
  const prefix = commentPrefix(path);
  const out: CmDiagnostic[] = [];
  for (const item of list) {
    const from = Math.max(0, Math.min(item.from, length));
    const to = Math.max(from, Math.min(item.to, length));
    const ruleId = item.code === undefined ? /\(([^()\s]+)\)\s*$/.exec(item.message)?.[1] ?? "" : "";
    const actions = ruleId
      ? [
          {
            name: t("Suppress (wide-ignore)"),
            apply(target: EditorView, at: number) {
              const line = target.state.doc.lineAt(at);
              if (/\bwide-ignore\b/.test(line.text)) return;
              target.dispatch({ changes: { from: line.to, insert: `  ${prefix} wide-ignore[${ruleId}]` } });
            },
          },
        ]
      : undefined;
    out.push({
      from,

      to: to === from ? Math.min(from + 1, length) : to,
      severity: item.severity === "hint" ? "info" : item.severity,
      message: item.message,
      source: item.code === undefined ? undefined : `code ${item.code}`,
      actions,
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
