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

const ICON_PITCHER =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
const ICON_REPEATER =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>';
const ICON_DECODE =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
const ICON_ASK_AI =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>';

function createBtn(label: string, iconSvg: string, onClick: () => void, isAccent = false): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = isAccent ? "cm-selection-btn cm-selection-btn-accent" : "cm-selection-btn";
  btn.innerHTML = `<span class="cm-selection-icon">${iconSvg}</span><span>${label}</span>`;
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
    backgroundColor: "var(--panel)",
    border: "1px solid var(--line)",
    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
    fontSize: "11px",
    userSelect: "none",
    zIndex: "250",
    pointerEvents: "auto",
  },
  ".cm-selection-btn": {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "2px 6px",
    borderRadius: "4px",
    border: "none",
    background: "transparent",
    color: "var(--fg-dim)",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: "500",
    lineHeight: "1.4",
    transition: "background 0.1s, color 0.1s",
  },
  ".cm-selection-icon": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "12px",
    height: "12px",
    flexShrink: "0",
  },
  ".cm-selection-icon svg": {
    width: "12px",
    height: "12px",
    display: "block",
  },
  ".cm-selection-btn:hover": {
    background: "var(--hover)",
    color: "var(--fg-bright)",
  },
  ".cm-selection-btn-accent": {
    color: "var(--accent)",
  },
  ".cm-selection-divider": {
    width: "1px",
    height: "12px",
    backgroundColor: "var(--line)",
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
            createBtn("Pitcher", ICON_PITCHER, () => {
              const req = parseSelectionForTraffic(text);
              sendRouteToPitcher(req);
            }, true),
          );
          dom.appendChild(
            createBtn("Repeater", ICON_REPEATER, () => {
              const req = parseSelectionForTraffic(text);
              sendRouteToRepeater(req);
            }),
          );

          const div = document.createElement("div");
          div.className = "cm-selection-divider";
          dom.appendChild(div);
        }

        dom.appendChild(
          createBtn("Decode", ICON_DECODE, () => {
            useDecoder.getState().openDecoder(text);
          }),
        );

        const div2 = document.createElement("div");
        div2.className = "cm-selection-divider";
        dom.appendChild(div2);

        dom.appendChild(
          createBtn("Ask AI", ICON_ASK_AI, () => {
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

