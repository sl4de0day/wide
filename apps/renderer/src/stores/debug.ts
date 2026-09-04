import { create } from "zustand";

import { bridge, type DebugEvent, type DebugFrame, type DebugProperty } from "@/lib/bridge";
import { useEditor } from "./editor";
import { useWorkspace } from "./workspace";

export interface DebugScope {
  name: string;
  objectId?: string;

  properties?: DebugProperty[];
  open?: boolean;
}

export interface Watch {
  expr: string;
  value?: string;
  error?: boolean;
}

interface DebugState {

  breakpoints: Record<string, number[]>;

  conditions: Record<string, string>;

  logMessages: Record<string, string>;

  ids: Record<string, string>;

  pauseOnExceptions: "none" | "uncaught" | "all";

  running: boolean;
  paused: boolean;
  frames: DebugFrame[];
  activeFrame: number;
  scopes: DebugScope[];
  output: { level: string; text: string }[];

  watches: Watch[];
  error: string;

  toggleBreakpoint(file: string, line: number): void;
  hasBreakpoint(file: string, line: number): boolean;
  conditionAt(file: string, line: number): string;
  setCondition(file: string, line: number, condition: string): void;
  logMessageAt(file: string, line: number): string;
  setLogMessage(file: string, line: number, message: string): void;
  setPauseOnExceptions(state: "none" | "uncaught" | "all"): void;
  start(cwd: string, file: string): Promise<void>;
  startBrowser(): Promise<void>;
  stop(): Promise<void>;
  resume(): Promise<void>;
  stepOver(): Promise<void>;
  stepInto(): Promise<void>;
  stepOut(): Promise<void>;
  selectFrame(index: number): void;
  toggleScope(index: number): Promise<void>;
  addWatch(expr: string): Promise<void>;
  removeWatch(index: number): void;
  refreshWatches(): Promise<void>;
  evalConsole(expression: string): Promise<void>;
  ingest(event: DebugEvent): void;
}

const bpKey = (file: string, line: number) => `${file}:${line}`;

function compileLogMessage(message: string): string {
  const body = message
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${")
    .replace(/\{([^}]+)\}/g, "${$1}");
  return "console.log(`" + body + "`)";
}

function cdpCondition(state: DebugState, file: string, line: number): string | undefined {
  const key = bpKey(file, line);
  const condition = state.conditions[key]?.trim();
  const log = state.logMessages[key]?.trim();
  if (!log) return condition || undefined;
  const logExpr = `(${compileLogMessage(log)}, false)`;
  return condition ? `(${condition}) && ${logExpr}` : logExpr;
}

export function urlToPath(url: string): string {
  if (!url.startsWith("file:")) return url;
  const without = url.replace(/^file:\/\/\/?/, "");
  let decoded = without;
  try {
    decoded = decodeURIComponent(without);
  } catch {

  }
  return decoded.split("/").join("\\");
}

