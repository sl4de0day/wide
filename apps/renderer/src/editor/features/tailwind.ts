import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";

import { bridge } from "@/lib/bridge";

const NAMESPACES: Record<string, { prefixes: string[]; color?: boolean }> = {
  color: {
    prefixes: [
      "bg", "text", "border", "ring", "outline", "fill", "stroke",
      "decoration", "divide", "accent", "caret", "shadow", "from", "via", "to",
    ],
    color: true,
  },
  spacing: { prefixes: ["p", "px", "py", "pt", "pr", "pb", "pl", "m", "mx", "my", "mt", "mr", "mb", "ml", "gap", "gap-x", "gap-y", "w", "h", "size", "space-x", "space-y", "inset", "top", "right", "bottom", "left"] },
  font: { prefixes: ["font"] },
  text: { prefixes: ["text"] },
  radius: { prefixes: ["rounded"] },
  shadow: { prefixes: ["shadow"] },
  blur: { prefixes: ["blur"] },
  tracking: { prefixes: ["tracking"] },
  leading: { prefixes: ["leading"] },
  breakpoint: { prefixes: [] },
  container: { prefixes: ["max-w"] },
  animate: { prefixes: ["animate"] },
  ease: { prefixes: ["ease"] },
  aspect: { prefixes: ["aspect"] },
  perspective: { prefixes: ["perspective"] },
};

const STRUCTURAL = [
  "flex", "inline-flex", "grid", "inline-grid", "block", "inline-block", "inline",
  "hidden", "contents", "table", "flow-root",
  "flex-row", "flex-row-reverse", "flex-col", "flex-col-reverse",
  "flex-wrap", "flex-nowrap", "flex-1", "flex-auto", "flex-initial", "flex-none",
  "grow", "grow-0", "shrink", "shrink-0", "basis-0", "basis-full", "basis-auto",
  "items-start", "items-center", "items-end", "items-baseline", "items-stretch",
  "justify-start", "justify-center", "justify-end", "justify-between", "justify-around", "justify-evenly",
  "self-start", "self-center", "self-end", "self-stretch", "self-auto",
  "content-center", "content-start", "content-end", "content-between",
  "place-items-center", "place-content-center",
  "static", "relative", "absolute", "fixed", "sticky",
  "inset-0", "top-0", "right-0", "bottom-0", "left-0", "z-0", "z-10", "z-20", "z-50",
  "w-full", "w-auto", "w-fit", "w-min", "w-max", "w-screen",
  "h-full", "h-auto", "h-fit", "h-min", "h-max", "h-screen", "min-h-0", "min-w-0",
  "max-w-full", "max-w-none",
  "overflow-auto", "overflow-hidden", "overflow-visible", "overflow-scroll",
  "overflow-x-auto", "overflow-y-auto", "truncate", "text-ellipsis", "whitespace-nowrap", "whitespace-pre",
  "text-left", "text-center", "text-right", "text-justify",
  "font-thin", "font-light", "font-normal", "font-medium", "font-semibold", "font-bold",
  "italic", "not-italic", "underline", "line-through", "no-underline", "uppercase", "lowercase", "capitalize",
  "tabular-nums", "antialiased",
  "border", "border-0", "border-2", "border-t", "border-r", "border-b", "border-l",
  "rounded", "rounded-none", "rounded-full",
  "opacity-0", "opacity-50", "opacity-100",
  "cursor-pointer", "cursor-default", "cursor-not-allowed", "select-none", "pointer-events-none",
  "transition", "transition-colors", "transition-opacity", "transition-transform",
  "duration-100", "duration-150", "duration-200", "duration-300",
  "shrink-0", "isolate", "sr-only",
];

const BASE_VARIANTS = [
  "hover", "focus", "focus-visible", "focus-within", "active", "disabled",
  "first", "last", "odd", "even", "group-hover", "peer-focus",
  "dark", "print", "motion-safe", "motion-reduce", "rtl", "ltr",
];

interface Suggestion {
  label: string;
  detail?: string;

  swatch?: string;
}

function suggestionsFor(tokens: { name: string; value: string }[]): Suggestion[] {
  const out: Suggestion[] = [];
  const variants = [...BASE_VARIANTS];

  for (const token of tokens) {
    const match = /^--([a-z]+)-(.+)$/.exec(token.name);
    if (!match) continue;
    const [, namespace, rest] = match as unknown as [string, string, string];
    if (namespace === "breakpoint") {
      variants.push(rest);
      continue;
    }
    const spec = NAMESPACES[namespace];
    if (!spec) continue;
    for (const prefix of spec.prefixes) {
      out.push({
        label: `${prefix}-${rest}`,
        detail: token.value,
        swatch: spec.color ? token.value : undefined,
      });
    }
  }

  for (const name of STRUCTURAL) out.push({ label: name });

  for (const variant of variants) out.push({ label: `${variant}:`, detail: "variant" });

  return out;
}

const CLASS_ATTRIBUTE = /\b(?:class|className)\s*=\s*(?:"([^"]*)|'([^']*)|\{?\s*`([^`]*))$/;

function classContext(before: string): string | null {
  const match = CLASS_ATTRIBUTE.exec(before);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

const CLASS_EXTENSIONS = new Set([
  "html", "htm", "xhtml",
  "jsx", "tsx", "js", "ts",
  "php", "phtml",
  "ex", "exs",
  "erb", "rb",
  "vue", "svelte",
]);

const themeCache = new Map<string, Promise<Suggestion[]>>();

function suggestionsForProject(root: string): Promise<Suggestion[]> {
  let pending = themeCache.get(root);
  if (!pending) {
    pending = bridge
      .projectTailwind(root)
      .then((result) => (result?.usesTailwind ? suggestionsFor(result.tokens ?? []) : []))
      .catch(() => []);
    themeCache.set(root, pending);
  }
  return pending;
}

export function forgetTailwindTheme(root?: string): void {
  if (root) themeCache.delete(root);
  else themeCache.clear();
}

function tailwindSource(ext: string, root: string | null) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (!root || !CLASS_EXTENSIONS.has(ext)) return null;
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const inside = classContext(before);
    if (inside === null) return null;

    const suggestions = await suggestionsForProject(root);
    if (suggestions.length === 0) return null;

    const word = inside.split(/\s+/).pop() ?? "";
    const afterColon = word.lastIndexOf(":") + 1;
    const typed = word.slice(afterColon);

    return {
      from: context.pos - typed.length,
      options: suggestions.map((item) => ({
        label: item.label,
        detail: item.detail,
        type: item.swatch ? "color" : item.label.endsWith(":") ? "keyword" : "class",
        info: item.swatch
          ? () => {
              const chip = document.createElement("span");
              chip.className = "cm-color-swatch";
              const fill = document.createElement("span");
              fill.className = "cm-color-swatch-fill";
              fill.style.background = item.swatch!;
              chip.appendChild(fill);
              const wrap = document.createElement("span");
              wrap.appendChild(chip);
              wrap.appendChild(document.createTextNode(item.detail ?? ""));
              return wrap;
            }
          : undefined,
      })),
      validFor: /^[\w-]*$/,
    };
  };
}

export function tailwindCompletion(ext: string, root: string | null): Extension {

  const data = [{ autocomplete: tailwindSource(ext, root) }];
  return EditorState.languageData.of(() => data);
}
