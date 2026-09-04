import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, showTooltip, type Tooltip, type ViewUpdate } from "@codemirror/view";

import { bridge, type SignatureHelp } from "@/lib/bridge";
import { languageInstalled } from "../languages";

const TS_EXTENSIONS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);
const QUERY_DELAY_MS = 80;

const setSignature = StateEffect.define<Tooltip | null>();

const signatureField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setSignature)) return effect.value;
    return value;
  },
  provide: (field) => showTooltip.from(field),
});

function makeTooltip(pos: number, help: SignatureHelp): Tooltip | null {
  const signatures = help.signatures;
  if (!signatures || signatures.length === 0) return null;
  const sig = signatures[Math.min(help.activeSignature ?? 0, signatures.length - 1)] ?? signatures[0];
  const activeParam = help.activeParameter ?? 0;

  return {
    pos,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-signature-help";

      const line = document.createElement("div");
      line.className = "cm-signature-label";

      const label = sig.label;
      let cursor = 0;
      const marks: { from: number; to: number; active: boolean }[] = [];
      sig.parameters.forEach((param, index) => {
        if (!param.label) return;
        const at = label.indexOf(param.label, cursor);
        if (at < 0) return;
        marks.push({ from: at, to: at + param.label.length, active: index === activeParam });
        cursor = at + param.label.length;
      });

      let last = 0;
      for (const mark of marks) {
        if (mark.from > last) line.appendChild(document.createTextNode(label.slice(last, mark.from)));
        const span = document.createElement("span");
        span.textContent = label.slice(mark.from, mark.to);
        if (mark.active) span.className = "cm-signature-active";
        line.appendChild(span);
        last = mark.to;
      }
      if (last < label.length) line.appendChild(document.createTextNode(label.slice(last)));
      dom.appendChild(line);

      const doc = sig.parameters[activeParam]?.documentation;
      if (doc) {
        const note = document.createElement("div");
        note.className = "cm-signature-doc";
        note.textContent = doc;
        dom.appendChild(note);
      }
      return { dom };
    },
  };
}

export function signatureHelp(ext: string, filePath: string, root: string | null): Extension {
  if (!languageInstalled(filePath) || !root) return [];
  const isTs = TS_EXTENSIONS.has(ext);

  const fetchHelp = async (view: EditorView, pos: number): Promise<SignatureHelp> => {
    if (isTs) {
      await bridge.tsSync(root, filePath, view.state.doc.toString());
      return bridge.tsSignatureHelp(root, filePath, pos);
    }
    const lineObj = view.state.doc.lineAt(pos);
    return bridge.lspSignatureHelp(filePath, lineObj.number - 1, pos - lineObj.from);
  };

  const driver = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;
      token = 0;

      constructor(readonly view: EditorView) {}

      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet) return;
        const open = update.state.field(signatureField) !== null;
        let typedTrigger = false;
        if (update.docChanged) {
          update.changes.iterChanges((_a, _b, _c, _d, inserted) => {
            const text = inserted.toString();
            if (text.includes("(") || text.includes(",")) typedTrigger = true;
          });
        }

        if (open || typedTrigger) this.schedule();
      }

      schedule() {
        if (this.timer) clearTimeout(this.timer);
        const mine = ++this.token;
        this.timer = setTimeout(async () => {
          const pos = this.view.state.selection.main.head;
          const help = await fetchHelp(this.view, pos);
          if (mine !== this.token) return;
          this.view.dispatch({ effects: setSignature.of(makeTooltip(pos, help)) });
        }, QUERY_DELAY_MS);
      }

      destroy() {
        if (this.timer) clearTimeout(this.timer);
        this.token += 1;
      }
    },
  );

  return [
    signatureField,
    driver,
    keymap.of([
      {
        key: "Escape",
        run: (view) => {
          if (view.state.field(signatureField) === null) return false;
          view.dispatch({ effects: setSignature.of(null) });
          return true;
        },
      },
    ]),
    EditorView.baseTheme({
      ".cm-signature-help": {
        maxWidth: "480px",
        padding: "4px 8px",
        borderRadius: "4px",
        border: "1px solid var(--line-strong, #d8dee933)",
        background: "var(--raised)",
        color: "var(--fg-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      },
      ".cm-signature-active": { color: "var(--fg-bright)", fontWeight: "700" },
      ".cm-signature-doc": {
        marginTop: "3px",
        color: "var(--fg-faint)",
        fontFamily: "var(--font-ui)",
      },
    }),
  ];
}
