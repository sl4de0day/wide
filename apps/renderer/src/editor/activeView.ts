import type { EditorView } from "@codemirror/view";

let current: EditorView | null = null;

export function setActiveEditorView(view: EditorView | null): void {
  current = view;
}

export function clearActiveEditorView(view: EditorView): void {
  if (current === view) current = null;
}

export function getActiveEditorView(): EditorView | null {
  return current;
}

export function selectedText(): string {
  const view = current;
  if (!view) return "";
  const selection = view.state.selection.main;
  if (selection.empty) return "";
  return view.state.sliceDoc(selection.from, selection.to);
}

export function selectedRange(): { from: number; to: number; startLine: number; endLine: number } | null {
  const view = current;
  if (!view) return null;
  const selection = view.state.selection.main;
  if (selection.empty) return null;
  return {
    from: selection.from,
    to: selection.to,
    startLine: view.state.doc.lineAt(selection.from).number,
    endLine: view.state.doc.lineAt(selection.to).number,
  };
}
