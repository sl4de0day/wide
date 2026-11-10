import { create } from "zustand";

export interface AiBrowserAction {
  id: string;
  action: string;
  url?: string;
  target?: string;
  timestamp: number;
}

export interface AiBrowserState {
  active: boolean;
  url: string;
  title: string;
  lastAction: string;
  frame: string | null;
  history: AiBrowserAction[];
  status: "idle" | "navigating" | "clicking" | "typing" | "extracting" | "ready";
  recordAction: (event: { action: string; url?: string; frame?: string; target?: string; timestamp?: number }) => void;
  clear: () => void;
}

export const useAiBrowser = create<AiBrowserState>((set) => ({
  active: false,
  url: "about:blank",
  title: "AI Browser Stream",
  lastAction: "Idle",
  frame: null,
  history: [],
  status: "idle",
  recordAction: (event) =>
    set((state) => {
      const actionItem: AiBrowserAction = {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        action: event.action,
        url: event.url,
        target: event.target,
        timestamp: event.timestamp || Date.now(),
      };
      let status: AiBrowserState["status"] = "ready";
      if (event.action.includes("navigate")) status = "navigating";
      else if (event.action.includes("click")) status = "clicking";
      else if (event.action.includes("type")) status = "typing";
      else if (event.action.includes("extract")) status = "extracting";

      return {
        active: true,
        url: event.url || state.url,
        title: event.url ? `AI: ${event.url}` : state.title,
        lastAction: event.action,
        frame: event.frame !== undefined ? event.frame : state.frame,
        history: [actionItem, ...state.history].slice(0, 50),
        status,
      };
    }),
  clear: () =>
    set({
      active: false,
      url: "about:blank",
      title: "AI Browser Stream",
      lastAction: "Session closed",
      frame: null,
      history: [],
      status: "idle",
    }),
}));
