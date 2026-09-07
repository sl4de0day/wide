import { create } from "zustand";

import { bridge, type VaultEntry } from "@/lib/bridge";

export type VaultTarget = "scanner" | "pitcher" | "repeater";

interface VaultState {
  entries: VaultEntry[];
  loaded: boolean;
  error: string;

  load(): Promise<void>;
  save(input: { id?: string; name: string; kind: string; headerName?: string; note?: string; secret?: string }): Promise<boolean>;
  remove(id: string): Promise<void>;
  headersFor(id: string): Promise<[string, string][]>;
}

export const useVault = create<VaultState>((set) => ({
  entries: [],
  loaded: false,
  error: "",

  load: async () => {
    const reply = await bridge.vaultList();
    set({ entries: reply.ok ? (reply.entries ?? []) : [], loaded: true, error: reply.ok ? "" : (reply.error ?? "") });
  },

  save: async (input) => {
    const reply = await bridge.vaultSave(input);
    if (!reply.ok) {
      set({ error: reply.error ?? "" });
      return false;
    }
    set({ entries: reply.entries ?? [], error: "" });
    return true;
  },

  remove: async (id) => {
    const reply = await bridge.vaultRemove(id);
    if (reply.ok) set({ entries: reply.entries ?? [], error: "" });
    else set({ error: reply.error ?? "" });
  },

  headersFor: async (id) => {
    const reply = await bridge.vaultHeaders(id);
    return reply.ok ? (reply.headers ?? []) : [];
  },
}));
