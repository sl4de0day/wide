import type { Extension } from "@codemirror/state";

import { basename, extname } from "@/lib/utils";
import { extensionById, languageExtensionFor } from "@/lib/marketplace";
import { useExtensions } from "@/stores/extensions";

type Loader = () => Promise<Extension>;

const GRAMMARS: ReadonlyArray<{

  label: string;
  exts: readonly string[];
  load: Loader;
}> = [

  {
    label: "JavaScript",
    exts: ["js", "jsx", "mjs", "cjs"],
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  },

  {
    label: "TypeScript",
    exts: ["ts", "mts", "cts"],
    load: async () =>
      (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  },
  {
    label: "TypeScript",
    exts: ["tsx"],
    load: async () =>
      (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
  },

  {
    label: "HTML",
    exts: ["html", "htm", "xhtml"],
    load: async () => (await import("@codemirror/lang-html")).html(),
  },

  {
    label: "Vue",
    exts: ["vue"],
    load: async () => (await import("@codemirror/lang-vue")).vue(),
  },
  {
    label: "Svelte",
    exts: ["svelte"],
    load: async () => (await import("@replit/codemirror-lang-svelte")).svelte(),
  },

  {
    label: "CSS",
    exts: ["css", "scss", "less", "pcss", "postcss"],
    load: async () => (await import("@codemirror/lang-css")).css(),
  },

  {
    label: "PHP",
    exts: ["php", "phtml", "php3", "php4", "php5", "phps"],
    load: async () => (await import("@codemirror/lang-php")).php(),
  },

  {
    label: "Python",
    exts: ["py", "pyi", "pyw"],
    load: async () => (await import("@codemirror/lang-python")).python(),
  },

  {
    label: "C#",
    exts: ["cs", "csx"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/clike")).csharp);
    },
  },

  {
    label: "Java",
    exts: ["java"],
    load: async () => (await import("@codemirror/lang-java")).java(),
  },

  {
    label: "Go",
    exts: ["go"],
    load: async () => (await import("@codemirror/lang-go")).go(),
  },

  {
    label: "Ruby",
    exts: ["rb", "rake", "gemspec", "ru"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/ruby")).ruby);
    },
  },

  {
    label: "Rust",
    exts: ["rs"],
    load: async () => (await import("@codemirror/lang-rust")).rust(),
  },

  {
    label: "Elixir",
    exts: ["ex", "exs"],
    load: async () => (await import("codemirror-lang-elixir")).elixir(),
  },

  {
    label: "Kotlin",
    exts: ["kt", "kts"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/clike")).kotlin);
    },
  },

  {
    label: "SQL",
    exts: ["sql", "ddl", "dml"],
    load: async () => (await import("@codemirror/lang-sql")).sql(),
  },

  {
    label: "GraphQL",
    exts: ["graphql", "graphqls", "gql"],
    load: async () => (await import("cm6-graphql")).graphql(),
  },

  {
    label: "WebAssembly",
    exts: ["wat", "wast"],
    load: async () => (await import("@codemirror/lang-wast")).wast(),
  },

  {
    label: "Scala",
    exts: ["scala", "sc"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/clike")).scala);
    },
  },

  {
    label: "Erlang",
    exts: ["erl", "hrl"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/erlang")).erlang);
    },
  },

  {
    label: "JSON",
    exts: ["json", "jsonc", "map", "webmanifest"],
    load: async () => {
      const [{ json, jsonParseLinter }, { linter }] = await Promise.all([
        import("@codemirror/lang-json"),
        import("@codemirror/lint"),
      ]);
      return [json(), linter(jsonParseLinter())];
    },
  },
  {
    label: "Markdown",
    exts: ["md", "markdown"],
    load: async () => (await import("@codemirror/lang-markdown")).markdown(),
  },
  {
    label: "YAML",
    exts: ["yaml", "yml"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/yaml")).yaml);
    },
  },
  {
    label: "TOML",
    exts: ["toml"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/toml")).toml);
    },
  },
  {
    label: "Dockerfile",
    exts: ["dockerfile"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile);
    },
  },
  {
    label: "Shell",
    exts: ["sh", "bash", "zsh", "ksh"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/shell")).shell);
    },
  },
  {
    label: "PowerShell",
    exts: ["ps1", "psm1", "psd1"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/powershell")).powerShell);
    },
  },
  {
    label: "Properties",
    exts: ["env", "ini", "properties", "conf", "cfg"],
    load: async () => {
      const { StreamLanguage } = await import("@codemirror/language");
      return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/properties")).properties);
    },
  },
];

const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  ".env": "env",
  ".gitignore": "properties",
  ".editorconfig": "properties",
  ".npmrc": "properties",
  ".dockerignore": "properties",
};

function extFor(path: string): string {
  const ext = extname(path);
  if (ext) return ext;
  const name = basename(path).toLowerCase();
  const dot = name.startsWith(".") ? name : name.split(".")[0];
  return BY_NAME[name] ?? BY_NAME[dot] ?? "";
}

const LOADERS: Record<string, Loader> = {};
const LABELS: Record<string, string> = {};
for (const { exts, load, label } of GRAMMARS) {
  for (const ext of exts) {
    LOADERS[ext] = load;
    LABELS[ext] = label;
  }
}

LABELS.scss = "SCSS";
LABELS.less = "Less";
LABELS.postcss = "PostCSS";
LABELS.pcss = "PostCSS";

export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(LOADERS);

export function languageLabel(path: string): string {

  if (!languageInstalled(path)) return "Plain text";
  return LABELS[extFor(path)] ?? "Plain Text";
}

export function languageInstalled(path: string): boolean {
  const owner = languageExtensionFor(path);
  if (!owner) return true;
  return useExtensions.getState().installed.has(owner);
}

export async function preloadGrammar(extensionId: string): Promise<boolean> {
  const entry = extensionById(extensionId);
  const suffix = entry?.fileExtensions.find((ext) => LOADERS[ext]);
  if (!suffix) return false;
  try {
    await LOADERS[suffix]();
    return true;
  } catch (error) {
    console.error(`Could not load the grammar for ${extensionId}`, error);
    return false;
  }
}

export async function languageFor(path: string): Promise<Extension | null> {
  const loader = LOADERS[extFor(path)];
  if (!loader) return null;
  if (!languageInstalled(path)) return null;
  try {
    return await loader();
  } catch (error) {
    console.error(`Could not load language support for ${path}`, error);
    return null;
  }
}
