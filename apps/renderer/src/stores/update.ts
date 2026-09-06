import { create } from "zustand";

import { bridge } from "@/lib/bridge";
import { useSettings } from "@/stores/settings";

interface UpdateState {
  checking: boolean;

  available: boolean;
  current: string;
  latest: string;
  url: string;
  asset: string;
  sums: string;
  notes: string;
  error: string | null;

  dismissed: boolean;
  configured: boolean;
  blocked: boolean;
  installing: "idle" | "download" | "install";
  booting: boolean;
  check(): Promise<void>;
  boot(): Promise<void>;
  stage(): Promise<void>;
  open(): void;
  install(): Promise<void>;
  dismiss(): void;
}

const INSTALLER_RE = /^https:\/\/.*\.exe$/i;

export const useUpdate = create<UpdateState>((set, get) => ({
  checking: false,
  available: false,
  current: "",
  latest: "",
  url: "",
  asset: "",
  sums: "",
  notes: "",
  error: null,
  dismissed: false,
  configured: false,
  blocked: false,
  installing: "idle",
  booting: true,

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
      asset: reply.asset ?? "",
      sums: reply.sums ?? "",
      notes: reply.notes ?? "",
      available: Boolean(reply.available),
      blocked: Boolean(reply.blocked),
      dismissed: false,
    });
  },

  open: () => {
    const { url } = get();
    if (url) void bridge.updateOpen(url);
  },

  install: async () => {
    const { url, installing, latest, asset, sums } = get();
    if (!url || installing !== "idle") return;
    if (!INSTALLER_RE.test(url)) {
      void bridge.updateOpen(url);
      return;
    }
    set({ installing: "download", error: null });
    const dl = await bridge.updateDownload({ url, version: latest, asset, sums });
    if (!dl.ok || !dl.path) {
      set({ installing: "idle", error: dl.error ?? "The update could not be downloaded." });
      return;
    }
    set({ installing: "install" });
    const run = await bridge.updateInstall({ version: latest, asset, sums });
    if (!run.ok) {
      set({ installing: "idle", error: run.error ?? "The update could not be installed." });
    }
  },

  stage: async () => {
    const { url, latest, asset, sums, available, blocked, installing } = get();
    if (!available || blocked || installing !== "idle") return;
    if (!url || !INSTALLER_RE.test(url)) return;
    await bridge.updateDownload({ url, version: latest, asset, sums });
  },

  boot: async () => {
    try {
      await Promise.race([get().check(), new Promise((resolve) => setTimeout(resolve, 12000))]);
      const { available, blocked, url } = get();
      if (available && !blocked && url && INSTALLER_RE.test(url)) {
        await get().install();
        if (get().installing !== "idle") return;
      }
    } catch {
      void 0;
    }
    set({ booting: false });
  },

  dismiss: () => set({ dismissed: true }),
}));
