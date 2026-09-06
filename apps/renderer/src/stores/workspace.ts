import { create } from "zustand";

import { t } from "@/lib/i18n";
import {
  bridge,
  type DirEntry,
  type Project,
  type Workflow,
  type WorkflowFolder,
} from "@/lib/bridge";
import { basename, dirname } from "@/lib/utils";
import { toast } from "./toast";
import { useEditor } from "./editor";

export type Draft =
  | { mode: "create"; parentPath: string; kind: "file" | "folder"; error: string | null }
  | { mode: "rename"; path: string; name: string; error: string | null };

interface WorkspaceState {

  root: string | null;
  rootName: string;

  folders: WorkflowFolder[];

  workflowPath: string | null;
  workflowName: string;

  children: Record<string, DirEntry[]>;
  expanded: Set<string>;
  error: string | null;
  draft: Draft | null;

  adopt(folder: Project): Promise<void>;
  openFolder(): Promise<void>;

  openWorkflow(path: string): Promise<boolean>;

  createWorkflow(path: string, folders: { path: string; name: string }[]): Promise<string | null>;

  setWorkflowFolders(folders: { path: string; name: string }[]): Promise<void>;

  adoptWorkflow(workflow: Workflow): Promise<void>;

  openFileFromDisk(): Promise<boolean>;

  adoptNewFile(folder: string, filePath: string): Promise<void>;
  openPath(path: string): Promise<boolean>;

  openRecentFile(path: string): Promise<boolean>;

  openTarget(path: string): Promise<boolean>;
  closeProject(): void;
  loadDir(path: string): Promise<void>;
  toggleDir(path: string): Promise<void>;
  expandTo(paths: string[]): Promise<void>;
  refresh(): Promise<void>;
  refreshDir(path: string): Promise<void>;

  startCreate(parentPath: string, kind: "file" | "folder"): Promise<void>;
  startRename(entry: DirEntry): void;
  cancelDraft(): void;
  commitDraft(name: string): Promise<string | null>;

  remove(entry: DirEntry): Promise<void>;
  reveal(entry: DirEntry): void;
  createDirect(parentPath: string, name: string, kind: "file" | "folder"): Promise<string | null>;
  renameDirect(path: string, name: string): Promise<string | null>;
  move(sourcePath: string, targetDir: string): Promise<void>;
}

