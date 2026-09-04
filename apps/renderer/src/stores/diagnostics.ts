import { create } from "zustand";

import { bridge, type Diagnostic } from "@/lib/bridge";
import { normalisePath } from "@/lib/utils";

export interface FileCounts {
  errors: number;
  warnings: number;
}

export type DiagnosticSource = "typescript" | "eslint" | "inspection" | "lsp" | "security";

interface DiagnosticsState {

  bySource: Record<string, Partial<Record<DiagnosticSource, Diagnostic[]>>>;

  byFile: Record<string, Diagnostic[]>;

  problemTotals: FileCounts;

  securityCount: number;

  projectCounts: Record<string, FileCounts>;
  scanning: boolean;

  setFor(path: string, source: DiagnosticSource, diagnostics: Diagnostic[]): void;
  clearSource(source: DiagnosticSource): void;
  clear(path: string): void;
  scanProject(root: string): Promise<void>;
  reset(): void;
}

function flatten(
  bySource: Record<string, Partial<Record<DiagnosticSource, Diagnostic[]>>>,
  previousBySource: Record<string, Partial<Record<DiagnosticSource, Diagnostic[]>>> = {},
  previousByFile: Record<string, Diagnostic[]> = {},
): Record<string, Diagnostic[]> {
  const out: Record<string, Diagnostic[]> = {};
  for (const [path, sources] of Object.entries(bySource)) {
    const reusable = previousBySource[path] === sources ? previousByFile[path] : undefined;
    if (reusable) {
      out[path] = reusable;
      continue;
    }
    const all = Object.values(sources).flat().filter(Boolean) as Diagnostic[];
    if (all.length > 0) out[path] = all.sort((a, b) => a.from - b.from || a.to - b.to);
  }
  return out;
}

function splitCounts(
  bySource: Record<string, Partial<Record<DiagnosticSource, Diagnostic[]>>>,
): { problems: FileCounts; security: number } {
  let errors = 0;
  let warnings = 0;
  let security = 0;
  for (const sources of Object.values(bySource)) {
    for (const [source, list] of Object.entries(sources)) {
      if (!list) continue;
      if (source === "security") {
        security += list.length;
        continue;
      }
      for (const d of list) {
        if (d.severity === "error") errors += 1;
        else if (d.severity === "warning") warnings += 1;
      }
    }
  }
  return { problems: { errors, warnings }, security };
}

function recount(
  bySource: Record<string, Partial<Record<DiagnosticSource, Diagnostic[]>>>,
): { problemTotals: FileCounts; securityCount: number } {
  const split = splitCounts(bySource);
  return { problemTotals: split.problems, securityCount: split.security };
}

export const useDiagnostics = create<DiagnosticsState>((set, get) => ({
  bySource: {},
  byFile: {},
  problemTotals: { errors: 0, warnings: 0 },
  securityCount: 0,
  projectCounts: {},
  scanning: false,

  setFor: (path, source, diagnostics) =>
    set((state) => {
      const current = state.bySource[path] ?? {};
      const existing = current[source];

      if ((existing?.length ?? 0) === 0 && diagnostics.length === 0) return state;

      const nextForPath = { ...current };
      if (diagnostics.length === 0) delete nextForPath[source];
      else nextForPath[source] = diagnostics;

      const bySource = { ...state.bySource };
      if (Object.keys(nextForPath).length === 0) delete bySource[path];
      else bySource[path] = nextForPath;

      const byFile = flatten(bySource, state.bySource, state.byFile);
      return { bySource, byFile, ...recount(bySource) };
    }),

  clearSource: (source) =>
    set((state) => {
      const bySource: typeof state.bySource = {};
      for (const [path, sources] of Object.entries(state.bySource)) {
        const rest = { ...sources };
        delete rest[source];
        if (Object.keys(rest).length > 0) bySource[path] = rest;
      }
      const byFile = flatten(bySource, state.bySource, state.byFile);
      return { bySource, byFile, ...recount(bySource) };
    }),

  clear: (path) =>
    set((state) => {
      if (!state.bySource[path]) return state;
      const bySource = { ...state.bySource };
      delete bySource[path];
      const byFile = flatten(bySource, state.bySource, state.byFile);
      return { bySource, byFile, ...recount(bySource) };
    }),

  scanProject: async (root) => {
    if (!root || get().scanning) return;
    set({ scanning: true });
    try {
      const result = await bridge.tsProjectDiagnostics(root);
      const counts: Record<string, FileCounts> = {};
      for (const [path, value] of Object.entries(result?.counts ?? {})) {
        counts[normalisePath(path)] = value;
      }
      set({ projectCounts: counts, scanning: false });
    } catch {
      set({ scanning: false });
    }
  },

  reset: () =>
    set({
      bySource: {},
      byFile: {},
      problemTotals: { errors: 0, warnings: 0 },
      securityCount: 0,
      projectCounts: {},
    }),
}));
