import { create } from "zustand";

import { enumerateInsertionPoints } from "@/components/http/Inspector";
import { crawl } from "@/lib/activeScan/crawler";
import { runScan, type ScanIssue } from "@/lib/activeScan/runner";

import { useFindings } from "./findings";
import { useOast } from "./oast";

export interface ScanTask {
  id: string;
  target: string;
  requestText: string;
  status: "running" | "done" | "cancelled";
  done: number;
  total: number;
  issueCount: number;
  signal: { cancelled: boolean };
  startedAt: number;
}

interface ScannerState {
  tasks: ScanTask[];
  issues: ScanIssue[];
  selected: string | null;
  scan(requestText: string): void;

  crawlScan(seedUrl: string): void;
  cancel(taskId: string): void;
  cancelAll(): void;
  clear(): void;
  select(id: string | null): void;

  session: string;
  setSession(text: string): void;
}

let taskSeq = 0;

const SESSION_KEY = "wide.scanner.session";
function loadSession(): string {
  try {
    return localStorage.getItem(SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}
function parseSession(text: string): [string, string][] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(":");
      return i === -1 ? null : ([l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string]);
    })
    .filter((p): p is [string, string] => Boolean(p && p[0]));
}

function labelFor(requestText: string): string {
  const first = requestText.split("\n")[0] ?? "";
  const m = first.match(/^([A-Z]+)\s+(\S+)/);
  if (!m) return first.slice(0, 60);
  try {
    const u = new URL(m[2]);
    return `${m[1]} ${u.host}${u.pathname}`;
  } catch {
    return `${m[1]} ${m[2]}`;
  }
}

export const useScanner = create<ScannerState>((set, get) => ({
  tasks: [],
  issues: [],
  selected: null,
  session: loadSession(),

  setSession: (text) => {
    try {
      localStorage.setItem(SESSION_KEY, text);
    } catch {
      void 0;
    }
    set({ session: text });
  },

  scan: (requestText) => {
    const id = `t${(taskSeq += 1)}`;
    const signal = { cancelled: false };
    const task: ScanTask = {
      id,
      target: labelFor(requestText),
      requestText,
      status: "running",
      done: 0,
      total: 0,
      issueCount: 0,
      signal,
      startedAt: Date.now(),
    };
    set((s) => ({ tasks: [task, ...s.tasks] }));

    const oastHook = useOast.getState().running
      ? {
          running: true,
          newPayload: () => useOast.getState().newPayload(),
          onInteraction: (cb: (raw: string) => void) =>
            useOast.subscribe((s, p) => {
              if (s.interactions !== p.interactions && s.interactions[0]) cb(JSON.stringify(s.interactions[0]));
            }),
        }
      : undefined;
    void runScan(
      requestText,
      {
        signal,
        sessionHeaders: parseSession(get().session),
        onProgress: (done, total) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done, total } : t)) })),
        onIssue: (issue) => {
          set((s) => ({
            issues: [issue, ...s.issues],
            tasks: s.tasks.map((t) => (t.id === id ? { ...t, issueCount: t.issueCount + 1 } : t)),
          }));
          useFindings.getState().add({
            title: `${issue.name} — ${issue.point}`,
            severity: issue.severity,
            location: issue.url,
            detail: `${issue.evidence}${issue.cwe ? ` [${issue.cwe}]` : ""}\n\n${issue.request}`,
          });
        },
      },
      oastHook,
    ).then(() =>
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, status: t.signal.cancelled ? "cancelled" : "done" } : t)) })),
    );
  },

  crawlScan: (seedUrl) => {
    const id = `t${(taskSeq += 1)}`;
    const signal = { cancelled: false };
    let host = seedUrl;
    try {
      host = new URL(seedUrl).host;
    } catch {

    }
    const task: ScanTask = { id, target: `Crawl ${host}`, requestText: seedUrl, status: "running", done: 0, total: 60, issueCount: 0, signal, startedAt: Date.now() };
    set((s) => ({ tasks: [task, ...s.tasks] }));
    void crawl(seedUrl, {
      signal,
      sessionHeaders: parseSession(get().session),
      onProgress: (visited, queued) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: visited, total: Math.max(visited + queued, visited) } : t)) })),
    }).then((found) => {
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, status: t.signal.cancelled ? "cancelled" : "done" } : t)) }));
      if (signal.cancelled) return;
      const seen = new Set<string>();
      let scanned = 0;
      for (const reqText of found) {
        if (scanned >= 25) break;
        if (enumerateInsertionPoints(reqText).length === 0) continue;
        const line = reqText.split("\n")[0]?.split(" ")[1] ?? "";
        let sig = line;
        try {
          const u = new URL(line);
          sig = `${u.host}${u.pathname}?${[...u.searchParams.keys()].sort().join(",")}`;
        } catch {

        }
        if (seen.has(sig)) continue;
        seen.add(sig);
        get().scan(reqText);
        scanned += 1;
      }
    });
  },

  cancel: (taskId) => {
    const t = get().tasks.find((x) => x.id === taskId);
    if (t) t.signal.cancelled = true;
    set((s) => ({ tasks: s.tasks.map((x) => (x.id === taskId ? { ...x, status: "cancelled" } : x)) }));
  },

  cancelAll: () => {
    for (const t of get().tasks) t.signal.cancelled = true;
    set((s) => ({ tasks: s.tasks.map((t) => (t.status === "running" ? { ...t, status: "cancelled" } : t)) }));
  },

  clear: () => {
    get().cancelAll();
    set({ tasks: [], issues: [], selected: null });
  },

  select: (id) => set({ selected: id }),
}));
