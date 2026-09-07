import { RangeSet, RangeSetBuilder, type Extension } from "@codemirror/state";
import { EditorView, gutter, GutterMarker, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { detectRoutesInText, type RouteHit } from "@/lib/routeIndex";

const ROUTE_LANGUAGES = new Set([
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
  "py", "php", "rb", "go", "java", "kt", "cs",
]);

const BODY_SCAN_LINES = 25;

function inferFields(lines: string[], fromLine: number, kind: "body" | "query"): string[] {
  const found = new Set<string>();
  const end = Math.min(lines.length, fromLine + BODY_SCAN_LINES);
  const noun = kind === "body" ? "body" : "query";

  for (let index = fromLine; index < end; index += 1) {
    const line = lines[index];

    const dotted = new RegExp(`\\b(?:req|request|ctx)\\.${noun}\\.([A-Za-z_$][\\w$]*)`, "g");
    let match: RegExpExecArray | null;
    while ((match = dotted.exec(line)) !== null) found.add(match[1]);

    const indexed = new RegExp(`\\b(?:req|request|ctx)\\.${noun}\\[\\s*['"]([^'"]+)['"]\\s*\\]`, "g");
    while ((match = indexed.exec(line)) !== null) found.add(match[1]);

    const destructured = new RegExp(`\\{([^{}]*)\\}\\s*=\\s*(?:req|request|ctx)\\.${noun}\\b`);
    const bag = destructured.exec(line);
    if (bag) {
      for (const piece of bag[1].split(",")) {
        const name = piece.split(":")[0].trim().replace(/^\.\.\./, "");
        if (/^[A-Za-z_$][\w$]*$/.test(name)) found.add(name);
      }
    }

    if (kind === "body") {
      const python = /\brequest\.(?:json|form|data)\s*(?:\.get\s*\(\s*|\[\s*)['"]([^'"]+)['"]/g;
      while ((match = python.exec(line)) !== null) found.add(match[1]);
      const php = /\$_(?:POST|REQUEST)\s*\[\s*['"]([^'"]+)['"]\s*\]/g;
      while ((match = php.exec(line)) !== null) found.add(match[1]);
    } else {
      const pyQuery = /\brequest\.(?:args|GET|query_params)\s*(?:\.get\s*\(\s*|\[\s*)['"]([^'"]+)['"]/g;
      while ((match = pyQuery.exec(line)) !== null) found.add(match[1]);
      const phpQuery = /\$_GET\s*\[\s*['"]([^'"]+)['"]\s*\]/g;
      while ((match = phpQuery.exec(line)) !== null) found.add(match[1]);
    }
  }
  return [...found].slice(0, 12);
}

export interface RouteRequest {
  method: string;
  path: string;
  query: string[];
  body: string[];
}

function buildRequest(hit: RouteHit, lines: string[]): RouteRequest {
  const method = hit.method || "GET";
  const wantsBody = method === "POST" || method === "PUT" || method === "PATCH";
  return {
    method,
    path: hit.path,
    query: inferFields(lines, hit.line, "query"),
    body: wantsBody ? inferFields(lines, hit.line, "body") : [],
  };
}

class RouteMarker extends GutterMarker {
  constructor(
    readonly request: RouteRequest,
    readonly open: (request: RouteRequest, anchor: HTMLElement) => void,
  ) {
    super();
  }

  eq(other: RouteMarker) {
    const a = this.request;
    const b = other.request;
    return (
      a.method === b.method &&
      a.path === b.path &&
      a.query.join() === b.query.join() &&
      a.body.join() === b.body.join()
    );
  }

  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-route-lens";
    button.textContent = "◈";
    const label = `${this.request.method} ${this.request.path}`;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.open(this.request, button);
    });
    return button;
  }
}

function markersFor(
  view: EditorView,
  filePath: string,
  open: (request: RouteRequest, anchor: HTMLElement) => void,
) {
  const builder = new RangeSetBuilder<GutterMarker>();
  const text = view.state.doc.toString();
  const lines = text.split("\n");
  for (const hit of detectRoutesInText(text, filePath)) {
    if (hit.line > view.state.doc.lines) continue;
    const line = view.state.doc.line(hit.line);
    builder.add(line.from, line.from, new RouteMarker(buildRequest(hit, lines), open));
  }
  return builder.finish();
}

const routeTheme = EditorView.baseTheme({
  ".cm-route-gutter": {
    minWidth: "16px",
  },
  ".cm-route-lens": {
    background: "transparent",
    border: "0",
    color: "var(--fg-faint)",
    cursor: "pointer",
    fontSize: "10px",
    lineHeight: "inherit",
    padding: "0 3px",
  },
  ".cm-route-lens:hover": {
    color: "var(--accent)",
  },
});

export function routeLens(
  ext: string,
  filePath: string,
  open: (request: RouteRequest, anchor: HTMLElement) => void,
): Extension {
  if (!ROUTE_LANGUAGES.has(ext)) return [];

  const plugin = ViewPlugin.fromClass(
    class {
      markers: RangeSet<GutterMarker>;

      constructor(view: EditorView) {
        this.markers = markersFor(view, filePath, open);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.markers = markersFor(update.view, filePath, open);
      }
    },
  );

  return [
    plugin,
    gutter({
      class: "cm-route-gutter",
      markers: (view) => view.plugin(plugin)?.markers ?? RangeSet.empty,
    }),
    routeTheme,
  ];
}
