import { create } from "zustand";

interface DecoderState {
  open: boolean;
  seed: string;
  openDecoder(seed?: string): void;
  close(): void;
}

export const useDecoder = create<DecoderState>((set) => ({
  open: false,
  seed: "",
  openDecoder: (seed = "") => set({ open: true, seed }),
  close: () => set({ open: false }),
}));
