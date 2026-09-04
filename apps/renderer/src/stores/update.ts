import { create } from "zustand";

import { bridge } from "@/lib/bridge";
import { useSettings } from "@/stores/settings";

interface UpdateState {
  checking: boolean;

  available: boolean;
  current: string;
  latest: string;
  url: string;
  notes: string;
  error: string | null;

  dismissed: boolean;
  configured: boolean;
  installing: "idle" | "download" | "install";
  check(): Promise<void>;
  open(): void;
  install(): Promise<void>;
  dismiss(): void;
}

export const useUpdate = create<UpdateState>((set, get) => ({
  checking: false,
  available: false,
  current: "",
  latest: "",
  url: "",
  notes: "",
  error: null,
  dismissed: false,
  configured: false,
  installing: "idle",

  check: async () => {
    const manifestUrl = useSettings.getState().updateManifestUrl;
    set({ checking: true, error: null });
    const reply = await bridge.updateCheck(manifestUrl);
    if (!reply.ok) {
      set({ checking: false, error: reply.error ?? "The update check failed.", current: reply.current ?? get().current });
      return;
    }
    set({
      checking: false,
      configured: Boolean(reply.configured),
      current: reply.current ?? "",
      latest: reply.latest ?? "",
      url: reply.url ?? "",
      notes: reply.notes ?? "",
      available: Boolean(reply.available),
      dismissed: false,
    });
  },

  open: () => {
    const { url } = get();
    if (url) void bridge.updateOpen(url);
  },

  install: async () => {
    const { url, installing } = get();
    if (!url || installing !== "idle") return;
    if (!/^https:\/\/.*\.exe$/i.test(url)) {
      void bridge.updateOpen(url);
      return;
    }
    set({ installing: "download", error: null });
    const dl = await bridge.updateDownload(url);
    if (!dl.ok || !dl.path) {
      set({ installing: "idle", error: dl.error ?? "The update could not be downloaded." });
      return;
    }
    set({ installing: "install" });
    const run = await bridge.updateInstall(dl.path);
    if (!run.ok) {
      set({ installing: "idle", error: run.error ?? "The update could not be installed." });
    }
  },

  dismiss: () => set({ dismissed: true }),
}));
