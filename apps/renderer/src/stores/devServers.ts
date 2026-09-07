import { create } from "zustand";

interface DevServerState {
  origins: string[];
  add(origin: string): void;
  clear(): void;
}

const MAX = 8;

export const useDevServers = create<DevServerState>((set) => ({
  origins: [],
  add: (origin) =>
    set((state) => {
      if (!origin || state.origins.includes(origin)) return state;
      const origins = [origin, ...state.origins];
      if (origins.length > MAX) origins.length = MAX;
      return { origins };
    }),
  clear: () => set({ origins: [] }),
}));
