import { create } from "zustand";
import { bridge, type Project } from "@/lib/bridge";

interface RecentProjectsState {
  isOpen: boolean;
  projects: Project[];
  loading: boolean;
  open(): void;
  close(): void;
  setProjects(projects: Project[]): void;
}

export const useRecentProjects = create<RecentProjectsState>((set) => ({
  isOpen: false,
  projects: [],
  loading: false,
  open: () => {
    set({ isOpen: true, loading: true });
    void bridge
      .recentProjects()
      .then((res) => {
        set({ projects: res?.projects ?? [], loading: false });
      })
      .catch(() => {
        set({ loading: false });
      });
  },
  close: () => set({ isOpen: false }),
  setProjects: (projects) => set({ projects }),
}));
