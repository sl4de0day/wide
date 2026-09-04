import { create } from "zustand";

import { bridge, type SearchFile } from "@/lib/bridge";
import { useEditor } from "./editor";
import { useWorkspace } from "./workspace";

export interface SearchFlags {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

interface SearchState {
  query: string;
  flags: SearchFlags;
  files: SearchFile[];
  total: number;
  truncated: boolean;
  running: boolean;
  error: string | null;
  collapsed: Set<string>;

  setQuery(query: string): void;
  toggleFlag(name: keyof SearchFlags): void;
  toggleFile(path: string): void;
  run(): Promise<void>;

  replaceAll(replacement: string): Promise<{ filesChanged: number; replacements: number; skipped: number }>;
}

let runId = 0;

let debounce: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 250;

function schedule(run: () => void) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(run, DEBOUNCE_MS);
}

export const useSearch = create<SearchState>((set, get) => ({
  query: "",
  flags: { caseSensitive: false, wholeWord: false, regexp: false },
  files: [],
  total: 0,
  truncated: false,
  running: false,
  error: null,
  collapsed: new Set<string>(),

  setQuery: (query) => {
    set({ query });
    schedule(() => void get().run());
  },

  toggleFlag: (name) => {
    set((state) => ({ flags: { ...state.flags, [name]: !state.flags[name] } }));

    if (debounce) clearTimeout(debounce);
    void get().run();
  },

  toggleFile: (path) =>
    set((state) => {
      const collapsed = new Set(state.collapsed);
      if (collapsed.has(path)) collapsed.delete(path);
      else collapsed.add(path);
      return { collapsed };
    }),

  run: async () => {
    const { query, flags } = get();
    const workspace = useWorkspace.getState();

    const roots = workspace.folders.filter((folder) => !folder.missing).map((folder) => folder.path);
    if (roots.length === 0 && workspace.root) roots.push(workspace.root);

    if (roots.length === 0 || query.trim().length < 2) {
      set({ files: [], total: 0, truncated: false, running: false, error: null });
      return;
    }
    const id = (runId += 1);
    set({ running: true, error: null });

    const results = await Promise.all(
      roots.map((root) => bridge.searchInFiles(root, { query, ...flags })),
    );
    if (id !== runId) return;

    const failure = results.find((result) => result?.error);
    if (failure?.error) {
      set({ running: false, error: failure.error, files: [], total: 0 });
      return;
    }
    set({
      running: false,
      files: results.flatMap((result) => result.files ?? []),
      total: results.reduce((sum, result) => sum + (result.total ?? 0), 0),
      truncated: results.some((result) => Boolean(result.truncated)),
      collapsed: new Set<string>(),
    });
  },

  replaceAll: async (replacement) => {
    const { query, flags } = get();
    const workspace = useWorkspace.getState();
    const roots = workspace.folders.filter((folder) => !folder.missing).map((folder) => folder.path);
    if (roots.length === 0 && workspace.root) roots.push(workspace.root);
    const summary = { filesChanged: 0, replacements: 0, skipped: 0 };
    if (roots.length === 0 || query.trim().length < 2) return summary;

    const dirty = useEditor
      .getState()
      .tabs.filter((tab) => tab.kind === "file" && tab.content !== tab.savedContent)
      .map((tab) => tab.path);
    summary.skipped = dirty.length;

    set({ running: true, error: null });
    for (const root of roots) {
      const reply = await bridge.replaceInFiles(root, { query, ...flags }, replacement, dirty);
      if (!reply.ok) {
        set({ running: false, error: reply.error ?? "The replace could not run." });
        return summary;
      }
      summary.filesChanged += reply.filesChanged ?? 0;
      summary.replacements += reply.replacements ?? 0;

      const changed = new Set((reply.files ?? []).map((rel) => `${root}/${rel}`.replace(/\\/g, "/")));
      for (const tab of useEditor.getState().tabs) {
        if (tab.kind !== "file" || tab.content !== tab.savedContent) continue;
        if (changed.has(tab.path.replace(/\\/g, "/"))) void useEditor.getState().reloadFromDisk(tab.path);
      }
    }
    set({ running: false });
    await get().run();
    return summary;
  },
}));
