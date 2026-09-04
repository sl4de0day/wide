import { create } from "zustand";

import type { SymbolHit } from "@/lib/bridge";
import { useEditor } from "./editor";

interface SymbolSearchState {
  open: boolean;
  items: SymbolHit[];

  active: number;

  openSearch(): void;
  close(): void;
  setItems(items: SymbolHit[]): void;
  setActive(index: number): void;
  move(delta: number): void;
  choose(index?: number): void;
}

export const useSymbolSearch = create<SymbolSearchState>((set, get) => ({
  open: false,
  items: [],
  active: 0,

  openSearch: () => set({ open: true, items: [], active: 0 }),
  close: () => set({ open: false }),

  setItems: (items) => set({ items, active: 0 }),
  setActive: (index) => set({ active: index }),

  move: (delta) => {
    const { items, active } = get();
    if (items.length === 0) return;

    set({ active: (active + delta + items.length) % items.length });
  },

  choose: (index) => {
    const { items, active } = get();
    const hit = items[index ?? active];
    if (!hit) return;
    set({ open: false });
    void useEditor.getState().revealAt(hit.file, hit.line + 1);
  },
}));
