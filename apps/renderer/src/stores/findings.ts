import { create } from "zustand";

import { useWorkspace } from "./workspace";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface Finding {
  id: string;
  title: string;
  severity: Severity;

  location: string;

  detail: string;

  at: number;
}

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

const keyFor = (root: string | null): string => "wide.findings" + (root ? ":" + root : "");

function load(root: string | null): Finding[] {
  try {
    const raw = localStorage.getItem(keyFor(root));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(findings: Finding[], root: string | null): void {
  try {
    localStorage.setItem(keyFor(root), JSON.stringify(findings));
  } catch {

  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistPending: { findings: Finding[]; root: string | null } | null = null;
function flushPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (persistPending) {
    persist(persistPending.findings, persistPending.root);
    persistPending = null;
  }
}
function schedulePersist(findings: Finding[], root: string | null): void {
  persistPending = { findings, root };
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistPending) persist(persistPending.findings, persistPending.root);
    persistPending = null;
  }, 500);
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPersist);
}

interface FindingsState {
  findings: Finding[];

  projectRoot: string | null;

  add(finding: Omit<Finding, "id" | "at"> & { at?: number }): string;
  update(id: string, patch: Partial<Omit<Finding, "id">>): void;
  remove(id: string): void;
  clear(): void;

  loadProject(root: string | null): void;
}

const makeId = () => crypto.randomUUID();

export const useFindings = create<FindingsState>((set, get) => ({
  findings: load(null),
  projectRoot: null,

  add: (finding) => {
    const id = makeId();
    const entry: Finding = {
      id,
      title: finding.title || "Untitled finding",
      severity: finding.severity ?? "info",
      location: finding.location ?? "",
      detail: finding.detail ?? "",
      at: finding.at ?? Date.now(),
    };
    set((state) => {
      const findings = [entry, ...state.findings];
      schedulePersist(findings, get().projectRoot);
      return { findings };
    });
    return id;
  },

  update: (id, patch) =>
    set((state) => {
      const findings = state.findings.map((f) => (f.id === id ? { ...f, ...patch } : f));
      schedulePersist(findings, get().projectRoot);
      return { findings };
    }),

  remove: (id) =>
    set((state) => {
      const findings = state.findings.filter((f) => f.id !== id);
      schedulePersist(findings, get().projectRoot);
      return { findings };
    }),

  clear: () => {
    schedulePersist([], get().projectRoot);
    return set({ findings: [] });
  },

  loadProject: (root) => {

    flushPersist();
    set({ projectRoot: root, findings: load(root) });
  },
}));

export function subscribeFindingsProject(): () => void {
  useFindings.getState().loadProject(useWorkspace.getState().root);
  return useWorkspace.subscribe((state, prev) => {
    if (state.root !== prev.root) useFindings.getState().loadProject(state.root);
  });
}

export function findingsReport(findings: Finding[]): string {
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity] || b.at - a.at);
  const counts = SEVERITIES.map((s) => `${sorted.filter((f) => f.severity === s).length} ${s}`).join(" · ");

  const lines = ["# Findings", "", counts, ""];
  for (const finding of sorted) {
    lines.push(`## [${finding.severity.toUpperCase()}] ${finding.title}`);
    if (finding.location) lines.push(`**Location:** ${finding.location}`);
    lines.push("");
    if (finding.detail) {
      lines.push(finding.detail);
      lines.push("");
    }
  }
  return lines.join("\n");
}
