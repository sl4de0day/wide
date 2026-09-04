import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { bridge } from "@/lib/bridge";
import { t } from "@/lib/i18n";
import { useDiagnostics } from "@/stores/diagnostics";

const LINT_DELAY_MS = 700;

const LINTABLE = new Set(["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"]);

const QUIET_REASONS = new Set(["not-installed", "no-config", "unsupported-version"]);

const disabledRoots = new Set<string>();

export function resetEslintState(): void {
  disabledRoots.clear();
}

export function eslintSupport(ext: string, filePath: string, root: string | null): Extension {
  if (!root || !LINTABLE.has(ext)) return [];

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let disposed = false;

  let queued: string | null = null;

  const lint = async (text: string) => {
    if (disabledRoots.has(root) || disposed) return;
    if (running) {
      queued = text;
      return;
    }
    running = true;
    try {
      const result = await bridge.lintFile(root, filePath, text);
      if (disposed) return;
      if (result.ok) {
        useDiagnostics.getState().setFor(filePath, "eslint", result.diagnostics);
      } else if (QUIET_REASONS.has(result.reason)) {
        disabledRoots.add(root);
        useDiagnostics.getState().setFor(filePath, "eslint", []);
      } else {

        useDiagnostics.getState().setFor(filePath, "eslint", [
          {
            from: 0,
            to: 0,
            severity: "warning",
            message: result.detail
              ? t("ESLint could not run: {reason} — {detail}", {
                  reason: result.reason,
                  detail: result.detail,
                })
              : t("ESLint could not run: {reason}", { reason: result.reason }),
          },
        ]);
      }
    } catch {

    } finally {
      running = false;
      const next = queued;
      queued = null;
      if (next !== null && !disposed) void lint(next);
    }
  };

  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        void lint(view.state.doc.toString());
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (timer) clearTimeout(timer);

        timer = setTimeout(() => {
          timer = null;
          void lint(update.view.state.doc.toString());
        }, LINT_DELAY_MS);
      }

      destroy() {

        disposed = true;
        queued = null;
        if (timer) clearTimeout(timer);
        useDiagnostics.getState().setFor(filePath, "eslint", []);
      }
    },
  );
}
