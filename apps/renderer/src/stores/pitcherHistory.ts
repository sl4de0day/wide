import { create } from "zustand";

export interface HistoryItem {
  id: string;
  method: string;
  url: string;
  status: number;
  ms: number;
  at: number;
}

const KEY = "wide.pitcher.history";
const CAP = 200;

function load(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function persist(items: HistoryItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {

  }
}

let seq = 0;

interface HistoryState {
  items: HistoryItem[];
  add(item: Omit<HistoryItem, "id" | "at">): void;
  clear(): void;
}

export const usePitcherHistory = create<HistoryState>((set) => ({
  items: load(),
  add: (item) =>
    set((s) => {
      const items = [{ ...item, id: `h${(seq += 1)}`, at: Date.now() }, ...s.items].slice(0, CAP);
      persist(items);
      return { items };
    }),
  clear: () => {
    persist([]);
    set({ items: [] });
  },
}));
