import { create } from "zustand";

import { bridge } from "@/lib/bridge";
import { useWorkspace } from "./workspace";

export interface Script {
  name: string;

  command: string;

  detail?: string | null;

  manifest?: string;
}

interface RunState {
  scripts: Script[];
  loading: boolean;

  pending: string[];
  lastScript: string | null;

  refresh(): Promise<void>;
  send(command: string, script?: string | null): void;
  runScript(name: string): void;
  debugScript(name: string): void;
  quickRunDev(): boolean;
  drain(): string[];
}

export const useRun = create<RunState>((set, get) => ({
  scripts: [],
  loading: false,
  pending: [],
  lastScript: null,

  refresh: async () => {
    const root = useWorkspace.getState().root;
    if (!root) {
      set({ scripts: [] });
      return;
    }
    set({ loading: true });
    const result = await bridge.projectScripts(root);
    set({ scripts: result?.scripts ?? [], loading: false });
  },

  send: (command, script = null) =>
    set((state) => ({
      pending: [...state.pending, command],
      lastScript: script ?? state.lastScript,
    })),

  runScript: (name) => {
    const script = get().scripts.find((item) => item.name === name);
    get().send(script?.command ?? `npm run ${name}`, name);
  },

  debugScript: (name) => {
    const script = get().scripts.find((item) => item.name === name);
    get().send(`${script?.command ?? `npm run ${name}`} -- --inspect-brk`, name);
  },

  quickRunDev: () => {
    const dev = get().scripts.find((script) => /^(?:dev|serve|start)$/.test(script.name));
    if (dev) {
      get().send(dev.command, dev.name);
      return true;
    }
    return false;
  },

  drain: () => {
    const { pending } = get();
    if (pending.length === 0) return [];
    set({ pending: [] });
    return pending;
  },
}));
