import { create } from "zustand";

import { bridge, type DockerContainer, type RemoteProfile } from "@/lib/bridge";

const ACTIVE_KEY = "wide.remote.active";

function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeActive(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    void 0;
  }
}

interface RemoteState {
  profiles: RemoteProfile[];
  activeId: string | null;
  loaded: boolean;
  containers: DockerContainer[];
  activeContainer: string | null;
  dockerError: string | null;

  load(): Promise<void>;
  save(profile: Partial<RemoteProfile>): Promise<RemoteProfile | null>;
  remove(id: string): Promise<void>;
  setActive(id: string | null): void;
  activeProfile(): RemoteProfile | null;
  loadContainers(): Promise<void>;
  setActiveContainer(id: string | null): void;
}

export const useRemote = create<RemoteState>((set, get) => ({
  profiles: [],
  activeId: readActive(),
  loaded: false,
  containers: [],
  activeContainer: null,
  dockerError: null,

  load: async () => {
    const reply = await bridge.remoteList();
    const profiles = reply.ok ? reply.profiles ?? [] : [];
    set((state) => ({ profiles, loaded: true, activeId: profiles.some((p) => p.id === state.activeId) ? state.activeId : null }));
  },

  save: async (profile) => {
    const reply = await bridge.remoteSave(profile);
    if (!reply.ok || !reply.profile) return null;
    const saved = reply.profile;
    set((state) => {
      const at = state.profiles.findIndex((p) => p.id === saved.id);
      const profiles = at === -1 ? [...state.profiles, saved] : state.profiles.map((p) => (p.id === saved.id ? saved : p));
      return { profiles };
    });
    return saved;
  },

  remove: async (id) => {
    await bridge.remoteRemove(id);
    set((state) => {
      const activeId = state.activeId === id ? null : state.activeId;
      if (activeId !== state.activeId) writeActive(null);
      return { profiles: state.profiles.filter((p) => p.id !== id), activeId };
    });
  },

  setActive: (id) => {
    writeActive(id);
    set({ activeId: id, activeContainer: id ? null : get().activeContainer });
  },

  activeProfile: () => {
    const { profiles, activeId } = get();
    return profiles.find((p) => p.id === activeId) ?? null;
  },

  loadContainers: async () => {
    const reply = await bridge.dockerList();
    if (reply.ok) set({ containers: reply.containers ?? [], dockerError: null });
    else set({ containers: [], dockerError: reply.error ?? "Docker is not available." });
  },

  setActiveContainer: (id) => {
    set({ activeContainer: id, activeId: id ? null : get().activeId });
    if (id) writeActive(null);
  },
}));
