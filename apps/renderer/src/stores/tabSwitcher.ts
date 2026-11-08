import { create } from "zustand";
import { useEditor } from "./editor";

interface TabSwitcherState {
  isOpen: boolean;
  selectedIndex: number;
  open: () => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  setIndex: (index: number) => void;
  confirm: () => void;
}

export const useTabSwitcher = create<TabSwitcherState>((set, get) => ({
  isOpen: false,
  selectedIndex: 0,
  open: () => {
    const { tabs, activePath } = useEditor.getState();
    if (tabs.length <= 1) return;
    const currentIndex = tabs.findIndex((t) => t.path === activePath);
    const nextIndex = (currentIndex + 1) % tabs.length;
    set({ isOpen: true, selectedIndex: nextIndex });
  },
  close: () => set({ isOpen: false }),
  next: () => {
    const tabs = useEditor.getState().tabs;
    if (tabs.length === 0) return;
    set((state) => ({ selectedIndex: (state.selectedIndex + 1) % tabs.length }));
  },
  prev: () => {
    const tabs = useEditor.getState().tabs;
    if (tabs.length === 0) return;
    set((state) => ({ selectedIndex: (state.selectedIndex - 1 + tabs.length) % tabs.length }));
  },
  setIndex: (index: number) => set({ selectedIndex: index }),
  confirm: () => {
    const { tabs, setActive } = useEditor.getState();
    const index = get().selectedIndex;
    const target = tabs[index];
    if (target) {
      setActive(target.path);
    }
    set({ isOpen: false });
  },
}));

