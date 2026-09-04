import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const codeHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: tags.lineComment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: tags.blockComment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: tags.docComment, color: "var(--syn-comment)", fontStyle: "italic" },

  { tag: tags.keyword, color: "var(--syn-keyword)" },
  { tag: tags.controlKeyword, color: "var(--syn-keyword)" },
  { tag: tags.moduleKeyword, color: "var(--syn-keyword)" },
  { tag: tags.operatorKeyword, color: "var(--syn-keyword)" },
  { tag: tags.definitionKeyword, color: "var(--syn-keyword)" },

  { tag: [tags.bool, tags.null, tags.self], color: "var(--syn-constant)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syn-string)" },
  { tag: tags.regexp, color: "var(--syn-regexp)" },
  { tag: [tags.number, tags.integer, tags.float], color: "var(--syn-number)" },

  { tag: tags.color, color: "var(--syn-number)" },

  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--syn-function)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syn-type)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--syn-property)" },
  { tag: tags.attributeValue, color: "var(--syn-string)" },
  { tag: tags.tagName, color: "var(--syn-tag)" },
  { tag: tags.angleBracket, color: "var(--syn-punct)" },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: "var(--syn-punct)" },
  { tag: tags.meta, color: "var(--syn-comment)" },

  { tag: tags.heading, color: "var(--syn-keyword)", fontWeight: "600" },
  { tag: tags.strong, color: "var(--syn-text)", fontWeight: "600" },
  { tag: tags.emphasis, color: "var(--syn-text)", fontStyle: "italic" },
  { tag: tags.link, color: "var(--syn-function)", textDecoration: "underline" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.invalid, color: "var(--status-error)" },
]);

export const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--canvas)",
      color: "var(--mono-100)",
      fontSize: "var(--editor-font-size, 13px)",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.55",
      overflow: "auto",
    },
    ".cm-content": {
      caretColor: "var(--mono-50)",
      padding: "4px 0",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--mono-50)" },

    ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--mono-600)" },
    "& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      background: "var(--mono-600)",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      background: "var(--mono-650)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "var(--mono-700)",
      outline: "1px solid var(--mono-600)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--canvas)",
      color: "var(--mono-500)",
      border: "none",
      paddingRight: "4px",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 16px", minWidth: "40px" },
    ".cm-activeLine": { backgroundColor: "var(--mono-850)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--mono-850)", color: "var(--mono-200)" },
    ".cm-foldGutter .cm-gutterElement": { color: "var(--mono-500)" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "var(--mono-650)",
      outline: "1px solid var(--mono-500)",
      color: "inherit",
    },
    ".cm-nonmatchingBracket": { color: "var(--status-error)" },

    ".cm-searchMatch": {
      backgroundColor: "var(--mono-600)",
      color: "var(--fg-bright)",
      outline: "1px solid var(--mono-400)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--mono-200)",
      color: "var(--mono-1000)",
      outline: "1px solid var(--mono-50)",
    },
    ".cm-searchMatch span, .cm-searchMatch.cm-searchMatch-selected span": {
      color: "inherit",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--raised)",
      border: "1px solid var(--line-strong)",
      borderRadius: "var(--radius)",
      color: "var(--fg)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--selected)",
      color: "var(--fg-bright)",
    },
    ".cm-tooltip-section:not(:first-child)": { borderTop: "1px solid var(--line)" },

    ".cm-panels": {
      backgroundColor: "var(--raised)",
      color: "var(--fg)",
    },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line-strong)" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line-strong)" },
    ".cm-panel.cm-search label": { color: "var(--fg-muted)" },
    ".cm-textfield": {
      backgroundColor: "var(--panel)",
      border: "1px solid var(--line-strong)",
      borderRadius: "var(--radius)",
      color: "var(--fg)",
    },
    ".cm-textfield:focus": { outline: "1px solid var(--mono-600)" },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--hover)",
      border: "1px solid var(--line-strong)",
      borderRadius: "var(--radius)",
      color: "var(--fg)",
    },
    ".cm-button:hover": { backgroundColor: "var(--selected)" },
    ".cm-button:active": { backgroundImage: "none", backgroundColor: "var(--active)" },

    ".cm-foldPlaceholder": {
      backgroundColor: "var(--mono-700)",
      border: "1px solid var(--line-strong)",
      color: "var(--fg-muted)",
    },
  },
  { dark: true },
);
