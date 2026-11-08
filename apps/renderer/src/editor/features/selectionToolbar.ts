import { StateField, type Extension } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";

import { sendSelectionToChat } from "@/lib/sendToChat";
import { sendRouteToPitcher, sendRouteToRepeater } from "@/lib/trafficBridge";
import { useDecoder } from "@/stores/decoder";

function isEndpointOrUrl(text: string): boolean {
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^\/[a-zA-Z0-9_\-.~%]+/i.test(trimmed)) return true;
  if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+/i.test(trimmed)) return true;
  return false;
}

function parseSelectionForTraffic(raw: string) {
  let text = raw.trim();
  let method = "GET";
  const m = text.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(.*)$/i);
  if (m) {
    method = m[1].toUpperCase();
    text = m[2].trim();
  }
  text = text.replace(/^['"`]|['"`]$/g, "");
  return {
    method,
    path: text,
    query: [],
    body: method === "POST" || method === "PUT" || method === "PATCH" ? ["data"] : [],
  };
}

function createBtn(label: string, icon: string, onClick: () => void, isAccent = false): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = isAccent ? "cm-selection-btn cm-selection-btn-accent" : "cm-selection-btn";
  btn.innerHTML = `<span style="font-size: 11px;">${icon}</span> <span>${label}</span>`;
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

const selectionToolbarTheme = EditorView.baseTheme({
  ".cm-selection-toolbar": {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    padding: "3px 6px",
    borderRadius: "6px",
    backgroundColor: "var(--bg-panel, #18181b)",
    border: "1px solid var(--border-color, #27272a)",
    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
    fontSize: "11px",
    userSelect: "none",
    zIndex: "250",
    pointerEvents: "auto",
  },
  ".cm-selection-btn": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 6px",
    borderRadius: "4px",
    border: "none",
    background: "transparent",
    color: "var(--fg-dim, #a1a1aa)",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: "500",
    lineHeight: "1.4",
    transition: "background 0.1s, color 0.1s",
  },
  ".cm-selection-btn:hover": {
    background: "var(--bg-hover, #27272a)",
    color: "var(--fg-bright, #fafafa)",
  },
  ".cm-selection-btn-accent": {
    color: "var(--accent, #38bdf8)",
  },
  ".cm-selection-divider": {
    width: "1px",
    height: "12px",
    backgroundColor: "var(--border-color, #27272a)",
    margin: "0 2px",
  },
});

const selectionToolbarField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    const sel = tr.state.selection.main;
    if (sel.empty) return null;

    const span = sel.to - sel.from;
    if (span < 2 || span > 2000) return null;

    const text = tr.state.sliceDoc(sel.from, sel.to).trim();
    if (!text) return null;

    return {
      pos: sel.from,
      above: true,
      arrow: false,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-selection-toolbar";

        const isTraffic = isEndpointOrUrl(text);

        if (isTraffic) {
          dom.appendChild(
            createBtn("Pitcher", "⚡", () => {
              const req = parseSelectionForTraffic(text);
              sendRouteToPitcher(req);
            }, true),
          );
          dom.appendChild(
            createBtn("Repeater", "🔁", () => {
              const req = parseSelectionForTraffic(text);
              sendRouteToRepeater(req);
            }),
          );

          const div = document.createElement("div");
          div.className = "cm-selection-divider";
          dom.appendChild(div);
        }

        dom.appendChild(
          createBtn("Decode", "🔤", () => {
            useDecoder.getState().openDecoder(text);
          }),
        );

        const div2 = document.createElement("div");
        div2.className = "cm-selection-divider";
        dom.appendChild(div2);

        dom.appendChild(
          createBtn("Ask AI", "🤖", () => {
            void sendSelectionToChat();
          }),
        );

        return { dom };
      },
    };
  },
  provide: (field) => showTooltip.from(field),
});

export function selectionToolbar(): Extension {
  return [selectionToolbarField, selectionToolbarTheme];
}

