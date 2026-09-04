import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from "@codemirror/view";

const COLOR = new RegExp(
  [

    "#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b",

    "\\brgba?\\(\\s*[\\d.]+%?[\\s,]+[\\d.]+%?[\\s,]+[\\d.]+%?(?:\\s*[,/]\\s*[\\d.]+%?)?\\s*\\)",

    "\\bhsla?\\(\\s*[\\d.]+(?:deg|rad|turn)?[\\s,]+[\\d.]+%[\\s,]+[\\d.]+%(?:\\s*[,/]\\s*[\\d.]+%?)?\\s*\\)",

    "\\b0x[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\\b",
  ].join("|"),
  "g",
);

function toCss(raw: string): string | null {
  if (raw.startsWith("0x")) {
    const hex = raw.slice(2);
    return "#" + hex;
  }
  return raw;
}

class SwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super();
  }

  eq(other: SwatchWidget) {
    return other.color === this.color;
  }

  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-color-swatch";

    const fill = document.createElement("span");
    fill.className = "cm-color-swatch-fill";
    fill.style.background = this.color;
    wrap.appendChild(fill);
    wrap.title = this.color;
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    COLOR.lastIndex = 0;
    for (let m = COLOR.exec(text); m; m = COLOR.exec(text)) {
      const css = toCss(m[0]);
      if (!css) continue;
      const at = from + m.index;
      builder.add(at, at, Decoration.widget({ widget: new SwatchWidget(css), side: -1 }));
    }
  }
  return builder.finish();
}

const swatchTheme = EditorView.baseTheme({
  ".cm-color-swatch": {
    display: "inline-block",
    width: "0.8em",
    height: "0.8em",
    marginRight: "0.35em",
    verticalAlign: "-0.05em",
    borderRadius: "2px",

    backgroundColor: "#ffffff",
    backgroundImage:
      "linear-gradient(45deg, #b0b0b0 25%, transparent 25%, transparent 75%, #b0b0b0 75%)," +
      "linear-gradient(45deg, #b0b0b0 25%, transparent 25%, transparent 75%, #b0b0b0 75%)",
    backgroundSize: "6px 6px",
    backgroundPosition: "0 0, 3px 3px",
    boxShadow: "0 0 0 1px var(--line-strong)",
    overflow: "hidden",
  },
  ".cm-color-swatch-fill": {
    display: "block",
    width: "100%",
    height: "100%",
  },
});

export function colorSwatches(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = buildDecorations(update.view);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    swatchTheme,
  ];
}
