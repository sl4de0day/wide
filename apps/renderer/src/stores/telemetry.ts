import { create } from "zustand";
import { bridge } from "@/lib/bridge";

export interface CrashReport {
  kind: string;
  detail: string;
  os: string;
  version: string;
  timestamp: number;
}

interface TelemetryState {
  pendingCrash: CrashReport | null;
  crashPath: string | null;
  isSending: boolean;
  
  checkPending: () => Promise<void>;
  submitPending: () => Promise<void>;
  discardPending: () => Promise<void>;
}

export const useTelemetry = create<TelemetryState>((set, get) => ({
  pendingCrash: null,
  crashPath: null,
  isSending: false,

  checkPending: async () => {
    try {
      const res = await bridge.toolsList("");
      if (!res || !res.dirs?.user) return;
      const userDir = res.dirs.user.replace(/[/\\]tools[/\\]?$/, "");
      let path = `${userDir}/pending_crash.json`;
      let file = await bridge.readFile(path);
      if (!file || file.error || !file.content) {
        path = `${res.dirs.user}/pending_crash.json`;
        file = await bridge.readFile(path);
      }
      if (file && file.content && !file.error) {
        const report = JSON.parse(file.content) as CrashReport;
        set({ pendingCrash: report, crashPath: path });
      }
    } catch {
    }
  },

  submitPending: async () => {
    const { pendingCrash, crashPath } = get();
    if (!pendingCrash) return;

    set({ isSending: true });
    try {
      const supabaseUrl = "https://kunntjfmlsjlvdunqkjl.supabase.co/rest/v1/crash_reports";
      const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1bm50amZtbHNqbHZkdW5xa2psIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MTg2NTQsImV4cCI6MjEwNTQ5NDY1NH0.EoJUVVlah-ugiuxe4O7lF0hjnrmkDCNtTGE0bW_TS0U";

      const res = await fetch(supabaseUrl, {
        method: "POST",
        headers: {
          "apikey": anonKey,
          "Authorization": `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify(pendingCrash)
      });

      if (!res.ok) {
        console.error("[telemetry] Failed to send crash report:", res.statusText);
      }
    } catch (e) {
      console.error("[telemetry] Failed to send crash report:", e);
    } finally {
      if (crashPath) {
        await bridge.trash(crashPath).catch(() => {});
      }
      set({ isSending: false, pendingCrash: null, crashPath: null });
    }
  },

  discardPending: async () => {
    const { crashPath } = get();
    if (crashPath) {
      await bridge.trash(crashPath).catch(() => {});
    }
    set({ pendingCrash: null, crashPath: null });
  }
}));
