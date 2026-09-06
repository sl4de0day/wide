import { create } from "zustand";

import { t } from "@/lib/i18n";
import { bridge } from "@/lib/bridge";
import { basename, normalisePath } from "@/lib/utils";
import { useDiagnostics } from "./diagnostics";

export const SETTINGS_PATH = "wide://settings";
export const HTTP_PATH = "wide://response";

export const POLICY_PATH = "wide://policy";

export const BROWSER_PATH = "wide://browser";

export const CATCHER_PATH = "wide://catcher";

export const PITCHER_PATH = "wide://pitcher";

export const CYBERCHEF_PATH = "wide://cyberchef";

export const EXTENSION_PATH = "wide://extension/";

export const AI_CHAT_PATH = "wide://ai/";

export const REPEATER_PATH = "wide://repeater/";

export const DIFF_PATH = "wide://diff/";

export interface FileTab {
  kind: "file";
  path: string;
  name: string;
  content: string;
  savedContent: string;
  tooLarge: boolean;
  size: number;
  diskChanged?: boolean;
}

export interface VirtualTab {
  kind: "settings" | "http" | "extension" | "ai-chat" | "policy" | "browser" | "diff" | "catcher" | "pitcher" | "cyberchef";
  path: string;
  name: string;
}

export interface MediaTab {
  kind: "media";
  path: string;
  name: string;
  dataUri: string;
  mediaKind: "image" | "pdf" | "font" | "binary";
  size: number;
}

export type Tab = FileTab | VirtualTab | MediaTab;

const MEDIA_TYPES: Record<string, { kind: MediaTab["mediaKind"]; mime: string }> = {
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  gif: { kind: "image", mime: "image/gif" },
  webp: { kind: "image", mime: "image/webp" },
  bmp: { kind: "image", mime: "image/bmp" },
  ico: { kind: "image", mime: "image/x-icon" },
  svg: { kind: "image", mime: "image/svg+xml" },
  avif: { kind: "image", mime: "image/avif" },
  pdf: { kind: "pdf", mime: "application/pdf" },
  woff: { kind: "font", mime: "font/woff" },
  woff2: { kind: "font", mime: "font/woff2" },
  ttf: { kind: "font", mime: "font/ttf" },
  otf: { kind: "font", mime: "font/otf" },
};

export function mediaTypeFor(path: string): { kind: MediaTab["mediaKind"]; mime: string } | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPES[ext] ?? null;
}

export interface Cursor {
  line: number;
  column: number;
}

interface EditorState {
  tabs: Tab[];
  activePath: string | null;

  splitPath: string | null;
  toggleSplit(): void;
  closeSplit(): void;

  lastFilePath: string | null;
  cursor: Cursor;
  pendingReveal: { path: string; line: number; column: number; offset?: number } | null;
  pendingReplace: { path: string; content: string } | null;

  closedFiles: FileTab[];

  openFile(path: string): Promise<boolean>;
  openSettings(): void;
  openHttpResponse(): void;
  openPolicy(): void;
  openBrowser(): void;

  openCatcher(): void;

  openPitcher(): void;

  openCyberchef(): void;
  openExtension(id: string, name: string): void;
  openAiChat(id: string, name: string): void;

  openDiff(relPath: string, staged: boolean): void;

  setTabName(path: string, name: string): void;
  closeTab(path: string): void;

  closeOthers(path: string): void;

  closeRight(path: string): void;
  setActive(path: string): void;
  closeAll(): void;

  reopenClosed(): void;
  updateContent(path: string, content: string): void;
  setCursor(cursor: Cursor): void;
  reloadFromDisk(path: string): Promise<void>;
  checkDiskChanges(): Promise<void>;
  revealAt(path: string, line: number, column?: number): Promise<void>;

