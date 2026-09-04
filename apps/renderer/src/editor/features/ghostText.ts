import { Prec, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type ViewUpdate,
} from "@codemirror/view";

import { bridge } from "@/lib/bridge";
import { extname } from "@/lib/utils";
import { useExtensions } from "@/stores/extensions";
import { useSettings } from "@/stores/settings";

const DELAY_MS = 500;
const PREFIX = 2000;
const SUFFIX = 1000;

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: GhostWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";

    span.textContent = this.text;
    return span;
  }
  get estimatedHeight() {
    return -1;
  }
}

function enabled(): boolean {
  return useSettings.getState().aiGhostText && useExtensions.getState().installed.has("ai-assistant");
}

class GhostState {
  decorations: DecorationSet = Decoration.none;
  ghost: { text: string; from: number } | null = null;
  timer: ReturnType<typeof setTimeout> | null = null;
  token = 0;

  constructor(
    readonly view: EditorView,
    readonly language: string,
  ) {}

  update(update: ViewUpdate) {
    if (!update.docChanged && !update.selectionSet) return;

    if (this.ghost) {
      this.ghost = null;
      this.decorations = Decoration.none;
    }
    this.schedule();
  }

  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.token += 1;
    if (!enabled()) return;
    const mine = this.token;
    this.timer = setTimeout(() => void this.request(mine), DELAY_MS);
  }

  async request(mine: number) {
    const { state } = this.view;
    const sel = state.selection.main;
    if (!sel.empty) return;
    const pos = sel.head;
    const prefix = state.doc.sliceString(Math.max(0, pos - PREFIX), pos);
    const suffix = state.doc.sliceString(pos, Math.min(state.doc.length, pos + SUFFIX));
    if (!prefix.trim()) return;
    let reply;
    try {
      reply = await bridge.aiComplete(prefix, suffix, this.language);
    } catch {
      return;
    }

    if (mine !== this.token || !reply.ok || !reply.text) return;
    if (this.view.state.selection.main.head !== pos) return;
    this.ghost = { text: reply.text, from: pos };
    this.decorations = Decoration.set([
      Decoration.widget({ widget: new GhostWidget(reply.text), side: 1 }).range(pos),
    ]);
    this.view.dispatch({});
  }

  accept(): boolean {
    if (!this.ghost) return false;
    const { text, from } = this.ghost;
    this.ghost = null;
    this.decorations = Decoration.none;
    this.token += 1;
    this.view.dispatch({
      changes: { from, insert: text },
      selection: { anchor: from + text.length },
      userEvent: "input.complete",
    });
    return true;
  }

  dismiss(): boolean {
    if (!this.ghost) return false;
    this.ghost = null;
    this.decorations = Decoration.none;
    this.token += 1;
    this.view.dispatch({});
    return true;
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.token += 1;
  }
}

export function ghostText(filePath: string): Extension {
  const language = extname(filePath) || "text";
  const plugin = ViewPlugin.define((view) => new GhostState(view, language), {
    decorations: (value) => value.decorations,
  });

  return [
    plugin,

    Prec.highest(
      keymap.of([
        { key: "Tab", run: (view) => view.plugin(plugin)?.accept() ?? false },
        { key: "Escape", run: (view) => view.plugin(plugin)?.dismiss() ?? false },
      ]),
    ),
    EditorView.baseTheme({
      ".cm-ghost-text": {
        color: "var(--fg-faint)",
        opacity: "0.7",
        fontStyle: "italic",
        whiteSpace: "pre-wrap",
      },
    }),
  ];
}
