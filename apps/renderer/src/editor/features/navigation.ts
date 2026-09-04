import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";

import { bridge, type CodeLocation, type CodeSpan } from "@/lib/bridge";
import { useCodeAction } from "@/stores/codeAction";
import { useDiagnostics } from "@/stores/diagnostics";
import { useEditor } from "@/stores/editor";
import { useReferences } from "@/stores/references";
import { useRename } from "@/stores/rename";
import { languageInstalled } from "../languages";

const TS_EXTENSIONS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);

const HIGHLIGHT_DELAY_MS = 150;

const highlightMark = Decoration.mark({ class: "cm-nav-highlight" });
const writeMark = Decoration.mark({ class: "cm-nav-highlight cm-nav-write" });

function occurrenceHighlighter(fetchSpans: (view: EditorView, at: number) => Promise<CodeSpan[]>): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      timer: ReturnType<typeof setTimeout> | null = null;
      token = 0;

      constructor(readonly view: EditorView) {}

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) this.schedule();
      }

      schedule() {
        if (this.timer) clearTimeout(this.timer);
        const at = this.view.state.selection.main.head;
        const mine = ++this.token;
        this.timer = setTimeout(async () => {
          const spans = await fetchSpans(this.view, at);
          if (mine !== this.token) return;
          const builder = new RangeSetBuilder<Decoration>();
          for (const span of spans) {
            const from = span.start;
            const to = Math.min(span.start + span.length, this.view.state.doc.length);
            if (from < to) builder.add(from, to, span.write ? writeMark : highlightMark);
          }
          this.decorations = builder.finish();
          this.view.dispatch({});
        }, HIGHLIGHT_DELAY_MS);
      }

      destroy() {
        if (this.timer) clearTimeout(this.timer);
        this.token += 1;
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function reveal(location: CodeLocation): void {
  void useEditor.getState().revealOffset(location.file, location.start);
}

function symbolAtCaret(view: EditorView): { name: string; from: number; x: number; y: number } | null {
  const pos = view.state.selection.main.head;
  const word = view.state.wordAt(pos);
  if (!word) return null;
  const name = view.state.doc.sliceString(word.from, word.to);
  const coords = view.coordsAtPos(word.from);
  if (!name || !coords) return null;
  return { name, from: word.from, x: coords.left, y: coords.bottom + 4 };
}

function codesAt(filePath: string, from: number, to: number): number[] {
  const list = useDiagnostics.getState().byFile[filePath] ?? [];
  const codes = new Set<number>();
  for (const diagnostic of list) {
    if (typeof diagnostic.code !== "number") continue;

    if (diagnostic.to >= from && diagnostic.from <= to) codes.add(diagnostic.code);
  }
  return [...codes];
}

function caretCoords(view: EditorView): { x: number; y: number } {
  const coords = view.coordsAtPos(view.state.selection.main.from);
  return coords ? { x: coords.left, y: coords.bottom + 4 } : { x: 200, y: 200 };
}

export function navigationSupport(ext: string, filePath: string, root: string | null): Extension {
  if (!languageInstalled(filePath) || !root) return [];
  const isTs = TS_EXTENSIONS.has(ext);

  if (!isTs) {
    return lspNavigation(filePath);
  }

  const sync = (view: EditorView) => bridge.tsSync(root, filePath, view.state.doc.toString());

  const goToDefinition = (view: EditorView): boolean => {
    const position = view.state.selection.main.head;
    void (async () => {
      await sync(view);
      const result = await bridge.tsDefinition(root, filePath, position);
      const target = result.locations[0];
      if (target) reveal(target);
    })();
    return true;
  };

  const findReferences = (view: EditorView): boolean => {
    const position = view.state.selection.main.head;
    void (async () => {
      await sync(view);
      const result = await bridge.tsReferences(root, filePath, position);
      useReferences.getState().show(filePath, result.locations);
    })();
    return true;
  };

  const highlighter = occurrenceHighlighter(async (view, at) => {
    await sync(view);
    return (await bridge.tsDocumentHighlights(root, filePath, at)).spans;
  });

  const startRename = (view: EditorView): boolean => {
    const symbol = symbolAtCaret(view);
    if (!symbol) return false;
    useRename.getState().open({
      engine: "ts",
      root,
      file: filePath,
      position: symbol.from,
      line: 0,
      character: 0,
      oldName: symbol.name,
      x: symbol.x,
      y: symbol.y,
    });
    return true;
  };

  const codeActions = (view: EditorView): boolean => {
    const sel = view.state.selection.main;
    const { x, y } = caretCoords(view);
    void (async () => {
      await sync(view);
      const result = await bridge.tsCodeActions(root, filePath, sel.from, sel.to, codesAt(filePath, sel.from, sel.to));
      if (result.actions.length) {
        useCodeAction.getState().open({ engine: "ts", root, file: filePath, start: sel.from, end: sel.to }, result.actions, x, y);
      }
    })();
    return true;
  };

  return [highlighter, ...navKeys(goToDefinition, findReferences, startRename, codeActions), navTheme];
}

function lspNavigation(filePath: string): Extension {
  const positionOf = (view: EditorView, pos: number) => {
    const line = view.state.doc.lineAt(pos);
    return { line: line.number - 1, character: pos - line.from };
  };

  const highlighter = occurrenceHighlighter(async (view, at) => {
    const { line, character } = positionOf(view, at);
    return (await bridge.lspDocumentHighlights(filePath, line, character)).spans;
  });

  const goToDefinition = (view: EditorView): boolean => {
    const { line, character } = positionOf(view, view.state.selection.main.head);
    void (async () => {
      const result = await bridge.lspDefinition(filePath, line, character);
      const target = result.locations[0];
      if (target) reveal(target);
    })();
    return true;
  };

  const findReferences = (view: EditorView): boolean => {
    const { line, character } = positionOf(view, view.state.selection.main.head);
    void (async () => {
      const result = await bridge.lspReferences(filePath, line, character);
      useReferences.getState().show(filePath, result.locations);
    })();
    return true;
  };

  const startRename = (view: EditorView): boolean => {
    const symbol = symbolAtCaret(view);
    if (!symbol) return false;
    const line = view.state.doc.lineAt(symbol.from);
    useRename.getState().open({
      engine: "lsp",
      root: "",
      file: filePath,
      position: symbol.from,
      line: line.number - 1,
      character: symbol.from - line.from,
      oldName: symbol.name,
      x: symbol.x,
      y: symbol.y,
    });
    return true;
  };

  const positionOf2 = (view: EditorView, pos: number) => {
    const line = view.state.doc.lineAt(pos);
    return { line: line.number - 1, character: pos - line.from };
  };

  const codeActions = (view: EditorView): boolean => {
    const sel = view.state.selection.main;
    const start = positionOf2(view, sel.from);
    const end = positionOf2(view, sel.to);
    const { x, y } = caretCoords(view);
    void (async () => {
      const result = await bridge.lspCodeActions(
        filePath,
        start.line,
        start.character,
        end.line,
        end.character,
        codesAt(filePath, sel.from, sel.to),
      );
      if (result.actions.length) {
        useCodeAction.getState().open({ engine: "lsp", root: "", file: filePath, start: sel.from, end: sel.to }, result.actions, x, y);
      }
    })();
    return true;
  };

  return [highlighter, ...navKeys(goToDefinition, findReferences, startRename, codeActions), navTheme];
}

function navKeys(
  goToDefinition: (view: EditorView) => boolean,
  findReferences: (view: EditorView) => boolean,
  startRename: (view: EditorView) => boolean,
  codeActions: (view: EditorView) => boolean,
): Extension[] {
  return [
    keymap.of([
      { key: "F12", run: goToDefinition },
      { key: "Shift-F12", run: findReferences },
      { key: "Mod-b", run: goToDefinition },
      { key: "F2", run: startRename },
      { key: "Mod-.", run: codeActions },
    ]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!event.ctrlKey && !event.metaKey) return false;
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (at === null) return false;
        event.preventDefault();
        view.dispatch({ selection: { anchor: at } });
        return goToDefinition(view);
      },
    }),
  ];
}

const navTheme = EditorView.baseTheme({
  ".cm-nav-highlight": {
    backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)",
    borderRadius: "2px",
  },
  ".cm-nav-write": {
    backgroundColor: "color-mix(in srgb, var(--status-warn, #d9a441) 26%, transparent)",
  },
});
