import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";

interface Snip {

  label: string;

  detail: string;

  template: string;
}

const JS: Snip[] = [
  { label: "log", detail: "console.log", template: "console.log(${})" },
  { label: "clg", detail: "console.log", template: "console.log(${})" },
  { label: "warn", detail: "console.warn", template: "console.warn(${})" },
  { label: "error", detail: "console.error", template: "console.error(${})" },
  { label: "fn", detail: "function", template: "function ${name}(${params}) {\n\t${}\n}" },
  { label: "afn", detail: "arrow function", template: "const ${name} = (${params}) => {\n\t${}\n}" },
  { label: "iife", detail: "immediately-invoked function", template: "(() => {\n\t${}\n})()" },
  { label: "for", detail: "for loop", template: "for (let ${i} = 0; ${i} < ${array}.length; ${i}++) {\n\t${}\n}" },
  { label: "forof", detail: "for…of", template: "for (const ${item} of ${iterable}) {\n\t${}\n}" },
  { label: "forin", detail: "for…in", template: "for (const ${key} in ${object}) {\n\t${}\n}" },
  { label: "foreach", detail: "forEach", template: "${array}.forEach((${item}) => {\n\t${}\n})" },
  { label: "map", detail: "map", template: "${array}.map((${item}) => ${})" },
  { label: "filter", detail: "filter", template: "${array}.filter((${item}) => ${})" },
  { label: "reduce", detail: "reduce", template: "${array}.reduce((${acc}, ${item}) => ${}, ${initial})" },
  { label: "if", detail: "if", template: "if (${condition}) {\n\t${}\n}" },
  { label: "ifelse", detail: "if…else", template: "if (${condition}) {\n\t${}\n} else {\n\t${}\n}" },
  { label: "switch", detail: "switch", template: "switch (${value}) {\n\tcase ${a}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}" },
  { label: "while", detail: "while", template: "while (${condition}) {\n\t${}\n}" },
  { label: "tryc", detail: "try…catch", template: "try {\n\t${}\n} catch (${error}) {\n\t${}\n}" },
  { label: "trycf", detail: "try…catch…finally", template: "try {\n\t${}\n} catch (${error}) {\n\t${}\n} finally {\n\t${}\n}" },
  { label: "func", detail: "async function", template: "async function ${name}(${params}) {\n\t${}\n}" },
  { label: "prom", detail: "new Promise", template: "new Promise((resolve, reject) => {\n\t${}\n})" },
  { label: "imp", detail: "import from", template: 'import ${what} from "${module}"' },
  { label: "impd", detail: "import destructured", template: 'import { ${what} } from "${module}"' },
  { label: "exp", detail: "export const", template: "export const ${name} = ${}" },
  { label: "expd", detail: "export default", template: "export default ${}" },
  { label: "tof", detail: "typeof guard", template: 'if (typeof ${value} === "${string}") {\n\t${}\n}' },
];

const REACT: Snip[] = [
  {
    label: "rfc",
    detail: "React function component",
    template: "export function ${Name}() {\n\treturn (\n\t\t${}\n\t);\n}",
  },
  { label: "useState", detail: "useState hook", template: "const [${state}, set${State}] = useState(${initial})" },
  { label: "useEffect", detail: "useEffect hook", template: "useEffect(() => {\n\t${}\n}, [${deps}])" },
  { label: "useMemo", detail: "useMemo hook", template: "const ${value} = useMemo(() => ${}, [${deps}])" },
  { label: "useCallback", detail: "useCallback hook", template: "const ${fn} = useCallback(() => {\n\t${}\n}, [${deps}])" },
  { label: "useRef", detail: "useRef hook", template: "const ${ref} = useRef(${initial})" },
];

const HTML: Snip[] = [
  {
    label: "html5",
    detail: "HTML5 document",
    template:
      '<!doctype html>\n<html lang="${en}">\n<head>\n\t<meta charset="utf-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1">\n\t<title>${title}</title>\n</head>\n<body>\n\t${}\n</body>\n</html>',
  },
  { label: "link", detail: "stylesheet link", template: '<link rel="stylesheet" href="${href}">' },
  { label: "script", detail: "script src", template: '<script src="${src}"></script>' },
  { label: "a", detail: "anchor", template: '<a href="${href}">${text}</a>' },
  { label: "img", detail: "image", template: '<img src="${src}" alt="${alt}">' },
  { label: "form", detail: "form", template: '<form action="${action}" method="${post}">\n\t${}\n</form>' },
  { label: "input", detail: "labelled input", template: '<label>\n\t${label}\n\t<input type="${text}" name="${name}">\n</label>' },
  { label: "ul", detail: "list", template: "<ul>\n\t<li>${}</li>\n</ul>" },
];

const CSS: Snip[] = [
  { label: "flex", detail: "flex row", template: "display: flex;\nalign-items: ${center};\njustify-content: ${center};" },
  { label: "flexcol", detail: "flex column", template: "display: flex;\nflex-direction: column;\ngap: ${1rem};" },
  { label: "grid", detail: "grid", template: "display: grid;\ngrid-template-columns: repeat(${3}, 1fr);\ngap: ${1rem};" },
  { label: "center", detail: "absolute center", template: "position: absolute;\ntop: 50%;\nleft: 50%;\ntransform: translate(-50%, -50%);" },
  { label: "media", detail: "media query", template: "@media (min-width: ${768px}) {\n\t${}\n}" },
  { label: "trans", detail: "transition", template: "transition: ${all} ${150ms} ease;" },
  { label: "var", detail: "custom property", template: "--${name}: ${value};" },
  { label: "kf", detail: "keyframes", template: "@keyframes ${name} {\n\tfrom {\n\t\t${}\n\t}\n\tto {\n\t}\n}" },
];

function snipsFor(ext: string): Snip[] {
  const js = ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"];
  const react = ["jsx", "tsx"];
  const html = ["html", "htm", "xhtml", "vue", "svelte"];
  const css = ["css", "scss", "less", "pcss", "postcss"];
  if (js.includes(ext)) return react.includes(ext) ? [...JS, ...REACT] : JS;
  if (html.includes(ext)) return HTML;
  if (css.includes(ext)) return CSS;
  return [];
}

function toCompletions(snips: Snip[]): Completion[] {
  return snips.map((snip) =>
    snippetCompletion(snip.template, {
      label: snip.label,
      detail: snip.detail,
      type: "snippet",

      boost: -20,
    }),
  );
}

function snippetSource(options: Completion[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w$-]+/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return { from: word.from, options, validFor: /^[\w$-]*$/ };
  };
}

export function snippets(ext: string): Extension {
  const options = toCompletions(snipsFor(ext));
  if (options.length === 0) return [];

  const data = [{ autocomplete: snippetSource(options) }];
  return EditorState.languageData.of(() => data);
}
