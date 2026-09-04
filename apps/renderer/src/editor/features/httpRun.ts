import { RangeSet, RangeSetBuilder, type Extension } from "@codemirror/state";
import { EditorView, gutter, GutterMarker, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { parseHttpFile, type HttpRequest } from "./httpFile";

class RunMarker extends GutterMarker {
  constructor(
    readonly request: HttpRequest,
    readonly run: (request: HttpRequest) => void,
  ) {
    super();
  }

  eq(other: RunMarker) {

    const a = this.request;
    const b = other.request;
    if (a.method !== b.method || a.url !== b.url || a.body !== b.body) return false;
    if (a.headers.length !== b.headers.length) return false;
    return a.headers.every(
      ([name, value], index) => name === b.headers[index]![0] && value === b.headers[index]![1],
    );
  }

  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-http-run";
    button.textContent = "▶";
    button.title = `Send ${this.request.method} ${this.request.url}`;
    button.setAttribute("aria-label", `Send ${this.request.method} ${this.request.url}`);
    button.addEventListener("mousedown", (event) => {

      event.preventDefault();
      event.stopPropagation();
      this.run(this.request);
    });
    return button;
  }
}

function markersFor(view: EditorView, run: (request: HttpRequest) => void) {
  const builder = new RangeSetBuilder<GutterMarker>();
  const file = parseHttpFile(view.state.doc.toString());
  for (const request of file.requests) {
    if (request.line > view.state.doc.lines) continue;
    const line = view.state.doc.line(request.line);
    builder.add(line.from, line.from, new RunMarker(request, run));
  }
  return builder.finish();
}

const runTheme = EditorView.baseTheme({
  ".cm-http-gutter": {
    minWidth: "20px",
  },
  ".cm-http-run": {
    background: "transparent",
    border: "0",
    color: "var(--fg-dim)",
    cursor: "pointer",
    fontSize: "10px",
    lineHeight: "inherit",
    padding: "0 4px",
  },
  ".cm-http-run:hover": {
    color: "var(--fg-bright)",
  },
});

export function httpRunner(ext: string, run: (request: HttpRequest) => void): Extension {
  if (ext !== "http" && ext !== "rest") return [];

  const plugin = ViewPlugin.fromClass(
    class {
      markers: RangeSet<GutterMarker>;

      constructor(view: EditorView) {
        this.markers = markersFor(view, run);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.markers = markersFor(update.view, run);
      }
    },
  );

  return [
    plugin,
    gutter({
      class: "cm-http-gutter",
      markers: (view) => view.plugin(plugin)?.markers ?? RangeSet.empty,
    }),
    runTheme,
  ];
}
