import { Braces, FunctionSquare, Hash, Variable, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import { bridge, type OutlineNode } from "@/lib/bridge";
import { languageInstalled } from "@/editor/languages";
import { useT } from "@/lib/i18n";
import { cn, extname } from "@/lib/utils";
import { useActiveTab, useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";

interface Symbol {
  name: string;
  kind: "function" | "class" | "const" | "heading";
  line: number;
}

type Kind = Symbol["kind"];

interface Pattern {
  re: RegExp;
  kind: Kind;

  group?: number;
}

const JS: Pattern[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/, kind: "function" },
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/, kind: "class" },
  { re: /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z0-9_$]+)/, kind: "class" },
  { re: /^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*[:=][^=]*(?:=>|\bfunction\b)/, kind: "function" },
  { re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)/, kind: "const" },
];

const CLIKE: Pattern[] = [
  { re: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|override|virtual|async|open|data|suspend|implicit|case)\s+)*(?:class|interface|struct|enum|record|object|trait)\s+([A-Za-z0-9_]+)/, kind: "class" },
  { re: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|override|virtual|async|suspend|inline|operator|tailrec)\s+)*(?:fun|def)\s+([A-Za-z0-9_]+)/, kind: "function" },
  { re: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|override|virtual|async|synchronized|native)\s+)+(?:[A-Za-z0-9_<>[\],.?]+\s+)([A-Za-z0-9_]+)\s*\(/, kind: "function", group: 1 },
  { re: /^\s*(?:(?:public|private|protected|internal)\s+)?(?:val|var|const)\s+([A-Za-z0-9_]+)/, kind: "const" },
];

