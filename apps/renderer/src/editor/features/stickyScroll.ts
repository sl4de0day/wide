import { type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const MAX_STICKY = 5;

function indentWidth(text: string, tabSize: number): number {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += tabSize;
    else break;
  }
  return width;
}

export function stickyScroll(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      dom: HTMLElement;

      constructor(readonly view: EditorView) {
        this.dom = document.createElement("div");
        this.dom.className = "cm-sticky-scroll";
        this.dom.setAttribute("aria-hidden", "true");
        view.dom.appendChild(this.dom);
        this.render();
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.geometryChanged) this.render();
      }

      render() {
        const { view } = this;
        const scroller = view.scrollDOM;
        const top = scroller.scrollTop;

        if (top <= 2) {
          this.dom.style.display = "none";
          this.dom.replaceChildren();
          return;
        }

        let block;
        try {
          block = view.lineBlockAtHeight(top);
        } catch {
          return;
        }
        const doc = view.state.doc;
        const firstVisible = doc.lineAt(block.from).number;
        const tabSize = view.state.tabSize;

        const headers: { from: number; text: string }[] = [];
        let minIndent = Infinity;
        {
          const start = doc.line(Math.min(firstVisible, doc.lines));
          minIndent = indentWidth(start.text, tabSize);
        }
        for (let n = firstVisible - 1; n >= 1 && headers.length < MAX_STICKY; n -= 1) {
          const line = doc.line(n);
          if (!line.text.trim()) continue;
          const indent = indentWidth(line.text, tabSize);
          if (indent < minIndent) {
            headers.unshift({ from: line.from, text: line.text.replace(/\s+$/, "") });
            minIndent = indent;
            if (indent === 0) break;
          }
        }

        if (headers.length === 0) {
          this.dom.style.display = "none";
          this.dom.replaceChildren();
          return;
        }

        const gutter = view.dom.querySelector<HTMLElement>(".cm-gutters");
        this.dom.style.display = "block";
        this.dom.style.paddingLeft = `${gutter ? gutter.offsetWidth : 0}px`;

        const rows = headers.map(({ from, text }) => {
          const row = document.createElement("div");
          row.className = "cm-sticky-line";
          row.textContent = text || " ";
          row.addEventListener("mousedown", (event) => {
            event.preventDefault();
            view.dispatch({ effects: EditorView.scrollIntoView(from, { y: "start" }) });
          });
          return row;
        });
        this.dom.replaceChildren(...rows);
      }

      destroy() {
        this.dom.remove();
      }
    },
  );

  return [
    plugin,
    EditorView.baseTheme({

      ".cm-editor": { position: "relative" },
      ".cm-sticky-scroll": {
        position: "absolute",
        top: "0",
        left: "0",
        right: "0",
        zIndex: "3",
        background: "var(--chrome)",
        borderBottom: "1px solid var(--line)",
        boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
        fontFamily: "var(--font-mono)",
        overflow: "hidden",
        pointerEvents: "auto",
      },
      ".cm-sticky-line": {
        whiteSpace: "pre",
        overflow: "hidden",
        textOverflow: "ellipsis",
        cursor: "pointer",
        color: "var(--fg-muted)",
        padding: "0 8px",
        lineHeight: "1.5",
      },
      ".cm-sticky-line:hover": {
        background: "var(--hover)",
        color: "var(--fg-bright)",
      },
    }),
  ];
}
