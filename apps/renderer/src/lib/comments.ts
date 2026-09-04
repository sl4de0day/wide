

const BY_EXTENSION: Readonly<Record<string, string>> = {
  cjs: "javascript", js: "javascript", jsx: "javascript", mjs: "javascript",
  cts: "typescript", mts: "typescript", ts: "typescript", tsx: "typescript",
  htm: "html", html: "html", xhtml: "html",
  css: "css", less: "css", pcss: "css", postcss: "css", scss: "css",
  php: "php", php3: "php", php4: "php", php5: "php", phps: "php", phtml: "php",
  py: "python", pyi: "python", pyw: "python",
  cs: "csharp", csx: "csharp",
  java: "java",
  go: "go",
  gemspec: "ruby", rake: "ruby", rb: "ruby", ru: "ruby",
  rs: "rust",
  ex: "elixir", exs: "elixir",
  kt: "kotlin", kts: "kotlin",
  ddl: "sql", dml: "sql", sql: "sql",
  gql: "graphql", graphql: "graphql", graphqls: "graphql",
  wast: "wasm", wat: "wasm",
  sc: "scala", scala: "scala",
  erl: "erlang", hrl: "erlang",
};

export function commentLanguageFor(fileName: string): string | null {
  const name = fileName.toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}
