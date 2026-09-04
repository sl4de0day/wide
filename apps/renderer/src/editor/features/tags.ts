import { EditorSelection, StateEffect, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const TAG_NAME = /^[A-Za-z][\w.:-]*$/;
const TAG_NAME_HEAD = /^[A-Za-z][\w.:-]*/;

function openingTagBefore(text: string, pos: number): { name: string } | null {
  let at = pos - 1;
  if (text[at] === "/") return null;
  let braces = 0;
  while (at >= 0) {
    const ch = text[at]!;
    if (ch === ">") return null;
    if (ch === "<") break;
    if (ch === '"' || ch === "'") {

      const quote = ch;
      at -= 1;
      while (at >= 0 && text[at] !== quote) at -= 1;
    } else if (ch === "}") {
      braces += 1;
    } else if (ch === "{") {
      braces -= 1;
    }
    at -= 1;
  }
  if (at < 0 || braces !== 0) return null;
  const inner = text.slice(at + 1, pos);
  if (!inner || /^[/!?]/.test(inner)) return null;
  const name = TAG_NAME_HEAD.exec(inner)?.[0];
  return name ? { name } : null;
}

function alreadyClosed(text: string, pos: number, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const open = new RegExp("<" + escaped + "(?=[\\s/>])", "g");
  const close = new RegExp("</" + escaped + "\\s*>", "g");
  open.lastIndex = pos;
  close.lastIndex = pos;
  const nextClose = close.exec(text);
  if (!nextClose) return false;
  const nextOpen = open.exec(text);
  return !nextOpen || nextClose.index < nextOpen.index;
}

function autoCloseTag(): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== ">" || from !== to) return false;
    const doc = view.state.doc.toString();
    const found = openingTagBefore(doc, from);
    if (!found) return false;
    if (VOID_ELEMENTS.has(found.name.toLowerCase())) return false;
    if (alreadyClosed(doc, from, found.name)) return false;

    view.dispatch({
      changes: { from, to, insert: ">" + "</" + found.name + ">" },

      selection: EditorSelection.cursor(from + 1),
      userEvent: "input.type",
    });
    return true;
  });
}

const renaming = StateEffect.define<null>();

function matchingTag(
  text: string,
  nameFrom: number,
  name: string,
  isClosing: boolean,
): { from: number; to: number } | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = new RegExp("<(/?)(" + escaped + ")(?=[\\s/>])", "g");

  if (isClosing) {

    const openers: number[] = [];
    tag.lastIndex = 0;
    for (let m = tag.exec(text); m && m.index < nameFrom; m = tag.exec(text)) {
      if (m[1] === "/") openers.pop();
      else openers.push(m.index + 1);
    }
    const start = openers.pop();
    return start === undefined ? null : { from: start, to: start + name.length };
  }

  let depth = 0;
  tag.lastIndex = nameFrom;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    if (m[1] === "/") {
      if (depth === 0) return { from: m.index + 2, to: m.index + 2 + name.length };
      depth -= 1;
    } else {
      depth += 1;
    }
  }
  return null;
}

function tagNameAt(
  text: string,
  pos: number,
): { name: string; from: number; closing: boolean } | null {
  let at = pos;
  while (at > 0 && /[\w.:-]/.test(text[at - 1]!)) at -= 1;
  if (at === 0) return null;
  const closing = text[at - 1] === "/" && text[at - 2] === "<";
  if (!closing && text[at - 1] !== "<") return null;
  let end = pos;
  while (end < text.length && /[\w.:-]/.test(text[end]!)) end += 1;
  const name = text.slice(at, end);
  return TAG_NAME.test(name) ? { name, from: at, closing } : null;
}

function autoRenameTag(): Extension {
  return ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (update.transactions.some((tr) => tr.effects.some((e) => e.is(renaming)))) return;

        if (!update.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"))) {
          return;
        }

        const view = update.view;
        const before = update.startState.doc.toString();
        const after = view.state.doc.toString();

        let editedAt = -1;
        update.changes.iterChanges((fromA) => {
          if (editedAt === -1) editedAt = fromA;
        });
        if (editedAt === -1) return;

        const was = tagNameAt(before, editedAt);
        if (!was) return;
        const pair = matchingTag(before, was.from, was.name, was.closing);
        if (!pair) return;

        const from = update.changes.mapPos(pair.from, 1);
        const to = update.changes.mapPos(pair.to, -1);
        const now = tagNameAt(after, view.state.selection.main.head);
        if (!now || now.closing !== was.closing) return;
        if (after.slice(from, to) === now.name) return;

        queueMicrotask(() => {
          if (view.state.doc.toString() !== after) return;
          view.dispatch({
            changes: { from, to, insert: now.name },
            effects: renaming.of(null),
            userEvent: "input.rename.tag",
          });
        });
      }
    },
  );
}

const MARKUP_EXTENSIONS = new Set([
  "html",
  "htm",
  "xhtml",
  "php",
  "phtml",
  "php3",
  "php4",
  "php5",
  "phps",
  "jsx",
  "tsx",
  "xml",
  "svg",
]);

export function tagEditing(ext: string): Extension {
  if (!MARKUP_EXTENSIONS.has(ext)) return [];
  return [autoCloseTag(), autoRenameTag()];
}
