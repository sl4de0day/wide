import { create } from "zustand";

import { t } from "@/lib/i18n";

const WINDOW_MS = 30 * 60 * 1000;
const MAX_EVENTS = 200;
const CURSOR_TRAIL = 3;

export type SessionEvent =
  | { kind: "caret"; path: string; line: number; at?: number }
  | { kind: "open"; path: string; at?: number }
  | { kind: "save"; path: string; at?: number };

export interface TrailEntry {
  path: string;
  line: number;
  at: number;
}

export interface Resume {
  awayMs: number;
  summary: string;
}

interface SessionState {
  events: (SessionEvent & { at: number })[];

  trail: TrailEntry[];
  scratchpad: { note: string; at: number } | null;
  awayAt: number | null;
  resume: Resume | null;

  record(event: SessionEvent): void;
  setScratchpad(note: string): void;
  markAway(): void;
  markBack(minAwayMs?: number): void;
  dismissResume(): void;
  wipe(): void;
}

const isFresh = (at: number, now: number) => now - at <= WINDOW_MS;

function prune(events: (SessionEvent & { at: number })[]) {
  const now = Date.now();
  const fresh = events.filter((event) => isFresh(event.at, now));
  return fresh.length > MAX_EVENTS ? fresh.slice(fresh.length - MAX_EVENTS) : fresh;
}

function summarise(state: SessionState): string {
  const head = state.trail[0];
  if (head) {
    const name = head.path.split("/").pop() ?? head.path;
    return t("You were in {name}, line {line}.", { name, line: head.line });
  }
  return t("Nothing was open when you stepped away.");
}

export const useSession = create<SessionState>((set, get) => ({
  events: [],
  trail: [],
  scratchpad: null,
  awayAt: null,
  resume: null,

  record: (event) =>
    set((state) => {
      const entry = { at: Date.now(), ...event };
      const events = prune([...state.events, entry]);
      if (event.kind !== "caret") return { events };
      const head = state.trail[0];

      if (head && head.path === event.path && head.line === event.line) {
        return {
          events,
          trail: [{ ...head, at: entry.at }, ...state.trail.slice(1)],
        };
      }
      return {
        events,
        trail: [{ path: event.path, line: event.line, at: entry.at }, ...state.trail].slice(
          0,
          CURSOR_TRAIL,
        ),
      };
    }),

  setScratchpad: (note) =>
    set({ scratchpad: note?.trim() ? { note: note.trim(), at: Date.now() } : null }),

  markAway: () => set({ awayAt: Date.now() }),

  markBack: (minAwayMs = 90_000) => {
    const { awayAt } = get();
    set({ awayAt: null });
    if (!awayAt || Date.now() - awayAt < minAwayMs) return;
    set({ resume: { awayMs: Date.now() - awayAt, summary: summarise(get()) } });
  },

  dismissResume: () => set({ resume: null }),

  wipe: () => set({ events: [], trail: [], scratchpad: null, awayAt: null, resume: null }),
}));
