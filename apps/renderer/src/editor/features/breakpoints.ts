import { RangeSet, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  type ViewUpdate,
} from "@codemirror/view";

import { useDebug, urlToPath } from "@/stores/debug";

class BreakpointMarker extends GutterMarker {
  constructor(readonly kind: "plain" | "conditional" | "logpoint") {
    super();
  }
  toDOM() {
    const dot = document.createElement("div");

    dot.className =
      this.kind === "conditional"
        ? "cm-breakpoint-dot cm-breakpoint-conditional"
        : this.kind === "logpoint"
          ? "cm-breakpoint-dot cm-breakpoint-logpoint"
          : "cm-breakpoint-dot";
    return dot;
  }
}
const breakpointMarker = new BreakpointMarker("plain");
const conditionalMarker = new BreakpointMarker("conditional");
const logpointMarker = new BreakpointMarker("logpoint");

const pausedLine = Decoration.line({ attributes: { class: "cm-paused-line" } });

export function breakpointSupport(filePath: string): Extension {

  const markersFor = (view: EditorView) => {
    const state = useDebug.getState();
    const lines = state.breakpoints[filePath] ?? [];
    if (lines.length === 0) return RangeSet.empty;
    const builder = new RangeSetBuilder<GutterMarker>();
    const total = view.state.doc.lines;
    for (const line0 of [...lines].sort((a, b) => a - b)) {
      const lineNo = line0 + 1;
      if (lineNo < 1 || lineNo > total) continue;
      const key = `${filePath}:${line0}`;
      const marker = state.logMessages[key]
        ? logpointMarker
        : state.conditions[key]
          ? conditionalMarker
          : breakpointMarker;
      builder.add(view.state.doc.line(lineNo).from, view.state.doc.line(lineNo).from, marker);
    }
    return builder.finish();
  };

  const pausedFor = (view: EditorView): DecorationSet => {
    const state = useDebug.getState();
    if (!state.paused) return Decoration.none;
    const frame = state.frames[state.activeFrame];
    if (!frame || urlToPath(frame.url).toLowerCase() !== filePath.toLowerCase()) return Decoration.none;
    const lineNo = frame.line + 1;
    if (lineNo < 1 || lineNo > view.state.doc.lines) return Decoration.none;
    const builder = new RangeSetBuilder<Decoration>();
    builder.add(view.state.doc.line(lineNo).from, view.state.doc.line(lineNo).from, pausedLine);
    return builder.finish();
  };

  const plugin = ViewPlugin.fromClass(
    class {
      markers: RangeSet<GutterMarker>;
      decorations: DecorationSet;
      unsubscribe: () => void;

      constructor(readonly view: EditorView) {
        this.markers = markersFor(view);
        this.decorations = pausedFor(view);

        this.unsubscribe = useDebug.subscribe(() => {
          queueMicrotask(() => {
            this.markers = markersFor(this.view);
            this.decorations = pausedFor(this.view);
            this.view.dispatch({});
          });
        });
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.markers = markersFor(this.view);
          this.decorations = pausedFor(this.view);
        }
      }

      destroy() {
        this.unsubscribe();
      }
    },
    { decorations: (value) => value.decorations },
  );

  return [
    plugin,
    gutter({
      class: "cm-breakpoint-gutter",
      markers: (view) => view.plugin(plugin)?.markers ?? RangeSet.empty,

      domEventHandlers: {
        mousedown(view, block, event) {
          const line = view.state.doc.lineAt(block.from);
          useDebug.getState().toggleBreakpoint(filePath, line.number - 1);
          (event as Event).preventDefault();
          return true;
        },
      },
    }),
    EditorView.baseTheme({
      ".cm-breakpoint-gutter": { width: "14px", cursor: "pointer" },
      ".cm-breakpoint-gutter .cm-gutterElement:hover::after": {
        content: '""',
        display: "block",
        width: "8px",
        height: "8px",
        margin: "auto",
        borderRadius: "50%",
        background: "color-mix(in srgb, var(--status-error) 40%, transparent)",
      },
      ".cm-breakpoint-dot": {
        width: "8px",
        height: "8px",
        margin: "auto",
        borderRadius: "50%",
        background: "var(--status-error)",
      },

      ".cm-breakpoint-conditional": {
        background: "transparent",
        border: "2px solid var(--status-error)",
      },

      ".cm-breakpoint-logpoint": {
        background: "var(--status-warn)",
        borderRadius: "1px",
        transform: "rotate(45deg)",
        width: "7px",
        height: "7px",
      },
      ".cm-paused-line": {
        backgroundColor: "color-mix(in srgb, var(--status-warn, #d9a441) 22%, transparent)",
      },
    }),
  ];
}
