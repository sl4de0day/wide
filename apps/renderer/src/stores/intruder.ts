import { create } from "zustand";

import { useCatcher } from "./catcher";

interface IntruderState {
  seed: string;
  openIntruder(seed?: string): void;
}

const DEFAULT_SEED = "GET https://example.com/?q=§payload§\n\n";

export const useIntruder = create<IntruderState>((set) => ({
  seed: DEFAULT_SEED,
  openIntruder: (seed) => {
    set({ seed: seed || DEFAULT_SEED });
    useCatcher.getState().show("intruder");
  },
}));
