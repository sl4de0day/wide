import { create } from "zustand";

import {
  bridge,
  type InterceptedRequest,
  type InterceptedResponse,
  type MatchReplaceRule,
  type ProxyEntry,
  type ProxyWsFrame,
} from "@/lib/bridge";
import { passiveChecks } from "@/lib/passiveScan";
import { useFindings } from "./findings";

const MAX = 5000;
const FRAME_MAX = 5000;

let ruleTimer: ReturnType<typeof setTimeout> | null = null;

const scannedKeys = new Set<string>();

interface ProxyState {
  running: boolean;
  port: number;
  scope: string[];
  entries: ProxyEntry[];
  selected: number | null;
  busy: boolean;
  error: string;

  rules: MatchReplaceRule[];
  intercepting: boolean;

  interceptingResponses: boolean;
  heldResponses: InterceptedResponse[];

  scanning: boolean;

  held: InterceptedRequest[];

  refresh(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  setScope(scope: string[]): Promise<void>;
  clear(): Promise<void>;
  select(id: number | null): void;
  ingest(entry: ProxyEntry): void;
  importEntries(entries: ProxyEntry[]): void;
  ingestFrame(frame: ProxyWsFrame): void;
  setRules(rules: MatchReplaceRule[]): Promise<void>;
  setIntercept(on: boolean): Promise<void>;
  setInterceptResponse(on: boolean): Promise<void>;
  toggleScan(): void;
  decide(id: number, action: "forward" | "drop", edited?: { method?: string; headers?: [string, string][]; body?: string }): Promise<void>;
  decideAll(action: "forward" | "drop"): Promise<void>;
  decideAllResponses(action: "forward" | "drop"): Promise<void>;
  decideResponse(id: number, action: "forward" | "drop", edited?: { status?: number; headers?: [string, string][]; body?: string }): Promise<void>;
  ingestIntercept(request: InterceptedRequest): void;
  ingestInterceptResponse(response: InterceptedResponse): void;

  exportSession(): string;

  importSession(json: string): boolean;
}

export const useProxy = create<ProxyState>((set, get) => ({
  running: false,
  port: 0,
  scope: [],
  entries: [],
  selected: null,
  busy: false,
  error: "",
  rules: [],
  intercepting: false,
  interceptingResponses: false,
  heldResponses: [],
  scanning: false,
  held: [],

  refresh: async () => {
    const [status, traffic] = await Promise.all([bridge.proxyStatus(), bridge.proxyTraffic()]);
    set({
      running: Boolean(status.ok && status.running),
      port: status.ok ? (status.port ?? 0) : 0,
      scope: status.ok ? (status.scope ?? []) : [],
      entries: traffic.ok && (traffic.entries?.length ?? 0) > 0 ? (traffic.entries ?? []) : get().entries,

      intercepting: status.ok ? Boolean(status.intercepting) : false,
      interceptingResponses: status.ok ? Boolean(status.interceptingResponses) : false,
      rules: status.ok ? (status.rules ?? []) : [],
      held: status.ok ? (status.held ?? []) : [],
      heldResponses: status.ok ? (status.heldResponses ?? []) : [],
    });
  },

  start: async () => {
    set({ busy: true, error: "" });
    const reply = await bridge.proxyStart();
    set({
      busy: false,
      running: Boolean(reply.ok),
      port: reply.ok ? (reply.port ?? 0) : 0,
      scope: reply.ok ? (reply.scope ?? get().scope) : get().scope,
      error: reply.ok ? "" : (reply.error ?? "The proxy could not start."),
    });
  },

  stop: async () => {
    set({ busy: true });
    const reply = await bridge.proxyStop();
    set({ busy: false, running: reply.ok ? false : get().running });
  },

  setScope: async (scope) => {
    const reply = await bridge.proxyScope(scope);
    if (reply.ok) set({ scope: reply.scope ?? scope });
  },

  clear: async () => {
    await bridge.proxyClear();
    set({ entries: [], selected: null });
  },

  select: (id) => set({ selected: id }),

  setRules: async (rules) => {

    set({ rules });
    if (ruleTimer) clearTimeout(ruleTimer);
    ruleTimer = setTimeout(() => void bridge.proxyMatchReplace(useProxy.getState().rules), 300);
  },

  setIntercept: async (on) => {
    set({ intercepting: on, held: on ? get().held : [] });
    await bridge.proxySetIntercept({ request: on });
  },

  setInterceptResponse: async (on) => {
    set({ interceptingResponses: on, heldResponses: on ? get().heldResponses : [] });
    await bridge.proxySetIntercept({ response: on });
  },

  decide: async (id, action, edited) => {
    set((state) => ({ held: state.held.filter((request) => request.id !== id) }));
    await bridge.proxyInterceptDecision(id, action, edited);
  },

  decideResponse: async (id, action, edited) => {
    set((state) => ({ heldResponses: state.heldResponses.filter((response) => response.id !== id) }));
    await bridge.proxyResponseDecision(id, action, edited);
  },

  decideAll: async (action) => {
    const ids = get().held.map((request) => request.id);
    set({ held: [] });
    for (const id of ids) await bridge.proxyInterceptDecision(id, action);
  },

  decideAllResponses: async (action) => {
    const ids = get().heldResponses.map((response) => response.id);
    set({ heldResponses: [] });
    for (const id of ids) await bridge.proxyResponseDecision(id, action);
  },

  ingestIntercept: (request) => set((state) => ({ held: [...state.held, request] })),

  ingestInterceptResponse: (response) => set((state) => ({ heldResponses: [...state.heldResponses, response] })),

  toggleScan: () => set((state) => ({ scanning: !state.scanning })),

  importEntries: (list) =>
    set((state) => {
      if (!list.length) return state;
      const entries = [...state.entries, ...list];
      if (entries.length > MAX) entries.splice(0, entries.length - MAX);
      return { entries };
    }),

  ingest: (entry) => {

    if (get().scanning && !entry.websocket) {
      for (const issue of passiveChecks(entry)) {
        const key = `${entry.host}:${issue.checkId}`;
        if (scannedKeys.has(key)) continue;
        scannedKeys.add(key);
        useFindings.getState().add({
          title: issue.title,
          severity: issue.severity,
          location: entry.url,
          detail: issue.detail,
        });
      }
    }
    set((state) => {
      const at = state.entries.findIndex((existing) => existing.id === entry.id);
      if (at !== -1) {
        const entries = [...state.entries];
        entries[at] = entry;
        return { entries };
      }
      const entries = [...state.entries, entry];
      if (entries.length > MAX) entries.shift();
      return { entries };
    });
  },

  ingestFrame: (frame) =>
    set((state) => {
      const entries = [...state.entries];
      const at = entries.findIndex((entry) => entry.id === frame.id);
      const framePart = { direction: frame.direction, kind: frame.kind, text: frame.text, bytes: frame.bytes, at: frame.at };
      if (at === -1) {
        entries.push({
          id: frame.id,
          at: frame.at ?? Date.now(),
          ms: 0,
          method: "WS",
          url: "",
          host: "",
          scheme: "https",
          status: 101,
          reqHeaders: [],
          reqBody: "",
          resHeaders: [],
          resBody: "",
          websocket: true,
          frames: [framePart as ProxyWsFrame],
        });
        if (entries.length > MAX) entries.shift();
      } else {

        const next = [...(entries[at].frames ?? []), framePart as ProxyWsFrame];
        if (next.length > FRAME_MAX) next.splice(0, next.length - FRAME_MAX);
        entries[at] = { ...entries[at], frames: next };
      }
      return { entries };
    }),

  exportSession: () => {
    const { scope, rules, entries } = get();
    return JSON.stringify({ version: 1, savedAt: new Date().toISOString(), scope, rules, entries }, null, 2);
  },

  importSession: (json) => {
    try {
      const data = JSON.parse(json);
      if (!data || typeof data !== "object") return false;
      const scope = Array.isArray(data.scope) ? data.scope : get().scope;
      const rules = Array.isArray(data.rules) ? data.rules : get().rules;
      set({
        entries: Array.isArray(data.entries) ? data.entries : [],
        scope,
        rules,
        selected: null,
      });
      void bridge.proxyScope(scope);
      void bridge.proxyMatchReplace(rules);
      return true;
    } catch {
      return false;
    }
  },
}));

export function subscribeProxyTraffic(): () => void {
  const offTraffic = bridge.onProxyTraffic((batch) => {
    const s = useProxy.getState();
    for (const entry of batch) s.ingest(entry);
  });
  const offWs = bridge.onProxyWs((batch) => {
    const s = useProxy.getState();
    for (const frame of batch) s.ingestFrame(frame);
  });
  const offIntercept = bridge.onProxyIntercept((request) => useProxy.getState().ingestIntercept(request));
  const offInterceptRes = bridge.onProxyInterceptResponse((response) => useProxy.getState().ingestInterceptResponse(response));
  return () => {
    offTraffic();
    offWs();
    offIntercept();
    offInterceptRes();
  };
}
