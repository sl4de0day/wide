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

export function findingsReportHtml(findings: Finding[], title = "Wide Findings Report"): string {
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity] || b.at - a.at);
  const colours: Record<Severity, string> = { critical: "#b3261e", high: "#c8641a", medium: "#b8860b", low: "#3a7bd5", info: "#5f6b7a" };
  const esc = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const counts = SEVERITIES.map((s) => ({ s, n: sorted.filter((f) => f.severity === s).length })).filter((c) => c.n > 0);
  const generated = new Date().toISOString().replace("T", " ").slice(0, 19);

  const summary = counts
    .map((c) => `<span class="pill" style="background:${colours[c.s]}">${c.n} ${c.s}</span>`)
    .join(" ");

  const rows = sorted
    .map(
      (f) => `<section class="finding">
      <h2><span class="badge" style="background:${colours[f.severity]}">${esc(f.severity.toUpperCase())}</span> ${esc(f.title)}</h2>
      ${f.location ? `<p class="loc">${esc(f.location)}</p>` : ""}
      ${f.detail ? `<pre>${esc(f.detail)}</pre>` : ""}
    </section>`,
    )
    .join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#1b1f24}
@media (prefers-color-scheme:dark){body{background:#161a1f;color:#e6e9ee}.finding{background:#1e242b;border-color:#2b333c}pre{background:#12161b}}
header{padding:28px 32px;border-bottom:1px solid #d8dde3}
h1{margin:0 0 6px;font-size:22px}
.meta{color:#6b7480;font-size:12px}
.summary{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap}
.pill,.badge{color:#fff;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600}
main{padding:20px 32px;max-width:1000px}
.finding{background:#fff;border:1px solid #e2e6ea;border-radius:8px;padding:14px 16px;margin:0 0 12px}
.finding h2{margin:0 0 6px;font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}
.badge{border-radius:4px;font-size:10px;letter-spacing:.5px;padding:2px 6px}
.loc{margin:0 0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#6b7480;word-break:break-all}
pre{margin:0;white-space:pre-wrap;word-break:break-word;background:#f0f2f5;border-radius:6px;padding:10px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.empty{color:#6b7480;padding:20px 0}
</style></head><body>
<header>
  <h1>${esc(title)}</h1>
  <div class="meta">${sorted.length} finding${sorted.length === 1 ? "" : "s"} · generated ${esc(generated)}</div>
  <div class="summary">${summary || '<span class="pill" style="background:#5f6b7a">0 findings</span>'}</div>
</header>
<main>
${rows || '<p class="empty">No findings.</p>'}
</main>
</body></html>`;
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
