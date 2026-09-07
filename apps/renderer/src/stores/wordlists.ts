import { create } from "zustand";

export interface Wordlist {
  id: string;
  name: string;
  body: string;
}

const STORAGE_KEY = "wide.wordlists";

function load(): Wordlist[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.name === "string" && typeof item.body === "string");
  } catch {
    return [];
  }
}

function persist(lists: Wordlist[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
  } catch {

  }
}

let seq = 0;

interface WordlistState {
  lists: Wordlist[];
  save(name: string, body: string): void;
  remove(id: string): void;
}

export const useWordlists = create<WordlistState>((set, get) => ({
  lists: load(),
  save: (name, body) => {
    const clean = name.trim();
    if (!clean || !body.trim()) return;
    const lists = get().lists.slice();
    const at = lists.findIndex((list) => list.name === clean);
    if (at >= 0) lists[at] = { ...lists[at], body };
    else lists.push({ id: `wl-${Date.now()}-${(seq += 1)}`, name: clean, body });
    persist(lists);
    set({ lists });
  },
  remove: (id) => {
    const lists = get().lists.filter((list) => list.id !== id);
    persist(lists);
    set({ lists });
  },
}));
