import { create } from "zustand";

import { bridge, type EngineStatus } from "@/lib/bridge";
import { useWorkspace } from "./workspace";

export interface EngineEntry {
  dir: string;
  label?: string;
}

export interface ConsoleLine {
  level: string;
  text: string;
  at: number;
  url?: string;
  line?: number;
}

const idle: EngineStatus = {
  running: false,
  port: 0,
  url: "",
  root: "",
  requests: 0,
  clients: 0,
};

interface EngineState {
  status: EngineStatus;
  starting: boolean;
  error: string | null;
  entries: EngineEntry[];
  chosen: EngineEntry | null;
  autoReload: boolean;
  console: ConsoleLine[];

  loadEntries(root: string): Promise<void>;
  choose(entry: EngineEntry | null): void;
  start(root: string | null): Promise<void>;
  stop(): Promise<void>;
  poll(): Promise<void>;
  reload(path?: string): Promise<void>;

  noticeSave(path: string): void;
  pushConsole(line: ConsoleLine): void;
  clearConsole(): void;
  setAutoReload(value: boolean): void;
}

const MAX_CONSOLE = 300;

export const useEngine = create<EngineState>((set, get) => ({
  status: idle,
  starting: false,
  error: null,
  entries: [],
  chosen: null,
  autoReload: true,
  console: [],

  loadEntries: async (root) => {
    if (!root) return;
    const found = await bridge.engineEntries(root);
    const entries = (found?.entries as EngineEntry[]) ?? [];
    set((state) => ({ entries, chosen: state.chosen ?? entries[0] ?? null }));
  },

  choose: (entry) => set({ chosen: entry }),

  start: async (root) => {
    if (!root || get().starting) return;
    set({ starting: true, error: null });
    const result = await bridge.engineStart(root, get().chosen?.dir);
    if (result?.error) {
      set({ starting: false, error: result.error });
      return;
    }
    const status = await bridge.engineStatus();
    set({ starting: false, status: status ?? idle });
  },

  stop: async () => {
    await bridge.engineStop();
    set({ status: idle, console: [] });
  },

  poll: async () => {
    const status = await bridge.engineStatus();
    if (status) set({ status });
  },

  reload: async (path) => {
    await bridge.engineReload(path);
  },

  noticeSave: (path) => {
    const { autoReload, status } = get();
    if (autoReload && status.running) void bridge.engineReload(path);
  },

  pushConsole: (line) =>
    set((state) => {
      const next = [...state.console, line];
      return { console: next.length > MAX_CONSOLE ? next.slice(next.length - MAX_CONSOLE) : next };
    }),

  clearConsole: () => set({ console: [] }),

  setAutoReload: (value) => set({ autoReload: value }),
}));

export const engineRoot = (): string | null => useWorkspace.getState().root;
