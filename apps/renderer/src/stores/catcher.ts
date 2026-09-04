import { create } from "zustand";

import { newRepeaterSeed, repeaterSeeds, useEditor, type RepeaterSeed } from "./editor";

export type CatcherTool = "proxy" | "target" | "repeater" | "intruder" | "scanner" | "collaborator" | "sequencer";

interface CatcherState {
  tool: CatcherTool;

  repeaterIds: string[];
  activeRepeater: string | null;

  show(tool: CatcherTool): void;

  addRepeater(seed: RepeaterSeed): void;
  selectRepeater(id: string): void;
  closeRepeater(id: string): void;
}

export const useCatcher = create<CatcherState>((set) => ({
  tool: "proxy",
  repeaterIds: [],
  activeRepeater: null,
  show: (tool) => {
    set({ tool });
    useEditor.getState().openCatcher();
  },
  addRepeater: (seed) => {
    const id = newRepeaterSeed(seed);
    set((state) => ({
      repeaterIds: [...state.repeaterIds, id],
      activeRepeater: id,
      tool: "repeater",
    }));
    useEditor.getState().openCatcher();
  },
  selectRepeater: (id) => set({ activeRepeater: id }),
  closeRepeater: (id) =>
    set((state) => {
      repeaterSeeds.delete(id);
      const repeaterIds = state.repeaterIds.filter((x) => x !== id);
      const activeRepeater =
        state.activeRepeater === id ? (repeaterIds[repeaterIds.length - 1] ?? null) : state.activeRepeater;
      return { repeaterIds, activeRepeater };
    }),
}));
