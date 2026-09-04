import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

import { useDiagnostics } from "@/stores/diagnostics";

function toCodeMirror(view: EditorView, path: string): CmDiagnostic[] {
  const list = useDiagnostics.getState().byFile[path] ?? [];
  const length = view.state.doc.length;
  const out: CmDiagnostic[] = [];
  for (const item of list) {
    const from = Math.max(0, Math.min(item.from, length));
    const to = Math.max(from, Math.min(item.to, length));
    out.push({
      from,

      to: to === from ? Math.min(from + 1, length) : to,
      severity: item.severity === "hint" ? "info" : item.severity,
      message: item.message,
      source: item.code === undefined ? undefined : `code ${item.code}`,
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
