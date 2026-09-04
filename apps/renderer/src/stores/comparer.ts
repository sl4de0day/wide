import { create } from "zustand";

interface ComparerState {
  open: boolean;
  left: string;
  right: string;

  next: "left" | "right";
  openComparer(): void;
  close(): void;
  setLeft(text: string): void;
  setRight(text: string): void;
  send(text: string): void;
}

export const useComparer = create<ComparerState>((set, get) => ({
  open: false,
  left: "",
  right: "",
  next: "left",
  openComparer: () => set({ open: true }),
  close: () => set({ open: false }),
  setLeft: (text) => set({ left: text }),
  setRight: (text) => set({ right: text }),
  send: (text) => {
    const side = get().next;
    set(side === "left" ? { left: text, next: "right", open: true } : { right: text, next: "left", open: true });
  },
}));