  revealOffset(path: string, offset: number): Promise<void>;
  consumeReveal(): void;
  replaceContent(path: string, content: string): void;
  consumeReplace(): void;
  relocate(oldPath: string, newPath: string): void;
  saveActive(): Promise<void>;
  formatActive(): Promise<
    { ok: true; formatter: string; unchanged: boolean } | { ok: false; error: string }
  >;
}

export interface RepeaterSeed {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}

export const repeaterSeeds = new Map<string, RepeaterSeed>();
let repeaterCounter = 0;

export function newRepeaterSeed(seed: RepeaterSeed): string {
  repeaterCounter += 1;
  const id = String(repeaterCounter);
  repeaterSeeds.set(id, seed);
  return id;
}

function cleanupClosedTab(path: string): void {
  useDiagnostics.getState().clear(path);
  if (path.startsWith(AI_CHAT_PATH)) {
    void import("./ai").then((module) => module.useAi.getState().closeChat(path.slice(AI_CHAT_PATH.length)));
  }
}

function isInside(path: string, parent: string): boolean {
  const a = normalisePath(path);
  const b = normalisePath(parent);
  return a.startsWith(b.endsWith("/") ? b : `${b}/`);
}

export function repointPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  if (isInside(path, oldPath)) return newPath + path.slice(oldPath.length);
  return path;
}