export const useDebug = create<DebugState>((set, get) => ({
  breakpoints: {},
  conditions: {},
  logMessages: {},
  ids: {},
  pauseOnExceptions: "none",
  running: false,
  paused: false,
  frames: [],
  activeFrame: 0,
  scopes: [],
  output: [],
  watches: [],
  error: "",

  toggleBreakpoint: (file, line) => {
    const lines = new Set(get().breakpoints[file] ?? []);
    const on = !lines.has(line);
    if (on) lines.add(line);
    else lines.delete(line);
    set((state) => ({ breakpoints: { ...state.breakpoints, [file]: [...lines].sort((a, b) => a - b) } }));

    if (!on) {
      set((state) => {
        const conditions = { ...state.conditions };
        const logMessages = { ...state.logMessages };
        delete conditions[bpKey(file, line)];
        delete logMessages[bpKey(file, line)];
        return { conditions, logMessages };
      });
    }

    if (get().running) {
      const key = bpKey(file, line);
      const id = get().ids[key];
      void bridge.debugSetBreakpoint(file, line, on, id, cdpCondition(get(), file, line)).then((reply) => {
        if (on && reply.ok && reply.id) set((state) => ({ ids: { ...state.ids, [key]: reply.id as string } }));
        else if (!on) set((state) => {
          const ids = { ...state.ids };
          delete ids[key];
          return { ids };
        });
      });
    }
  },

  hasBreakpoint: (file, line) => (get().breakpoints[file] ?? []).includes(line),

  conditionAt: (file, line) => get().conditions[bpKey(file, line)] ?? "",

  setCondition: (file, line, condition) => {
    const key = bpKey(file, line);
    const trimmed = condition.trim();
    set((state) => {
      const conditions = { ...state.conditions };
      if (trimmed) conditions[key] = trimmed;
      else delete conditions[key];
      const lines = new Set(state.breakpoints[file] ?? []);
      lines.add(line);
      return {
        conditions,
        breakpoints: { ...state.breakpoints, [file]: [...lines].sort((a, b) => a - b) },
      };
    });

    if (get().running) {
      const id = get().ids[key];

      void (async () => {
        if (id) await bridge.debugSetBreakpoint(file, line, false, id);
        const reply = await bridge.debugSetBreakpoint(file, line, true, null, cdpCondition(get(), file, line));
        if (reply.ok && reply.id) set((state) => ({ ids: { ...state.ids, [key]: reply.id as string } }));
      })();
    }
  },

  logMessageAt: (file, line) => get().logMessages[bpKey(file, line)] ?? "",

  setLogMessage: (file, line, message) => {
    const key = bpKey(file, line);
    const trimmed = message.trim();
    set((state) => {
      const logMessages = { ...state.logMessages };
      if (trimmed) logMessages[key] = trimmed;
      else delete logMessages[key];
      const lines = new Set(state.breakpoints[file] ?? []);
      lines.add(line);
      return {
        logMessages,
        breakpoints: { ...state.breakpoints, [file]: [...lines].sort((a, b) => a - b) },
      };
    });

    if (get().running) {
      const id = get().ids[key];
      void (async () => {
        if (id) await bridge.debugSetBreakpoint(file, line, false, id);
        const reply = await bridge.debugSetBreakpoint(file, line, true, null, cdpCondition(get(), file, line));
        if (reply.ok && reply.id) set((state) => ({ ids: { ...state.ids, [key]: reply.id as string } }));
      })();
    }
  },

  setPauseOnExceptions: (mode) => {
    set({ pauseOnExceptions: mode });
    if (get().running) void bridge.debugPauseOnExceptions(mode);
  },

  start: async (cwd, file) => {
    set({ error: "", output: [], frames: [], paused: false });
    const reply = await bridge.debugStart(cwd, file, flatBreakpoints(get()));
    if (!reply.ok) {
      set({ error: reply.error ?? "The debugger could not start." });
      return;
    }
    set({ running: true });
    if (get().pauseOnExceptions !== "none") void bridge.debugPauseOnExceptions(get().pauseOnExceptions);
  },

  startBrowser: async () => {
    set({ error: "", output: [], frames: [], paused: false });
    const reply = await bridge.debugStartBrowser(flatBreakpoints(get()), useWorkspace.getState().root ?? "");
    if (!reply.ok) {
      set({ error: reply.error ?? "Could not attach to the browser." });
      return;
    }
    set({ running: true });
    if (get().pauseOnExceptions !== "none") void bridge.debugPauseOnExceptions(get().pauseOnExceptions);
  },

  stop: async () => {
    await bridge.debugStop();
    set({ running: false, paused: false, frames: [], scopes: [] });
  },

  resume: async () => {
    set((state) => ({ paused: false, scopes: [], watches: blankWatches(state.watches) }));
    await bridge.debugResume();
  },
  stepOver: async () => {
    set({ scopes: [] });
    await bridge.debugStepOver();
  },
  stepInto: async () => {
    set({ scopes: [] });
    await bridge.debugStepInto();
  },
  stepOut: async () => {
    set({ scopes: [] });
    await bridge.debugStepOut();
  },

  selectFrame: (index) => {
    const frame = get().frames[index];
    set({ activeFrame: index, scopes: framesToScopes(frame) });
    if (frame) void useEditor.getState().revealAt(urlToPath(frame.url), frame.line + 1, frame.column + 1);

    void get().refreshWatches();
  },

  toggleScope: async (index) => {
    const scope = get().scopes[index];
    if (!scope) return;
    if (scope.open) {
      set((state) => ({ scopes: state.scopes.map((s, i) => (i === index ? { ...s, open: false } : s)) }));
      return;
    }
    if (!scope.properties && scope.objectId) {
      const reply = await bridge.debugProperties(scope.objectId);
      set((state) => ({
        scopes: state.scopes.map((s, i) => (i === index ? { ...s, open: true, properties: reply.properties } : s)),
      }));
    } else {
      set((state) => ({ scopes: state.scopes.map((s, i) => (i === index ? { ...s, open: true } : s)) }));
    }
  },

  addWatch: async (expr) => {
    const trimmed = expr.trim();
    if (!trimmed) return;
    set((state) => ({ watches: [...state.watches, { expr: trimmed }] }));
    await get().refreshWatches();
  },

  removeWatch: (index) => {
    set((state) => ({ watches: state.watches.filter((_, i) => i !== index) }));
  },

  refreshWatches: async () => {
    const { watches, frames, activeFrame, paused } = get();
    if (watches.length === 0) return;
    const frameId = paused ? frames[activeFrame]?.id ?? null : null;
    const read = await Promise.all(
      watches.map(async (watch) => {
        const reply = await bridge.debugEvaluate(frameId, watch.expr);
        return { expr: watch.expr, value: reply.error ? reply.error === "throws" ? reply.value : reply.error : reply.value, error: Boolean(reply.error) };
      }),
    );

    set((state) => ({
      watches: state.watches.map((watch) => {
        const fresh = read.find((r) => r.expr === watch.expr);
        return fresh ? { expr: watch.expr, value: fresh.value, error: fresh.error } : watch;
      }),
    }));
  },

  evalConsole: async (expression) => {
    const expr = expression.trim();
    if (!expr) return;
    set((state) => ({ output: cap([...state.output, { level: "input", text: `› ${expr}` }]) }));
    const { frames, activeFrame, paused } = get();
    const frameId = paused ? frames[activeFrame]?.id ?? null : null;
    const reply = await bridge.debugEvaluate(frameId, expr);
    const text = reply.error && reply.error !== "throws" ? reply.error : reply.value;
    set((state) => ({
      output: cap([...state.output, { level: reply.error ? "error" : "result", text: text || "undefined" }]),
    }));
  },

  ingest: (event) => {
    switch (event.type) {
      case "paused": {
        set({
          paused: true,
          frames: event.frames,
          activeFrame: 0,
          scopes: framesToScopes(event.frames[0]),
        });
        const top = event.frames[0];
        if (top) void useEditor.getState().revealAt(urlToPath(top.url), top.line + 1, top.column + 1);
        void get().refreshWatches();
        break;
      }
      case "resumed":
        set((state) => ({ paused: false, scopes: [], watches: blankWatches(state.watches) }));
        break;
      case "console":
        set((state) => ({ output: cap([...state.output, { level: event.level, text: event.text }]) }));
        break;
      case "output":
        set((state) => ({ output: cap([...state.output, { level: event.stream, text: event.text }]) }));
        break;
      case "exited":
        set((state) => ({
          running: false,
          paused: false,
          frames: [],
          scopes: [],
          output: cap([...state.output, { level: "info", text: `Process exited with code ${event.code}.` }]),
        }));
        break;
      case "closed":
        set({ running: false, paused: false });
        break;
    }
  },
}));

function flatBreakpoints(state: DebugState): { file: string; line: number; condition?: string }[] {
  return Object.entries(state.breakpoints).flatMap(([file, lines]) =>
    lines.map((line) => {
      const condition = cdpCondition(state, file, line);
      return condition ? { file, line, condition } : { file, line };
    }),
  );
}

const blankWatches = (watches: Watch[]): Watch[] =>
  watches.map((watch) => ({ expr: watch.expr }));

function framesToScopes(frame: DebugFrame | undefined): DebugScope[] {
  if (!frame) return [];
  return frame.scopes
    .filter((scope) => scope.type !== "global")
    .map((scope) => ({ name: scope.name, objectId: scope.objectId }));
}

const MAX_OUTPUT = 500;
const cap = (list: { level: string; text: string }[]) =>
  list.length > MAX_OUTPUT ? list.slice(list.length - MAX_OUTPUT) : list;

export function subscribeDebugEvents(): () => void {
  return bridge.onDebugEvent((event) => useDebug.getState().ingest(event));
}
