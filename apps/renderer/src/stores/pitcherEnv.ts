import { create } from "zustand";

export interface EnvVar {
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
}

export interface Environment {
  id: string;
  name: string;
  vars: EnvVar[];
}

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`;

const KEY = "wide.pitcher.env";
interface Persisted {
  environments: Environment[];
  globals: EnvVar[];
  activeId: string | null;
}
function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { environments: [], globals: [], activeId: null };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      environments: Array.isArray(parsed.environments) ? parsed.environments : [],
      globals: Array.isArray(parsed.globals) ? parsed.globals : [],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return { environments: [], globals: [], activeId: null };
  }
}

function mapToVars(vars: EnvVar[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars) if (v.enabled && v.key.trim()) out[v.key] = v.value;
  return out;
}

interface EnvState extends Persisted {
  addEnv(name?: string): string;
  removeEnv(id: string): void;
  renameEnv(id: string, name: string): void;
  duplicateEnv(id: string): void;
  setActive(id: string | null): void;
  setEnvVars(id: string, vars: EnvVar[]): void;
  setGlobals(vars: EnvVar[]): void;
  activeEnv(): Environment | null;

  merged(collectionVars?: EnvVar[]): Record<string, string>;

  setVar(key: string, value: string, scope?: "environment" | "globals"): void;
  unsetVar(key: string, scope?: "environment" | "globals"): void;
}

function persist(s: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ environments: s.environments, globals: s.globals, activeId: s.activeId }));
  } catch {

  }
}

export const usePitcherEnv = create<EnvState>((set, get) => ({
  ...load(),

  addEnv: (name = "New environment") => {
    const env: Environment = { id: uid("e"), name, vars: [] };
    set((s) => {
      const environments = [...s.environments, env];
      const activeId = s.activeId ?? env.id;
      persist({ environments, globals: s.globals, activeId });
      return { environments, activeId };
    });
    return env.id;
  },

  removeEnv: (id) =>
    set((s) => {
      const environments = s.environments.filter((e) => e.id !== id);
      const activeId = s.activeId === id ? (environments[0]?.id ?? null) : s.activeId;
      persist({ environments, globals: s.globals, activeId });
      return { environments, activeId };
    }),

  renameEnv: (id, name) =>
    set((s) => {
      const environments = s.environments.map((e) => (e.id === id ? { ...e, name } : e));
      persist({ environments, globals: s.globals, activeId: s.activeId });
      return { environments };
    }),

  duplicateEnv: (id) =>
    set((s) => {
      const src = s.environments.find((e) => e.id === id);
      if (!src) return s;
      const copy: Environment = { id: uid("e"), name: `${src.name} copy`, vars: src.vars.map((v) => ({ ...v })) };
      const environments = [...s.environments, copy];
      persist({ environments, globals: s.globals, activeId: s.activeId });
      return { environments };
    }),

  setActive: (id) =>
    set((s) => {
      persist({ environments: s.environments, globals: s.globals, activeId: id });
      return { activeId: id };
    }),

  setEnvVars: (id, vars) =>
    set((s) => {
      const environments = s.environments.map((e) => (e.id === id ? { ...e, vars } : e));
      persist({ environments, globals: s.globals, activeId: s.activeId });
      return { environments };
    }),

  setGlobals: (vars) =>
    set((s) => {
      persist({ environments: s.environments, globals: vars, activeId: s.activeId });
      return { globals: vars };
    }),

  activeEnv: () => {
    const s = get();
    return s.environments.find((e) => e.id === s.activeId) ?? null;
  },

  merged: (collectionVars = []) => {
    const s = get();
    const env = s.environments.find((e) => e.id === s.activeId);
    return { ...mapToVars(s.globals), ...mapToVars(collectionVars), ...mapToVars(env?.vars ?? []) };
  },

  setVar: (key, value, scope) => {
    const s = get();
    const target: "environment" | "globals" = scope ?? (s.activeId ? "environment" : "globals");
    if (target === "globals") {
      const exists = s.globals.some((v) => v.key === key);
      const globals = exists ? s.globals.map((v) => (v.key === key ? { ...v, value } : v)) : [...s.globals, { key, value, enabled: true }];
      get().setGlobals(globals);
      return;
    }
    if (!s.activeId) return;
    const env = s.environments.find((e) => e.id === s.activeId);
    if (!env) return;
    const exists = env.vars.some((v) => v.key === key);
    const vars = exists ? env.vars.map((v) => (v.key === key ? { ...v, value } : v)) : [...env.vars, { key, value, enabled: true }];
    get().setEnvVars(s.activeId, vars);
  },

  unsetVar: (key, scope) => {
    const s = get();
    const target: "environment" | "globals" = scope ?? (s.activeId ? "environment" : "globals");
    if (target === "globals") {
      get().setGlobals(s.globals.filter((v) => v.key !== key));
      return;
    }
    if (!s.activeId) return;
    const env = s.environments.find((e) => e.id === s.activeId);
    if (!env) return;
    get().setEnvVars(s.activeId, env.vars.filter((v) => v.key !== key));
  },
}));
