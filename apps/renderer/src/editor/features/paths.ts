import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";

import { bridge } from "@/lib/bridge";
import { dirname } from "@/lib/utils";

const PATH_IN_STRING = /(['"`])((?:\.{1,2}\/|\/|~\/)[^'"`\n]*)$/;

const cache = new Map<string, { at: number; names: { name: string; dir: boolean }[] }>();
const CACHE_MS = 4000;

async function listDir(path: string): Promise<{ name: string; dir: boolean }[]> {
  const hit = cache.get(path);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_MS) return hit.names;
  try {
    const entries = await bridge.readDir(path);
    const names = (entries ?? []).map((entry) => ({
      name: entry.name,
      dir: Boolean(entry.isDirectory),
    }));
    cache.set(path, { at: now, names });
    return names;
  } catch {
    return [];
  }
}

function resolveFragment(fileDir: string, projectRoot: string, fragment: string): string {
  const base = fragment.startsWith("/") || fragment.startsWith("~/") ? projectRoot : fileDir;
  const parts = base.split(/[\\/]/).filter(Boolean);
  const rel = fragment.replace(/^~\//, "").replace(/^\//, "");

  for (const part of rel.split("/").slice(0, -1)) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const joined = parts.join("/");

  return /^[A-Za-z]:$/.test(parts[0] ?? "") ? joined : "/" + joined;
}

function pathCompletionSource(filePath: string, projectRoot: string | null) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const match = PATH_IN_STRING.exec(before);
    if (!match) return null;

    const fragment = match[2]!;
    const typed = fragment.slice(fragment.lastIndexOf("/") + 1);

    if (!context.explicit && !fragment.endsWith("/") && typed.length === 0) return null;

    const dir = resolveFragment(dirname(filePath), projectRoot ?? dirname(filePath), fragment);
    const entries = await listDir(dir);
    if (entries.length === 0) return null;

    return {
      from: context.pos - typed.length,
      options: entries
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => ({
          label: entry.dir ? entry.name + "/" : entry.name,
          type: entry.dir ? "folder" : "file",

          boost: entry.dir ? 1 : 0,
        })),
      validFor: /^[^'"`/\n]*$/,
    };
  };
}

export function pathCompletion(filePath: string, projectRoot: string | null): Extension {
  const data = [{ autocomplete: pathCompletionSource(filePath, projectRoot) }];
  return EditorState.languageData.of(() => data);
}
