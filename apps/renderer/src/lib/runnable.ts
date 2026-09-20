
import { bridge } from "./bridge";

const RUNNERS: Readonly<Record<string, string>> = {
  py: "python",
  pyw: "python",
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

const runtimeCache = new Map<string, string>();

async function detectJsRuntime(root: string | null): Promise<string> {
  if (!root) return "node";
  if (runtimeCache.has(root)) return runtimeCache.get(root)!;
  try {
    const entries = await bridge.readDir(root);
    const names = entries.map((e) => e.name);
    if (names.includes("bun.lockb") || names.includes("bun.lock")) {
      runtimeCache.set(root, "bun");
      return "bun";
    }
    if (names.includes("deno.json") || names.includes("deno.jsonc")) {
      runtimeCache.set(root, "deno run");
      return "deno run";
    }
    if (names.includes("package.json")) {
      runtimeCache.set(root, "node");
      return "node";
    }
  } catch {
  }
  runtimeCache.set(root, "node");
  return "node";
}

export async function runnerFor(path: string, root: string | null): Promise<string | null> {
  const ext = suffixOf(path);
  if (["js", "mjs", "cjs", "ts", "mts", "cts"].includes(ext)) {
    return await detectJsRuntime(root);
  }
  return RUNNERS[ext] ?? null;
}

export async function runCommand(path: string, root: string | null): Promise<string | null> {
  const runner = await runnerFor(path, root);
  if (!runner) return null;

  let dir: string;
  let file: string;

  if (root && path.toLowerCase().startsWith(root.toLowerCase())) {
    dir = root;
    file = path.slice(root.length).replace(/^[\\/]+/, "");
    if (!file) file = path;
  } else {
    const match = path.match(/^(.*)[\\/]([^\\/]+)$/);
    if (match) {
      dir = match[1];
      file = match[2];
    } else {
      dir = ".";
      file = path;
    }
  }

  return `cd "${dir}" && ${runner} "${file}"`;
}