const C_LIKE: Pattern[] = [
  { re: /^\s*(?:typedef\s+)?(?:struct|union|enum|class)\s+([A-Za-z0-9_]+)/, kind: "class" },
  { re: /^\s*(?:[A-Za-z_][\w:<>,*&\s]+?\s[*&]?)([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*\{?\s*$/, kind: "function" },
  { re: /^\s*#define\s+([A-Za-z0-9_]+)/, kind: "const" },
];

const LANGUAGE_PATTERNS: Record<string, Pattern[]> = {

  js: JS, jsx: JS, mjs: JS, cjs: JS, ts: JS, tsx: JS, mts: JS, cts: JS,

  c: C_LIKE, h: C_LIKE, cpp: C_LIKE, cc: C_LIKE, cxx: C_LIKE, hpp: C_LIKE, hh: C_LIKE,

  php: [
    { re: /^\s*(?:abstract\s+|final\s+)*(?:class|interface|trait|enum)\s+([A-Za-z0-9_]+)/, kind: "class" },
    { re: /^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?\s*([A-Za-z0-9_]+)/, kind: "function" },
    { re: /^\s*(?:const\s+([A-Z0-9_]+)|define\s*\(\s*['"]([A-Za-z0-9_]+))/, kind: "const" },
  ],
  py: [
    { re: /^\s*class\s+([A-Za-z0-9_]+)/, kind: "class" },
    { re: /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)/, kind: "function" },
    { re: /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/, kind: "const" },
  ],

  cs: CLIKE, csx: CLIKE, java: CLIKE, kt: CLIKE, kts: CLIKE, scala: CLIKE, sc: CLIKE,

  go: [
    { re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/, kind: "function" },
    { re: /^type\s+([A-Za-z0-9_]+)/, kind: "class" },
    { re: /^(?:const|var)\s+([A-Za-z0-9_]+)/, kind: "const" },
  ],
  rb: [
    { re: /^\s*(?:class|module)\s+([A-Za-z0-9_:]+)/, kind: "class" },
    { re: /^\s*def\s+(?:self\.)?([A-Za-z0-9_?!=]+)/, kind: "function" },
    { re: /^\s*([A-Z][A-Za-z0-9_]*)\s*=/, kind: "const" },
  ],
  rs: [
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|union|type)\s+([A-Za-z0-9_]+)/, kind: "class" },
    { re: /^\s*impl(?:<[^>]*>)?\s+(?:[A-Za-z0-9_:<>, ]+\s+for\s+)?([A-Za-z0-9_]+)/, kind: "class" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z0-9_]+)/, kind: "function" },

    { re: /^(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(?:mut\s+)?([A-Za-z0-9_]+)/, kind: "const" },
  ],
  ex: [
    { re: /^\s*def(?:module|protocol|impl)\s+([A-Za-z0-9_.]+)/, kind: "class" },
    { re: /^\s*(?:defp?|defmacrop?|defdelegate|defguard)\s+([a-z_][A-Za-z0-9_?!]*)/, kind: "function" },
    { re: /^\s*@([a-z_][A-Za-z0-9_]*)\s+/, kind: "const" },
  ],
  erl: [
    { re: /^-module\(([a-z][A-Za-z0-9_]*)\)/, kind: "class" },
    { re: /^([a-z][A-Za-z0-9_]*)\s*\(/, kind: "function" },
    { re: /^-(define|record)\(\s*([A-Za-z0-9_]+)/, kind: "const", group: 2 },
  ],

  sql: [
    { re: /^\s*create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?(?:table|view|index|schema|database)\s+(?:if\s+not\s+exists\s+)?[`"[]?([A-Za-z0-9_.]+)/i, kind: "class" },
    { re: /^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure|trigger)\s+[`"[]?([A-Za-z0-9_.]+)/i, kind: "function" },
    { re: /^\s*(?:with|,)\s+([A-Za-z0-9_]+)\s+as\s*\(/i, kind: "function" },
    { re: /^\s*(?:alter|drop)\s+(?:table|view|index)\s+(?:if\s+exists\s+)?[`"[]?([A-Za-z0-9_.]+)/i, kind: "class" },
    { re: /^\s*insert\s+into\s+[`"[]?([A-Za-z0-9_.]+)/i, kind: "const" },
    { re: /^\s*update\s+[`"[]?([A-Za-z0-9_.]+)/i, kind: "const" },
    { re: /\bfrom\s+[`"[]?([A-Za-z0-9_.]+)/i, kind: "const" },
  ],
  graphql: [
    { re: /^\s*(?:type|input|interface|enum|union|scalar|schema)\s+([A-Za-z0-9_]+)/, kind: "class" },
    { re: /^\s*(?:query|mutation|subscription|fragment)\s+([A-Za-z0-9_]+)/, kind: "function" },
  ],
  wat: [
    { re: /^\s*\(\s*(?:func|global|memory|table)\s+\$([A-Za-z0-9_.$-]+)/, kind: "function" },
    { re: /^\s*\(\s*(?:module|type)\s+\$?([A-Za-z0-9_.$-]*)/, kind: "class" },
  ],

  html: [
    { re: /<h[1-6][^>]*>\s*([^<]+?)\s*</i, kind: "heading" },
    { re: /<title[^>]*>\s*([^<]+?)\s*</i, kind: "heading" },
    { re: /<(?:section|article|header|footer|nav|main|form|table|div)\b[^>]*\bid="([^"]+)"/i, kind: "class" },
    { re: /<script\b[^>]*\bsrc="([^"]+)"/i, kind: "const" },
  ],
  css: [
    { re: /^([.#][A-Za-z0-9_-][^{,]*?)\s*[,{]/, kind: "class" },
    { re: /^\s*@(media|supports|keyframes|font-face|import|layer)\b([^{;]*)/, kind: "const", group: 0 },
    { re: /^\s*(--[A-Za-z0-9_-]+)\s*:/, kind: "const" },
  ],
  md: [{ re: /^(#{1,6})\s+(.*)$/, kind: "heading", group: 2 }],

  json: [{ re: /^\s{0,4}"([^"]+)"\s*:/, kind: "const" }],
};

const ALIASES: Record<string, string> = {
  pyi: "py", pyw: "py",
  phtml: "php", php3: "php", php4: "php", php5: "php", phps: "php",
  exs: "ex", hrl: "erl", mdx: "md",
  ddl: "sql", dml: "sql",
  graphqls: "graphql", gql: "graphql",
  wast: "wat",
  htm: "html", xhtml: "html",
  scss: "css", less: "css", pcss: "css", postcss: "css",
  rake: "rb", gemspec: "rb", ru: "rb",
  markdown: "md",
};

function outline(content: string, ext: string): Symbol[] {
  const patterns = LANGUAGE_PATTERNS[ALIASES[ext] ?? ext];
  if (!patterns || patterns.length === 0) return [];

  const lines = content.split("\n");
  const found: Symbol[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    for (const { re, kind, group } of patterns) {
      const match = re.exec(line);
      if (!match) continue;
      const name = (match[group ?? 1] ?? "").trim();
      if (!name) continue;

      const key = `${kind}:${name}`;
      if (kind === "function" && seen.has(key)) break;
      seen.add(key);
      found.push({ name, kind, line: i + 1 });
      break;
    }
  }
  return found;
}

const ICONS = {
  function: FunctionSquare,
  class: Braces,
  const: Variable,
  heading: Hash,
} as const;

export const TS_EXTENSIONS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);

const LSP_KIND_ICON: Record<number, LucideIcon> = {
  2: Braces, 3: Braces, 5: Braces, 10: Braces, 11: Braces, 23: Braces,
  6: FunctionSquare, 9: FunctionSquare, 12: FunctionSquare, 24: FunctionSquare,
  7: Variable, 8: Variable, 13: Variable, 14: Variable, 22: Variable,
};

export function outlineIcon(kind: string | number): LucideIcon {
  if (typeof kind === "number") return LSP_KIND_ICON[kind] ?? Hash;
  if (/function|method|constructor|getter|setter|call|index/.test(kind)) return FunctionSquare;
  if (/class|interface|enum|module|alias/.test(kind) || kind === "type") return Braces;
  if (/var|const|let|property|parameter|accessor/.test(kind)) return Variable;
  return Hash;
}

function flattenOutline(nodes: OutlineNode[], depth = 0): { node: OutlineNode; depth: number }[] {
  const rows: { node: OutlineNode; depth: number }[] = [];
  for (const node of [...nodes].sort((a, b) => a.offset - b.offset)) {
    rows.push({ node, depth });
    if (node.children && node.children.length) rows.push(...flattenOutline(node.children, depth + 1));
  }
  return rows;
}

function offsetOf(content: string, line: number, column: number): number {
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i += 1) offset += lines[i].length + 1;
  return offset + Math.max(0, column - 1);
}

export function StructurePanel() {
  const tab = useActiveTab();
  const root = useWorkspace((state) => state.root);
  const revealAt = useEditor((state) => state.revealAt);
  const revealOffset = useEditor((state) => state.revealOffset);
  const t = useT();
  const file = tab?.kind === "file" ? tab : null;
  const ext = file ? extname(file.path) : "";

  const [nodes, setNodes] = useState<OutlineNode[] | null>(null);

  useEffect(() => {
    if (!file || !root || !languageInstalled(file.path)) {
      setNodes(null);
      return;
    }
    let alive = true;

    const timer = setTimeout(async () => {
      let result: OutlineNode[] = [];
      try {
        if (TS_EXTENSIONS.has(ext)) {
          await bridge.tsSync(root, file.path, file.content);
          const reply = await bridge.tsNavigationTree(root, file.path);
          result = reply.tree?.children ?? [];
        } else {
          const reply = await bridge.lspDocumentSymbol(file.path);
          result = reply.symbols ?? [];
        }
      } catch {
        result = [];
      }

      if (alive) setNodes(result.length ? result : null);
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [file?.path, file?.content, ext, root]);

  const cursor = useEditor((state) => state.cursor);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const regexSymbols = useMemo(
    () => (file && nodes === null ? outline(file.content, ext) : []),
    [file?.path, file?.content, ext, nodes === null],
  );

  const cursorOffset = useMemo(() => (file ? offsetOf(file.content, cursor.line, cursor.column) : 0), [file?.content, cursor.line, cursor.column]);

  const allRows = useMemo(() => (nodes ? flattenOutline(nodes) : []), [nodes]);
  const rows = q ? allRows.filter((r) => r.node.name.toLowerCase().includes(q)) : allRows;
  const syms = q ? regexSymbols.filter((s) => s.name.toLowerCase().includes(q)) : regexSymbols;

  const activeNodeOffset = useMemo(() => {
    let best = -1;
    for (const { node } of rows) if (node.offset <= cursorOffset && node.offset > best) best = node.offset;
    return best;
  }, [rows, cursorOffset]);
  const activeLine = useMemo(() => {
    let best = -1;
    for (const s of syms) if (s.line <= cursor.line && s.line > best) best = s.line;
    return best;
  }, [syms, cursor.line]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeNodeOffset, activeLine]);

  const isEmpty = nodes ? rows.length === 0 : syms.length === 0;
  const hasSymbols = nodes ? allRows.length > 0 : regexSymbols.length > 0;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Structure")} />
      {file && hasSymbols && (
        <div className="shrink-0 border-b border-line px-2 py-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Filter symbols…")}
            spellCheck={false}
            className="w-full rounded-sm border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {!file ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">{t("Open a file to see its outline.")}</p>
        ) : isEmpty ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">{hasSymbols ? t("No symbols match the filter.") : t("Nothing to outline in this file.")}</p>
        ) : nodes ? (
          rows.map(({ node, depth }, index) => {
            const Icon = outlineIcon(node.kind);
            const active = node.offset === activeNodeOffset;
            return (
              <button
                key={`${node.name}-${node.offset}-${index}`}
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => void revealOffset(file.path, node.offset)}
                title={node.name}
                className={cn("flex w-full items-center gap-2 px-3 text-left text-[12px] transition-colors duration-100 hover:bg-hover", active ? "bg-selected text-fg-bright" : "text-fg")}
                style={{ height: "var(--h-row)", paddingLeft: `${12 + depth * 14}px` }}
              >
                <Icon className="size-3 shrink-0 text-fg-dim" strokeWidth={1.5} />
                <span className="truncate">{node.name}</span>
              </button>
            );
          })
        ) : (
          syms.map((symbol, index) => {
            const Icon = ICONS[symbol.kind];
            const active = symbol.line === activeLine;
            return (
              <button
                key={`${symbol.name}-${symbol.line}-${index}`}
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => void revealAt(file.path, symbol.line)}
                className={cn("flex w-full items-center gap-2 px-3 text-left text-[12px] transition-colors duration-100 hover:bg-hover", active ? "bg-selected text-fg-bright" : "text-fg")}
                style={{ height: "var(--h-row)" }}
              >
                <Icon className="size-3 shrink-0 text-fg-dim" strokeWidth={1.5} />
                <span className="truncate">{symbol.name}</span>
                <span className="ml-auto shrink-0 tabular-nums text-fg-faint">{symbol.line}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
