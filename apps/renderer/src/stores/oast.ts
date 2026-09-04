import { create } from "zustand";

import { bridge, type OastInteraction } from "@/lib/bridge";

const SERVER_KEY = "wide.oast.server";
const TOKEN_KEY = "wide.oast.token";
const load = (k: string): string => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const save = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {

  }
};

let payloadSeq = 0;

interface OastState {
  installed: boolean;
  running: boolean;
  domain: string;
  server: string;
  token: string;
  interactions: OastInteraction[];
  setServer(v: string): void;
  setToken(v: string): void;
  refresh(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  clear(): void;
  ingest(i: OastInteraction): void;
  applyStatus(s: { running: boolean; domain: string; server: string }): void;

  newPayload(): { id: string; host: string };
}

export const useOast = create<OastState>((set, get) => ({
  installed: false,
  running: false,
  domain: "",
  server: load(SERVER_KEY),
  token: load(TOKEN_KEY),
  interactions: [],

  setServer: (v) => {
    save(SERVER_KEY, v);
    set({ server: v });
  },
  setToken: (v) => {
    save(TOKEN_KEY, v);
    set({ token: v });
  },
  refresh: async () => {
    const r = await bridge.oastStatus();
    if (r.ok) set({ installed: Boolean(r.installed), running: Boolean(r.running), domain: r.domain ?? "" });
  },
  start: async () => {
    const { server, token } = get();
    const r = await bridge.oastStart(server, token);
    if (r.ok) set({ running: Boolean(r.running), domain: r.domain ?? get().domain });
  },
  stop: async () => {
    await bridge.oastStop();
    set({ running: false, domain: "" });
  },
  clear: () => set({ interactions: [] }),
  ingest: (i) => set((s) => ({ interactions: [i, ...s.interactions].slice(0, 500) })),
  applyStatus: (st) => set({ running: st.running, domain: st.domain, server: st.server || get().server }),
  newPayload: () => {
    const domain = get().domain;
    if (!domain) return { id: "", host: "" };
    payloadSeq += 1;
    const id = `w${payloadSeq}${Math.random().toString(36).slice(2, 6)}`;
    return { id, host: `${id}.${domain}` };
  },
}));

export function subscribeOast(): () => void {
  const offInteraction = bridge.onOastInteraction((i) => useOast.getState().ingest(i));
  const offStatus = bridge.onOastStatus((st) => useOast.getState().applyStatus(st));
  return () => {
    offInteraction();
    offStatus();
  };
}
