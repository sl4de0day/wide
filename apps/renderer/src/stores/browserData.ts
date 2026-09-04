import { create } from "zustand";

export interface HistoryEntry {
  url: string;
  title: string;
  at: number;
}

export interface Bookmark {
  url: string;
  title: string;
}

const HISTORY_KEY = "wide.browser.history";
const BOOKMARKS_KEY = "wide.browser.bookmarks";
const HISTORY_CAP = 500;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {

  }
}

interface BrowserDataState {
  history: HistoryEntry[];
  bookmarks: Bookmark[];

  visit(url: string, title?: string): void;
  addBookmark(url: string, title: string): void;
  removeBookmark(url: string): void;
  toggleBookmark(url: string, title: string): void;
  isBookmarked(url: string): boolean;

  suggestions(query: string, limit?: number): { url: string; title: string; bookmarked: boolean }[];
  clearHistory(): void;
}

export const useBrowserData = create<BrowserDataState>((set, get) => ({
  history: load<HistoryEntry[]>(HISTORY_KEY, []),
  bookmarks: load<Bookmark[]>(BOOKMARKS_KEY, []),

  visit: (url, title) => {
    if (!url || url === "about:blank") return;
    set((state) => {
      const rest = state.history.filter((h) => h.url !== url);
      const prev = state.history.find((h) => h.url === url);
      const history = [{ url, title: title || prev?.title || url, at: Date.now() }, ...rest].slice(0, HISTORY_CAP);
      save(HISTORY_KEY, history);
      return { history };
    });
  },

  addBookmark: (url, title) => {
    set((state) => {
      if (state.bookmarks.some((b) => b.url === url)) return state;
      const bookmarks = [{ url, title: title || url }, ...state.bookmarks];
      save(BOOKMARKS_KEY, bookmarks);
      return { bookmarks };
    });
  },

  removeBookmark: (url) => {
    set((state) => {
      const bookmarks = state.bookmarks.filter((b) => b.url !== url);
      save(BOOKMARKS_KEY, bookmarks);
      return { bookmarks };
    });
  },

  toggleBookmark: (url, title) => {
    if (get().isBookmarked(url)) get().removeBookmark(url);
    else get().addBookmark(url, title);
  },

  isBookmarked: (url) => get().bookmarks.some((b) => b.url === url),

  suggestions: (query, limit = 8) => {
    const q = query.trim().toLowerCase();
    const { bookmarks, history } = get();
    const seen = new Set<string>();
    const out: { url: string; title: string; bookmarked: boolean }[] = [];
    const consider = (url: string, title: string, bookmarked: boolean) => {
      if (seen.has(url)) return;
      if (q && !url.toLowerCase().includes(q) && !title.toLowerCase().includes(q)) return;
      seen.add(url);
      out.push({ url, title, bookmarked });
    };
    for (const b of bookmarks) consider(b.url, b.title, true);
    for (const h of history) consider(h.url, h.title, get().isBookmarked(h.url));
    return out.slice(0, limit);
  },

  clearHistory: () => {
    save(HISTORY_KEY, []);
    set({ history: [] });
  },
}));
