

const RUNNERS: Readonly<Record<string, string>> = {

  py: "python",
  pyw: "python",

  js: "node",
  mjs: "node",
  cjs: "node",
  ts: "node",
  mts: "node",
  cts: "node",

  rb: "ruby",
  php: "php",
  exs: "elixir",

  go: "go run",

  java: "java",
};

const suffixOf = (path: string): string => {
  const name = path.replace(/^.*[\\/]/, "");
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export function runnerFor(path: string): string | null {
  return RUNNERS[suffixOf(path)] ?? null;
}

export function runCommand(path: string, root: string | null): string | null {
  const runner = runnerFor(path);
  if (!runner) return null;

  let target = path;
  if (root && path.toLowerCase().startsWith(root.toLowerCase())) {
    const rest = path.slice(root.length).replace(/^[\\/]+/, "");
    if (rest) target = rest;
  }
  return `${runner} "${target}"`;
}