const inFlight = new Set<string>();

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: null,
  rootName: "",
  folders: [],
  workflowPath: null,
  workflowName: "",
  children: {},
  expanded: new Set<string>(),
  error: null,
  draft: null,

  adopt: async (folder) => {
    if (!folder?.path) return;
    const name = folder.name || basename(folder.path);

    useEditor.getState().closeAll();
    set({
      root: folder.path,
      rootName: name,

      folders: [{ path: folder.path, name }],
      workflowPath: null,
      workflowName: "",
      children: {},
      expanded: new Set<string>(),
      error: null,
    });
    void bridge.addRecentProject(folder.path, name, "folder");
    await get().loadDir(folder.path);
    set((state) => ({ expanded: new Set(state.expanded).add(folder.path) }));
  },

  openFolder: async () => {
    const folder = await bridge.openFolder();
    if (!folder) return;
    await get().adopt(folder);
  },

  openWorkflow: async (path) => {
    const reply = await bridge.openWorkflow(path);
    if (!reply || "error" in reply) {
      set({ error: (reply as { error?: string })?.error ?? t("That workflow could not be opened.") });
      return false;
    }
    await get().adoptWorkflow(reply);
    return true;
  },

  createWorkflow: async (path, folders) => {
    const reply = await bridge.createWorkflow(path, folders);
    if (!reply || "error" in reply) {
      return (reply as { error?: string })?.error ?? t("That workflow could not be created.");
    }
    await get().adoptWorkflow(reply);
    return null;
  },

  setWorkflowFolders: async (folders) => {
    const path = get().workflowPath;
    if (!path) return;
    const reply = await bridge.setWorkflowFolders(path, folders);
    if (!reply || "error" in reply) {
      set({ error: (reply as { error?: string })?.error ?? t("That workflow could not be saved.") });
      return;
    }
    await get().adoptWorkflow(reply);
  },

  adoptWorkflow: async (workflow: Workflow) => {
    useEditor.getState().closeAll();
    const present = workflow.folders.filter((folder) => !folder.missing);
    set({
      root: present[0]?.path ?? workflow.folders[0]?.path ?? null,
      rootName: present[0]?.name ?? workflow.name,
      folders: workflow.folders,
      workflowPath: workflow.path,
      workflowName: workflow.name,
      children: {},
      expanded: new Set<string>(),
      error: null,
    });
    void bridge.addRecentProject(workflow.path, workflow.name, "workflow");

    await Promise.all(present.map((folder) => get().loadDir(folder.path)));
    set((state) => {
      const expanded = new Set(state.expanded);
      for (const folder of present) expanded.add(folder.path);
      return { expanded };
    });
  },

  openFileFromDisk: async () => {
    const picked = await bridge.openFile();
    if (!picked) return false;

    useEditor.getState().closeAll();
    set({
      root: null,
      rootName: "",
      folders: [],
      workflowPath: null,
      workflowName: "",
      children: {},
      expanded: new Set<string>(),
      draft: null,
      error: null,
    });
    void bridge.addRecentProject(picked.path, picked.name, "file");
    return useEditor.getState().openFile(picked.path);
  },

  adoptNewFile: async (folder, filePath) => {

    await get().adopt({ path: folder, name: basename(folder) });
    await useEditor.getState().openFile(filePath);
  },

  openPath: async (path) => {
    const result = await bridge.openRecentProject(path);
    if (!result || "error" in result) {
      set({
        error: (result as { error?: string })?.error ?? t("That folder could not be opened."),
      });
      return false;
    }
    await get().adopt(result);
    return true;
  },

  openRecentFile: async (path) => {

    const result = await bridge.openRecentFile(path);
    if (!result || "error" in result) {
      set({ error: (result as { error?: string })?.error ?? t("That file could not be opened.") });
      return false;
    }
    return useEditor.getState().openFile(result.path);
  },

  openTarget: async (path) => {
    const result = await bridge.workspaceOpenTarget(path);
    if (!result || "error" in result) {
      set({ error: (result as { error?: string })?.error ?? t("That path could not be opened.") });
      return false;
    }
    await get().adopt({ path: result.path, name: result.name });
    if (result.kind === "file" && result.file) await useEditor.getState().openFile(result.file);
    return true;
  },

  closeProject: () => {
    useEditor.getState().closeAll();
    set({
      root: null,
      rootName: "",
      folders: [],
      workflowPath: null,
      workflowName: "",
      children: {},
      expanded: new Set<string>(),
      draft: null,
      error: null,
    });
  },

  loadDir: async (path) => {
    if (inFlight.has(path)) return;
    inFlight.add(path);
    try {
      const entries = await bridge.readDir(path);
      set((state) => ({ children: { ...state.children, [path]: entries } }));
    } catch (error) {
      const message = t("Could not read the folder: {msg}", { msg: (error as Error).message });
      set({ error: message });
      toast.error(message);
    } finally {
      inFlight.delete(path);
    }
  },

  toggleDir: async (path) => {
    const { expanded, children } = get();
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
      set({ expanded: next });
      return;
    }
    next.add(path);
    set({ expanded: next });
    if (!children[path]) await get().loadDir(path);
  },

  expandTo: async (paths) => {
    const { children } = get();
    set((state) => {
      const expanded = new Set(state.expanded);
      for (const path of paths) expanded.add(path);
      return { expanded };
    });
    await Promise.all(paths.filter((path) => !children[path]).map((path) => get().loadDir(path)));
  },

  refresh: async () => {
    const { root, expanded } = get();
    if (!root) return;
    const dirs = [root, ...expanded];
    const results = await Promise.all(
      dirs.map(async (path) => {
        try {
          return [path, await bridge.readDir(path)] as const;
        } catch {
          return null;
        }
      }),
    );
    set((state) => {
      const children = { ...state.children };
      for (const entry of results) if (entry) children[entry[0]] = entry[1];
      return { children };
    });
  },

  refreshDir: async (path) => {
    try {
      const entries = await bridge.readDir(path);
      set((state) => ({ children: { ...state.children, [path]: entries } }));
    } catch {

    }
  },

  startCreate: async (parentPath, kind) => {
    const { expanded, children, loadDir } = get();
    if (!children[parentPath]) await loadDir(parentPath);
    set({
      expanded: new Set(expanded).add(parentPath),
      draft: { mode: "create", parentPath, kind, error: null },
    });
  },

  startRename: (entry) =>
    set({ draft: { mode: "rename", path: entry.path, name: entry.name, error: null } }),

  cancelDraft: () => set({ draft: null }),

  commitDraft: async (name) => {
    const { draft, loadDir } = get();
    const trimmed = name.trim();
    if (!draft) return null;
    if (!trimmed) {
      set({ draft: null });
      return null;
    }
    const result =
      draft.mode === "create"
        ? await bridge.create(draft.parentPath, trimmed, draft.kind)
        : await bridge.rename(draft.path, trimmed);
    if (result?.error) {
      set({ draft: { ...draft, error: result.error } });
      return null;
    }

    if (draft.mode === "rename" && result?.path && result.path !== draft.path) {
      useEditor.getState().relocate(draft.path, result.path);
    }
    set({ draft: null });
    await loadDir(draft.mode === "create" ? draft.parentPath : dirname(draft.path));
    return result?.path ?? null;
  },

  remove: async (entry) => {
    const result = await bridge.trash(entry.path);
    if (result?.error) {
      const message = t("Could not delete: {msg}", { msg: result.error });
      set({ error: message });
      toast.error(message);
      return;
    }

    const ed = useEditor.getState();
    for (const tab of ed.tabs) {
      if (tab.path === entry.path || tab.path.startsWith(entry.path + "/") || tab.path.startsWith(entry.path + "\\")) {
        ed.closeTab(tab.path);
      }
    }
    await get().loadDir(dirname(entry.path));
  },

  reveal: (entry) => void bridge.reveal(entry.path),

  createDirect: async (parentPath, name, kind) => {
    const trimmed = name?.trim();
    if (!parentPath || !trimmed) return null;
    const result = await bridge.create(parentPath, trimmed, kind);
    if (result?.error) {
      set({ error: result.error });
      return null;
    }
    set({ error: null, expanded: new Set(get().expanded).add(parentPath) });
    await get().loadDir(parentPath);
    return result?.path ?? null;
  },

  renameDirect: async (path, name) => {
    const trimmed = name?.trim();
    if (!path || !trimmed) return null;
    const result = await bridge.rename(path, trimmed);
    if (result?.error) {
      set({ error: result.error });
      return null;
    }
    if (result?.path && result.path !== path) useEditor.getState().relocate(path, result.path);
    set({ error: null });
    await get().loadDir(dirname(path));
    return result?.path ?? null;
  },

  move: async (sourcePath, targetDir) => {
    const result = await bridge.move(sourcePath, targetDir);
    if (result?.error) {
      const message = t("Could not move: {msg}", { msg: result.error });
      set({ error: message });
      toast.error(message);
      return;
    }
    if (!result?.path || result.path === sourcePath) return;
    useEditor.getState().relocate(sourcePath, result.path);
    set({ error: null });
    await Promise.all([get().loadDir(dirname(sourcePath)), get().loadDir(targetDir)]);
  },
}));

export function subscribeFsChanges(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = useWorkspace.subscribe((state, previous) => {
    if (state.root !== previous.root) void bridge.watchWorkspace(state.root ?? "");
  });
  const off = bridge.onFsChanged(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void useWorkspace.getState().refresh();
      void import("./editor").then((m) => m.useEditor.getState().checkDiskChanges());
    }, 200);
  });

  void bridge.watchWorkspace(useWorkspace.getState().root ?? "");
  return () => {
    stop();
    off();
    if (timer) clearTimeout(timer);
  };
}