export const useEditor = create<EditorState>((set, get) => ({
  tabs: [],
  activePath: null,
  splitPath: null,
  lastFilePath: null,
  cursor: { line: 1, column: 1 },
  pendingReveal: null,
  pendingReplace: null,
  closedFiles: [],

  toggleSplit: () => {
    const { splitPath, lastFilePath } = get();
    if (splitPath) set({ splitPath: null });
    else if (lastFilePath) set({ splitPath: lastFilePath });
  },
  closeSplit: () => set({ splitPath: null }),

  openFile: async (path) => {
    const existing = get().tabs.find((tab) => tab.path === path);
    if (existing) {
      set({ activePath: path, lastFilePath: path });
      return true;
    }
    const media = mediaTypeFor(path);
    if (media) {
      try {
        const binary = await bridge.readBinary(path);
        if (binary.ok && binary.base64) {
          const tab: MediaTab = {
            kind: "media",
            path,
            name: basename(path),
            dataUri: `data:${media.mime};base64,${binary.base64}`,
            mediaKind: media.kind,
            size: binary.size ?? 0,
          };
          set((state) => ({ tabs: [...state.tabs, tab], activePath: path, lastFilePath: path }));
          return true;
        }
      } catch {
        void 0;
      }
    }
    try {
      const file = await bridge.readFile(path);
      const tab: FileTab = {
        kind: "file",
        path,
        name: basename(path),
        content: file.tooLarge ? "" : file.content,
        savedContent: file.tooLarge ? "" : file.content,
        tooLarge: file.tooLarge,
        size: file.size,
      };
      set((state) => ({ tabs: [...state.tabs, tab], activePath: path, lastFilePath: path }));
      return true;
    } catch (error) {
      console.error(`Could not open file: ${path}`, error);
      return false;
    }
  },

  openSettings: () =>
    set((state) => {
      if (state.tabs.some((tab) => tab.path === SETTINGS_PATH)) {
        return { activePath: SETTINGS_PATH };
      }
      return {
        tabs: [...state.tabs, { kind: "settings", path: SETTINGS_PATH, name: "Settings" }],
        activePath: SETTINGS_PATH,
      };
    }),

  openPolicy: () =>
    set((state) => {
      if (state.tabs.some((tab) => tab.path === POLICY_PATH)) {
        return { activePath: POLICY_PATH };
      }
      return {
        tabs: [...state.tabs, { kind: "policy", path: POLICY_PATH, name: "Security" }],
        activePath: POLICY_PATH,
      };
    }),

  openBrowser: () =>
    set((state) => {
      if (state.tabs.some((tab) => tab.path === BROWSER_PATH)) {
        return { activePath: BROWSER_PATH };
      }
      return {
        tabs: [...state.tabs, { kind: "browser", path: BROWSER_PATH, name: "Browser" }],
        activePath: BROWSER_PATH,
      };
    }),

  openCatcher: () =>
    set((state) => {
      if (state.tabs.some((tab) => tab.path === CATCHER_PATH)) {
        return { activePath: CATCHER_PATH };
      }
      return {
        tabs: [...state.tabs, { kind: "catcher", path: CATCHER_PATH, name: "Catcher" }],
        activePath: CATCHER_PATH,
      };
    }),

  openPitcher: () =>
    set((state) => {
      if (state.tabs.some((tab) => tab.path === PITCHER_PATH)) {
        return { activePath: PITCHER_PATH };
      }
      return {
        tabs: [...state.tabs, { kind: "pitcher", path: PITCHER_PATH, name: "Pitcher" }],
        activePath: PITCHER_PATH,
      };
    }),

  openCyberchef: () =>
    set((state) => {
      if (state.tabs.some((tab) => tab.path === CYBERCHEF_PATH)) {
        return { activePath: CYBERCHEF_PATH };
      }
      return {
        tabs: [...state.tabs, { kind: "cyberchef", path: CYBERCHEF_PATH, name: "CyberChef" }],
        activePath: CYBERCHEF_PATH,
      };
    }),

  openHttpResponse: () =>
    set((state) => {
      if (state.tabs.some((tab) => tab.path === HTTP_PATH)) {
        return { activePath: HTTP_PATH };
      }
      return {
        tabs: [...state.tabs, { kind: "http", path: HTTP_PATH, name: "Response" }],
        activePath: HTTP_PATH,
      };
    }),

  openExtension: (id, name) =>
    set((state) => {
      const path = `${EXTENSION_PATH}${id}`;
      if (state.tabs.some((tab) => tab.path === path)) return { activePath: path };
      return {
        tabs: [...state.tabs, { kind: "extension", path, name }],
        activePath: path,
      };
    }),

  openDiff: (relPath, staged) =>
    set((state) => {
      const path = `${DIFF_PATH}${staged ? "staged" : "work"}/${relPath}`;
      const name = `${staged ? "◇ " : "◆ "}${basename(relPath)}`;
      if (state.tabs.some((tab) => tab.path === path)) return { activePath: path };
      return { tabs: [...state.tabs, { kind: "diff", path, name }], activePath: path };
    }),

  openAiChat: (id, name) =>
    set((state) => {
      const path = `${AI_CHAT_PATH}${id}`;

      if (state.tabs.some((tab) => tab.path === path)) return { activePath: path };
      return {
        tabs: [...state.tabs, { kind: "ai-chat", path, name }],
        activePath: path,
      };
    }),

  setTabName: (path, name) =>
    set((state) => {
      const tab = state.tabs.find((item) => item.path === path);
      if (!tab || tab.name === name) return state;
      return {
        tabs: state.tabs.map((item) => (item.path === path ? { ...item, name } : item)),
      };
    }),

  closeTab: (path) => {
    useDiagnostics.getState().clear(path);

    if (path.startsWith(AI_CHAT_PATH)) {
      void import("./ai").then((module) =>
        module.useAi.getState().closeChat(path.slice(AI_CHAT_PATH.length)),
      );
    }
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.path === path);
      if (index === -1) return state;
      const removed = state.tabs[index];
      const tabs = state.tabs.filter((tab) => tab.path !== path);
      const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
      const closedFiles = removed.kind === "file" ? [...state.closedFiles, removed].slice(-15) : state.closedFiles;

      const lastFilePath =
        state.lastFilePath === path
          ? (neighbour?.kind === "file" ? neighbour.path : null) ??
            [...tabs].reverse().find((tab) => tab.kind === "file")?.path ??
            null
          : state.lastFilePath;

      const splitPath = state.splitPath === path ? null : state.splitPath;

      if (state.activePath !== path) return { tabs, lastFilePath, splitPath, closedFiles };
      return { tabs, activePath: neighbour?.path ?? null, lastFilePath, splitPath, closedFiles };
    });
  },

  closeOthers: (keepPath) =>
    set((state) => {
      const keptTab = state.tabs.find((tab) => tab.path === keepPath);
      if (!keptTab) return state;
      for (const tab of state.tabs) if (tab.path !== keepPath) cleanupClosedTab(tab.path);
      const removedFiles = state.tabs.filter((tab): tab is FileTab => tab.kind === "file" && tab.path !== keepPath);
      return {
        tabs: [keptTab],
        activePath: keepPath,
        lastFilePath: keptTab.kind === "file" ? keepPath : null,
        splitPath: state.splitPath === keepPath ? state.splitPath : null,
        closedFiles: [...state.closedFiles, ...removedFiles].slice(-15),
      };
    }),

  closeRight: (fromPath) =>
    set((state) => {
      const idx = state.tabs.findIndex((tab) => tab.path === fromPath);
      if (idx === -1) return state;
      const kept = state.tabs.slice(0, idx + 1);
      const removedTabs = state.tabs.slice(idx + 1);
      for (const tab of removedTabs) cleanupClosedTab(tab.path);
      const removedFiles = removedTabs.filter((tab): tab is FileTab => tab.kind === "file");
      const keptPaths = new Set(kept.map((tab) => tab.path));
      return {
        tabs: kept,
        activePath: keptPaths.has(state.activePath ?? "") ? state.activePath : fromPath,
        lastFilePath: keptPaths.has(state.lastFilePath ?? "")
          ? state.lastFilePath
          : [...kept].reverse().find((tab) => tab.kind === "file")?.path ?? null,
        splitPath: keptPaths.has(state.splitPath ?? "") ? state.splitPath : null,
        closedFiles: [...state.closedFiles, ...removedFiles].slice(-15),
      };
    }),

  setActive: (path) =>
    set((state) => ({
      activePath: path,
      lastFilePath:
        state.tabs.find((tab) => tab.path === path)?.kind === "file" ? path : state.lastFilePath,
    })),

  closeAll: () => {
    useDiagnostics.getState().reset();
    set((state) => {
      const removedFiles = state.tabs.filter((tab): tab is FileTab => tab.kind === "file");
      return {
        tabs: [],
        activePath: null,
        lastFilePath: null,
        pendingReveal: null,
        pendingReplace: null,
        closedFiles: [...state.closedFiles, ...removedFiles].slice(-15),
      };
    });
  },

  reopenClosed: () => {
    const stack = get().closedFiles;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    set((state) => ({ closedFiles: state.closedFiles.slice(0, -1) }));

    void get().openFile(last.path);
  },

  updateContent: (path, content) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.path === path && tab.kind === "file" ? { ...tab, content } : tab,
      ),
    })),

  setCursor: (cursor) =>
    set((state) =>
      state.cursor.line === cursor.line && state.cursor.column === cursor.column
        ? state
        : { cursor },
    ),

  reloadFromDisk: async (path) => {
    if (!get().tabs.some((tab) => tab.path === path)) return;
    try {
      const file = await bridge.readFile(path);
      if (file.tooLarge) return;
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.path === path && tab.kind === "file"
            ? { ...tab, content: file.content, savedContent: file.content, size: file.size, diskChanged: false }
            : tab,
        ),
      }));
    } catch (error) {
      console.error(`Could not re-read file: ${path}`, error);
    }
  },

  checkDiskChanges: async () => {
    const files = get().tabs.filter((tab): tab is FileTab => tab.kind === "file" && !tab.tooLarge);
    if (files.length === 0) return;
    let warned = false;
    for (const tab of files) {
      let file;
      try {
        file = await bridge.readFile(tab.path);
      } catch {
        continue;
      }
      if (file.tooLarge || file.content === tab.savedContent) continue;
      const dirty = tab.content !== tab.savedContent;
      if (!dirty) {
        await get().reloadFromDisk(tab.path);
      } else {
        set((state) => ({
          tabs: state.tabs.map((item) =>
            item.path === tab.path && item.kind === "file" ? { ...item, diskChanged: true } : item,
          ),
        }));
        warned = true;
      }
    }
    if (warned) {
      const { toast } = await import("./toast");
      toast.error("A file open in the editor changed on disk. Your unsaved version is kept — reload it to take the disk copy.");
    }
  },

  revealAt: async (path, line, column = 1) => {
    await get().openFile(path);
    set({ pendingReveal: { path, line, column } });
  },

  revealOffset: async (path, offset) => {
    await get().openFile(path);
    set({ pendingReveal: { path, line: 1, column: 1, offset } });
  },
  consumeReveal: () => set({ pendingReveal: null }),

  replaceContent: (path, content) => set({ pendingReplace: { path, content } }),
  consumeReplace: () => set({ pendingReplace: null }),

  relocate: (oldPath, newPath) => {
    const repoint = (path: string) => repointPath(path, oldPath, newPath);
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.kind !== "file") return tab;
        const path = repoint(tab.path);
        return path === tab.path ? tab : { ...tab, path, name: basename(path) };
      }),
      activePath: state.activePath ? repoint(state.activePath) : state.activePath,

      lastFilePath: state.lastFilePath ? repoint(state.lastFilePath) : state.lastFilePath,
    }));
    void import("./aiEdits").then((module) => module.useAiEdits.getState().relocate(oldPath, newPath));
  },

  formatActive: async () => {
    const { tabs, activePath } = get();
    const tab = tabs.find((item) => item.path === activePath);
    if (!tab || tab.kind !== "file") return { ok: false, error: t("No file is open.") };

    const { useWorkspace } = await import("./workspace");
    const result = await bridge.formatText(tab.path, tab.content, useWorkspace.getState().root);
    if (!result.ok) return result;
    if (result.text === tab.content) return { ok: true, formatter: result.formatter, unchanged: true };

    set((state) => ({
      tabs: state.tabs.map((item) =>
        item.path === tab.path && item.kind === "file" ? { ...item, content: result.text } : item,
      ),

      pendingReplace: { path: tab.path, content: result.text },
    }));
    return { ok: true, formatter: result.formatter, unchanged: false };
  },

  saveActive: async () => {
    const { tabs, activePath } = get();
    const tab = tabs.find((item) => item.path === activePath);
    if (!tab || tab.kind !== "file" || tab.content === tab.savedContent) return;

    const { useSettings } = await import("./settings");
    if (useSettings.getState().formatOnSave) {
      const formatted = await get().formatActive();
      if (formatted.ok && !formatted.unchanged) {
        const next = get().tabs.find((item) => item.path === tab.path);
        if (next && next.kind === "file") tab.content = next.content;
      }
    }

    const live = get().tabs.find((item) => item.path === tab.path);
    if (live && live.kind === "file" && live.diskChanged) {
      const { confirm } = await import("./confirm");
      const ok = await confirm({
        title: "This file changed on disk",
        message: "Saving will overwrite the newer copy on disk with your version. Overwrite it?",
        confirmLabel: "Overwrite",
        danger: true,
      });
      if (!ok) return;
    }

    try {
      await bridge.writeFile(tab.path, tab.content);
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.path === tab.path && item.kind === "file"
            ? { ...item, savedContent: tab.content, diskChanged: false }
            : item,
        ),
      }));

      const { useEngine } = await import("./engine");
      useEngine.getState().noticeSave(tab.path);
    } catch (error) {
      console.error(`Could not save file: ${tab.path}`, error);
    }
  },
}));

export const isDirty = (tab: Tab | null | undefined): boolean =>
  tab?.kind === "file" && tab.content !== tab.savedContent;

export const useActiveTab = (): Tab | null =>
  useEditor((state) => state.tabs.find((tab) => tab.path === state.activePath) ?? null);
