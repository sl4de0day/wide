import { create } from "zustand";

import { useEditor } from "./editor";

export interface QuickFile {
  path: string;
  relativePath: string;
}

interface QuickOpenState {
  open: boolean;
  items: QuickFile[];

  active: number;

  openPalette(): void;
  close(): void;
  setItems(items: QuickFile[]): void;
  setActive(index: number): void;
  move(delta: number): void;
  choose(index: number | undefined, line: number): void;
}

export const useQuickOpen = create<QuickOpenState>((set, get) => ({
  open: false,
  items: [],
  active: 0,

  openPalette: () => set({ open: true, items: [], active: 0 }),
  close: () => set({ open: false }),

  setItems: (items) => set({ items, active: 0 }),
  setActive: (index) => set({ active: index }),

  move: (delta) => {
    const { items, active } = get();
    if (items.length === 0) return;
    set({ active: (active + delta + items.length) % items.length });
  },

  choose: (index, line) => {
    const { items, active } = get();
    const file = items[index ?? active];
    if (!file) return;
    set({ open: false });
    if (line > 0) void useEditor.getState().revealAt(file.path, line, 1);
    else void useEditor.getState().openFile(file.path);
  },
}));
