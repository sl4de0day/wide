import { create } from "zustand";

import type { BrowserEvent } from "@/lib/bridge";

export interface BrowserTab {
  id: string;

  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;

  favicon?: string;
}

let nextId = 1;
const makeTab = (): BrowserTab => ({
  id: `t${nextId++}`,
  url: "",
  title: "",
  loading: false,
  canBack: false,
  canForward: false,
});

interface BrowserState {
  tabs: BrowserTab[];
  activeId: string;

  ensureOne(): void;
  newTab(): void;
  closeTab(id: string): void;
  selectTab(id: string): void;

  commit(url: string): void;

  openUrl(url: string): void;

  ingest(event: BrowserEvent): void;
  active(): BrowserTab | undefined;
}

const patchActive = (tabs: BrowserTab[], activeId: string, patch: Partial<BrowserTab>) =>
  tabs.map((tab) => (tab.id === activeId ? { ...tab, ...patch } : tab));

export const useBrowser = create<BrowserState>((set, get) => ({
  tabs: [],
  activeId: "",

  ensureOne: () => {
    if (get().tabs.length === 0) {
      const tab = makeTab();
      set({ tabs: [tab], activeId: tab.id });
    }
  },

  newTab: () => {
    const tab = makeTab();
    set((state) => ({ tabs: [...state.tabs, tab], activeId: tab.id }));
  },

  closeTab: (id) => {
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== id);

      if (tabs.length === 0) {
        const tab = makeTab();
        return { tabs: [tab], activeId: tab.id };
      }

      let activeId = state.activeId;
      if (id === state.activeId) activeId = tabs[Math.min(index, tabs.length - 1)].id;
      return { tabs, activeId };
    });
  },

  selectTab: (id) => set({ activeId: id }),

  commit: (url) => set((state) => ({ tabs: patchActive(state.tabs, state.activeId, { url }) })),

  openUrl: (url) =>
    set((state) => {
      const activeBlank = state.tabs.some((tab) => tab.id === state.activeId && tab.url === "");
      if (activeBlank) return { tabs: patchActive(state.tabs, state.activeId, { url }) };
      const tab: BrowserTab = { ...makeTab(), url };
      return { tabs: [...state.tabs, tab], activeId: tab.id };
    }),

  ingest: (event) =>
    set((state) => {

      const id =
        event.tabId && state.tabs.some((tab) => tab.id === event.tabId)
          ? event.tabId
          : state.activeId;
      const patch: Partial<BrowserTab> = {};
      if (event.url !== undefined) patch.url = event.url;
      if (event.title !== undefined) patch.title = event.title;
      if (event.loading !== undefined) patch.loading = event.loading;
      if (event.canGoBack !== undefined) patch.canBack = event.canGoBack;
      if (event.canGoForward !== undefined) patch.canForward = event.canGoForward;
      if (event.favicon !== undefined) patch.favicon = event.favicon;
      return { tabs: patchActive(state.tabs, id, patch) };
    }),

  active: () => get().tabs.find((tab) => tab.id === get().activeId),
}));
