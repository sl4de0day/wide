import { create } from "zustand";

import { bridge } from "@/lib/bridge";
import { useWorkspace } from "./workspace";

export interface ToolCommand {
  id: string;
  title?: string;
}

export interface ToolDef {
  id: string;
  name: string;
  description?: string;
  commands: ToolCommand[];
  capabilities?: string[];
}

export interface ToolLogLine {
  at: number;
  text: string;
  level?: "log" | "warn" | "error";
}

interface ToolsState {
  tools: ToolDef[];
  problems: unknown[];
  dirs: { project: string; user: string };
  loading: boolean;
  error: string | null;
  running: string | null;
  log: ToolLogLine[];

  refresh(): Promise<void>;
  run(toolId: string, commandId: string): Promise<void>;
  cancel(): Promise<void>;
  reveal(toolId: string): Promise<void>;
  scaffold(name: string): Promise<void>;
  pushEvent(event: unknown): void;
  clearLog(): void;
}

const MAX_LOG = 500;

export const useTools = create<ToolsState>((set, get) => ({
  tools: [],
  problems: [],
  dirs: { project: "", user: "" },
  loading: false,
  error: null,
  running: null,
  log: [],

  refresh: async () => {
    const root = useWorkspace.getState().root;
    if (!root) {
      set({ tools: [], problems: [] });
      return;
    }
    set({ loading: true, error: null });
    const result = await bridge.toolsList(root);
    set({
      loading: false,
      tools: (result?.tools as ToolDef[]) ?? [],
      problems: result?.problems ?? [],
      dirs: result?.dirs ?? { project: "", user: "" },
      error: result?.error ?? null,
    });
  },

  run: async (toolId, commandId) => {
    const root = useWorkspace.getState().root;
    if (!root || get().running) return;
    set({ running: `${toolId}:${commandId}`, error: null });
    const result = await bridge.toolsRun(root, toolId, commandId, {});
    set({ running: null, error: result?.error ?? null });
  },

  cancel: async () => {
    const running = get().running;
    if (!running) return;
    await bridge.toolsCancel(running);
    set({ running: null });
  },

  reveal: async (toolId) => {
    const root = useWorkspace.getState().root;
    if (root) await bridge.toolsReveal(root, toolId);
  },

  scaffold: async (name) => {
    const root = useWorkspace.getState().root;
    if (!root) return;
    const result = await bridge.toolsScaffold(root, name);
    if (result?.error) set({ error: result.error });
    await get().refresh();
  },

  pushEvent: (event) => {
    const payload = event as { kind?: string; text?: string; level?: ToolLogLine["level"] };
    if (!payload?.text) return;
    set((state) => {
      const log = [...state.log, { at: Date.now(), text: payload.text!, level: payload.level }];
      return { log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log };
    });
  },

  clearLog: () => set({ log: [] }),
}));
