import { snippet } from "@codemirror/autocomplete";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

const MARKUP = new Set(["html", "htm", "xhtml", "vue", "svelte"]);
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

interface Node {
  tag: string;
  classes: string[];
  id: string;
  attrs: [string, string][];
  text: string;
  count: number;
  children: Node[];
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let buffer = "";
  let depth = 0;
  for (const ch of input) {
    if (ch === "[" || ch === "{") {
      depth += 1;
      buffer += ch;
    } else if (ch === "]" || ch === "}") {
      depth -= 1;
      buffer += ch;
    } else if (depth === 0 && (ch === ">" || ch === "+" || ch === "^")) {
      if (buffer) tokens.push(buffer);
      buffer = "";
      tokens.push(ch);
    } else {
      buffer += ch;
    }
  }
  if (buffer) tokens.push(buffer);
  return tokens;
}

function parseElement(token: string): Node | null {
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(token);
  let tag = tagMatch ? tagMatch[0] : "";
  let i = tag.length;
  const classes: string[] = [];
  let id = "";
  const attrs: [string, string][] = [];
  let text = "";
  let count = 1;

  while (i < token.length) {
    const ch = token[i];
    if (ch === ".") {
      const m = /^\.([\w$-]+)/.exec(token.slice(i));
      if (!m) return null;
      classes.push(m[1]);
      i += m[0].length;
    } else if (ch === "#") {
      const m = /^#([\w$-]+)/.exec(token.slice(i));
      if (!m) return null;
      id = m[1];
      i += m[0].length;
    } else if (ch === "[") {
      const end = token.indexOf("]", i);
      if (end === -1) return null;
      for (const pair of token.slice(i + 1, end).split(/\s+/).filter(Boolean)) {
        const eq = pair.indexOf("=");
        if (eq === -1) attrs.push([pair, ""]);
        else attrs.push([pair.slice(0, eq), pair.slice(eq + 1).replace(/^["']|["']$/g, "")]);
      }
      i = end + 1;
    } else if (ch === "{") {
      const end = token.indexOf("}", i);
      if (end === -1) return null;
      text = token.slice(i + 1, end);
      i = end + 1;
    } else if (ch === "*") {
      const m = /^\*(\d+)/.exec(token.slice(i));
      if (!m) return null;
      count = parseInt(m[1], 10);
      i += m[0].length;
    } else {
      return null;
    }
  }

  if (!tag && classes.length === 0 && !id && attrs.length === 0 && !text) return null;
  if (!tag) tag = "div";
  return { tag, classes, id, attrs, text, count, children: [] };
}

function number(value: string, index: number): string {
  return value.replace(/\$+/g, (run) => String(index + 1).padStart(run.length, "0"));
}

function cloneNumbered(node: Node, index: number): Node {
  return {
    tag: node.tag,
    classes: node.classes.map((cls) => number(cls, index)),
    id: number(node.id, index),
    attrs: node.attrs.map(([name, value]) => [name, number(value, index)] as [string, string]),
    text: number(node.text, index),
    count: 1,
    children: node.children,
  };
}

function build(tokens: string[]): Node[] | null {
  const root: Node[] = [];
  const stack: Node[] = [];
  let last: Node | null = null;

  const add = (nodes: Node[]) => {
    if (stack.length) stack[stack.length - 1].children.push(...nodes);
    else root.push(...nodes);
    last = nodes[nodes.length - 1];
  };

  for (const token of tokens) {
    if (token === ">") {
      if (last) stack.push(last);
      else return null;
    } else if (token === "+") {

    } else if (token === "^") {
      stack.pop();
    } else {
      const node = parseElement(token);
      if (!node) return null;
      const copies = node.count > 1 ? Array.from({ length: node.count }, (_, k) => cloneNumbered(node, k)) : [node];
      add(copies);
    }
  }
  return root.length ? root : null;
}

function render(nodes: Node[], indent: string): string {
  return nodes
    .map((node) => {
      const attrs: string[] = [];
      if (node.id) attrs.push(`id="${node.id}"`);
      if (node.classes.length) attrs.push(`class="${node.classes.join(" ")}"`);
      for (const [name, value] of node.attrs) attrs.push(value ? `${name}="${value}"` : name);
      const open = `<${node.tag}${attrs.length ? " " + attrs.join(" ") : ""}>`;

      if (VOID_TAGS.has(node.tag)) return `${indent}${open}`;

      if (node.children.length) {
        const inner = render(node.children, indent + "\t");
        return `${indent}${open}\n${inner}\n${indent}</${node.tag}>`;
      }
      const body = node.text ? node.text : "${}";
      return `${indent}${open}${body}</${node.tag}>`;
    })
    .join("\n");
}

const ABBR_CHARS = /[\w.#>+^*[\]{}$=@!:"'/-]/;

function expandAt(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);

  let start = before.length;
  while (start > 0 && ABBR_CHARS.test(before[start - 1])) start -= 1;
  const abbr = before.slice(start);
  if (abbr.length < 2 || !/[a-zA-Z]/.test(abbr[0])) return false;

  if (!/[.#>+*[{]/.test(abbr)) return false;

  const tree = build(tokenize(abbr));
  if (!tree) return false;

  const indentMatch = /^[\t ]*/.exec(line.text);
  const indent = indentMatch ? indentMatch[0] : "";

  const template = render(tree, indent).replace(/^[\t ]*/, "");

  snippet(template)(view, null, line.from + start, pos);
  return true;
}

export function emmet(ext: string): Extension {
  if (!MARKUP.has(ext)) return [];
  return Prec.high(
    keymap.of([
      {
        key: "Tab",
        run: expandAt,
      },
    ]),
  );
}
