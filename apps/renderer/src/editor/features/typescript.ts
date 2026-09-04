import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, hoverTooltip, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { bridge } from "@/lib/bridge";
import { useDiagnostics } from "@/stores/diagnostics";
import { languageInstalled } from "../languages";

const SYNC_DELAY_MS = 400;

const TS_EXTENSIONS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);

interface CompletionEntry {
  name: string;
  kind?: string;
  sortText?: string;
  source?: string;
  data?: unknown;
}

interface QuickInfo {
  displayParts?: { text: string }[];
  documentation?: { text: string }[];
}

function completionType(kind: string | undefined): string {
  switch (kind) {
    case "method":
    case "function":
      return "function";
    case "property":
      return "property";
    case "class":
      return "class";
    case "interface":
    case "type":
      return "type";
    case "enum":
    case "enum member":
      return "enum";
    case "var":
    case "let":
    case "const":
    case "parameter":
      return "variable";
    case "keyword":
      return "keyword";
    case "module":
      return "namespace";
    default:
      return "text";
  }
}

export function typescriptSupport(ext: string, filePath: string, root: string | null): Extension {

  if (!languageInstalled(filePath)) return [];
  if (!root || !TS_EXTENSIONS.has(ext)) return [];

  let synced: Text | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  let disposed = false;

  const sync = async (doc: Text) => {
    if (doc === synced) return;
    synced = doc;
    await bridge.tsSync(root, filePath, doc.toString());
  };

  const refresh = async (doc: Text) => {
    try {
      await sync(doc);
      const result = await bridge.tsDiagnostics(root, filePath);
      if (disposed) return;
      useDiagnostics.getState().setFor(filePath, "typescript", result?.diagnostics ?? []);
    } catch {

    }
  };

  const watcher = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        void refresh(view.state.doc);
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void refresh(update.view.state.doc);
        }, SYNC_DELAY_MS);
      }

      destroy() {
        disposed = true;
        if (timer) clearTimeout(timer);
        useDiagnostics.getState().setFor(filePath, "typescript", []);
        void bridge.tsClose(filePath);
      }
    },
  );

  const completionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/[\w$]*/);

    const trigger = context.state.doc.sliceString(Math.max(0, context.pos - 1), context.pos);
    if (!context.explicit && (!word || word.from === word.to) && trigger !== ".") return null;

    try {
      await sync(context.state.doc);
      const result = await bridge.tsCompletions(root, filePath, context.pos);
      const entries = (result?.entries ?? []) as CompletionEntry[];
      if (entries.length === 0) return null;
      return {
        from: word?.from ?? context.pos,
        options: entries.map((entry) => ({
          label: entry.name,
          type: completionType(entry.kind),

          boost: entry.sortText && entry.sortText.startsWith("0") ? 1 : 0,
        })),
        validFor: /^[\w$]*$/,
      };
    } catch {
      return null;
    }
  };

  const hover = hoverTooltip(async (view, pos) => {
    try {
      await sync(view.state.doc);
      const info = (await bridge.tsQuickInfo(root, filePath, pos)) as QuickInfo | null;
      if (!info) return null;
      const signature = (info.displayParts ?? []).map((part) => part.text).join("");
      const documentation = (info.documentation ?? []).map((part) => part.text).join("");
      if (!signature && !documentation) return null;
      return {
        pos,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-ts-hover";
          const code = document.createElement("div");
          code.className = "cm-ts-hover-signature";
          code.textContent = signature;
          dom.appendChild(code);
          if (documentation) {
            const doc = document.createElement("div");
            doc.className = "cm-ts-hover-doc";
            doc.textContent = documentation;
            dom.appendChild(doc);
          }
          return { dom };
        },
      };
    } catch {
      return null;
    }
  });

  const hoverTheme = EditorView.baseTheme({
    ".cm-ts-hover": { maxWidth: "48ch", padding: "6px 8px" },
    ".cm-ts-hover-signature": {
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
      whiteSpace: "pre-wrap",
      color: "var(--fg)",
    },
    ".cm-ts-hover-doc": {
      borderTop: "1px solid var(--line)",
      marginTop: "6px",
      paddingTop: "6px",
      fontSize: "12px",
      color: "var(--fg-muted)",
    },
  });

  return [
    watcher,

    EditorState.languageData.of(() => [{ autocomplete: completionSource }]),
    hover,
    hoverTheme,
  ];
}
