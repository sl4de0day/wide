import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { bridge } from "@/lib/bridge";
import { t } from "@/lib/i18n";
import { useDiagnostics } from "@/stores/diagnostics";
import { languageInstalled } from "../languages";

const CHANGE_DELAY_MS = 400;

const COMPLETION_KIND: Record<number, string> = {
  1: "text", 2: "method", 3: "function", 4: "function", 5: "property",
  6: "variable", 7: "class", 8: "interface", 9: "namespace", 10: "property",
  11: "text", 12: "constant", 13: "enum", 14: "keyword", 15: "text",
  16: "constant", 17: "text", 18: "text", 19: "text", 20: "enum",
  21: "constant", 22: "class", 23: "interface", 24: "keyword", 25: "type",
};

const failedServers = new Set<string>();

const failureKey = (root: string, server: string) => `${root}|${server}`;

export function resetLspState(): void {
  failedServers.clear();
  void bridge.lspStopAll();
}

export function subscribeLspDiagnostics(): () => void {
  return (
    bridge.onLspDiagnostics((payload) => {
      if (!payload?.path) return;
      useDiagnostics.getState().setFor(payload.path, "lsp", payload.diagnostics ?? []);
    }) ?? (() => {})
  );
}

export function lspSupport(filePath: string, root: string | null): Extension {

  if (!languageInstalled(filePath)) return [];
  if (!root) return [];

  let opened = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = async (text: string) => {
    if (opened || disposed) return;

    const capability = await bridge.lspCapability(filePath);
    if (!capability.available || !capability.server || disposed) return;
    const key = failureKey(root, capability.server);
    if (failedServers.has(key)) return;

    const result = await bridge.lspOpen(root, filePath, text);
    if (disposed) {

      if (result.ok) void bridge.lspClose(filePath);
      return;
    }
    if (result.ok) {
      opened = true;
      return;
    }

    failedServers.add(key);
    if (result.reason === "not-installed") {
      useDiagnostics.getState().setFor(filePath, "lsp", [
        {
          from: 0,
          to: 0,
          severity: "hint",
          message: t(
            'No language server for this file. Wide would use "{command}" if it were on PATH — it does not install one for you.',
            { command: capability.command ?? "" },
          ),
        },
      ]);
    }
  };

  const positionOf = (view: EditorView, pos: number) => {
    const line = view.state.doc.lineAt(pos);
    return { line: line.number - 1, character: pos - line.from };
  };

  const completionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (!opened) return null;
    const word = context.matchBefore(/[\w$]*/);
    const trigger = context.state.doc.sliceString(Math.max(0, context.pos - 1), context.pos);
    if (!context.explicit && (!word || word.from === word.to) && !/[.:>]/.test(trigger)) return null;

    const at = positionOf(context.view!, context.pos);
    try {
      const result = await bridge.lspCompletion(filePath, at.line, at.character);
      if (!result.items.length) return null;
      return {
        from: word?.from ?? context.pos,
        options: result.items.map((item) => ({
          label: item.label,
          type: item.kind ? (COMPLETION_KIND[item.kind] ?? "text") : "text",
          detail: item.detail ?? undefined,
        })),
        validFor: /^[\w$]*$/,
      };
    } catch {
      return null;
    }
  };

  const hover = hoverTooltip(async (view, pos) => {
    if (!opened) return null;
    const at = positionOf(view, pos);
    try {
      const result = await bridge.lspHover(filePath, at.line, at.character);
      if (!result?.text) return null;
      return {
        pos,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-lsp-hover";
          dom.textContent = result.text;
          return { dom };
        },
      };
    } catch {
      return null;
    }
  });

  const lifecycle = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        void open(view.state.doc.toString());
      }

      update(update: ViewUpdate) {
        if (!update.docChanged || !opened) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void bridge.lspChange(filePath, update.view.state.doc.toString());
        }, CHANGE_DELAY_MS);
      }

      destroy() {
        disposed = true;
        if (timer) clearTimeout(timer);
        useDiagnostics.getState().setFor(filePath, "lsp", []);
        if (opened) void bridge.lspClose(filePath);
      }
    },
  );

  return [
    lifecycle,
    EditorState.languageData.of(() => [{ autocomplete: completionSource }]),
    hover,
    EditorView.baseTheme({
      ".cm-lsp-hover": {
        maxWidth: "56ch",
        padding: "6px 8px",
        whiteSpace: "pre-wrap",
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        color: "var(--fg)",
      },
    }),
  ];
}
