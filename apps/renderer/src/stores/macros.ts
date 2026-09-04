import { create } from "zustand";

import { bridge, type MacroExtract, type MacroStep, type MacroStepResult } from "@/lib/bridge";
import { parseHttpMessage } from "@/lib/httpMessage";

export interface Macro {
  id: string;
  name: string;

  steps: string[];
  extract: MacroExtract[];
}

export interface MacroSession {
  cookies: [string, string][];
  tokens: [string, string][];
  results: MacroStepResult[];
  failedStep?: number;
  error?: string;
}

interface MacrosState {
  open: boolean;
  macros: Macro[];
  activeId: string | null;
  running: boolean;
  session: MacroSession | null;
  openMacros(): void;
  close(): void;
  select(id: string): void;
  add(): void;
  remove(id: string): void;
  update(id: string, patch: Partial<Macro>): void;

  seedStep(text: string): void;
  run(macro: Macro): Promise<void>;
}

const STORAGE_KEY = "wide.macros";

function load(): Macro[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(macros: Macro[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(macros));
  } catch {

  }
}

let counter = 0;
function freshId(): string {
  counter += 1;
  return `macro-${Date.now().toString(36)}-${counter}`;
}

const BLANK_STEP = "POST https://example.com/login\nContent-Type: application/x-www-form-urlencoded\n\nuser=admin&pass=admin";

function newMacro(): Macro {
  return { id: freshId(), name: "New macro", steps: [BLANK_STEP], extract: [] };
}

export function textToStep(text: string): MacroStep | null {
  return parseHttpMessage(text);
}

export const useMacros = create<MacrosState>((set, get) => ({
  open: false,
  macros: load(),
  activeId: null,
  running: false,
  session: null,

  openMacros: () => {
    const { macros, activeId } = get();
    if (macros.length === 0) {
      const macro = newMacro();
      const next = [macro];
      save(next);
      set({ open: true, macros: next, activeId: macro.id, session: null });
    } else {
      set({ open: true, activeId: activeId ?? macros[0].id, session: null });
    }
  },
  close: () => set({ open: false }),
  select: (id) => set({ activeId: id, session: null }),

  add: () => {
    const macro = newMacro();
    const next = [...get().macros, macro];
    save(next);
    set({ macros: next, activeId: macro.id, session: null });
  },
  remove: (id) => {
    const next = get().macros.filter((macro) => macro.id !== id);
    save(next);
    set((state) => ({
      macros: next,
      activeId: state.activeId === id ? (next[0]?.id ?? null) : state.activeId,
      session: state.activeId === id ? null : state.session,
    }));
  },
  update: (id, patch) => {
    const next = get().macros.map((macro) => (macro.id === id ? { ...macro, ...patch } : macro));
    save(next);
    set({ macros: next });
  },

  seedStep: (text) => {
    const state = get();
    let macros = state.macros;
    let activeId = state.activeId ?? macros[0]?.id ?? null;
    if (!activeId) {
      const macro = { ...newMacro(), steps: [text] };
      macros = [macro];
      activeId = macro.id;
    } else {
      macros = macros.map((macro) => (macro.id === activeId ? { ...macro, steps: [...macro.steps, text] } : macro));
    }
    save(macros);
    set({ open: true, macros, activeId, session: null });
  },

  run: async (macro) => {
    const steps = macro.steps.map(textToStep);
    if (steps.some((step) => step === null)) {
      set({ session: { cookies: [], tokens: [], results: [], error: "A step is not a valid request (needs METHOD URL on the first line)." } });
      return;
    }
    set({ running: true, session: null });
    const result = await bridge.proxyRunMacro({ steps: steps as MacroStep[], extract: macro.extract });
    if (!result.ok) {
      set({ running: false, session: { cookies: result.cookies ?? [], tokens: result.tokens ?? [], results: result.results ?? [], failedStep: result.step, error: result.error } });
      return;
    }
    set({
      running: false,
      session: { cookies: result.cookies ?? [], tokens: result.tokens ?? [], results: result.results ?? [] },
    });
  },
}));
