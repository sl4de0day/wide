import { normalisePath } from "@/lib/utils";

const STORAGE_KEY = "wide.lastFile";

const MAX_PROJECTS = 40;

export interface Place {
  path: string;
  line: number;
  column: number;

  topLine: number;
}

type Remembered = Record<string, Place>;

function toPlace(value: unknown): Place | null {

  if (typeof value === "string") return { path: value, line: 1, column: 1, topLine: 1 };
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.path !== "string" || !entry.path) return null;
  const line = typeof entry.line === "number" && entry.line >= 1 ? Math.floor(entry.line) : 1;
  const column = typeof entry.column === "number" && entry.column >= 1 ? Math.floor(entry.column) : 1;
  const topLine =
    typeof entry.topLine === "number" && entry.topLine >= 1 ? Math.floor(entry.topLine) : 1;
  return { path: entry.path, line, column, topLine };
}

function load(): Remembered {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Remembered = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const place = toPlace(value);
      if (place) out[key] = place;
    }
    return out;
  } catch {

    return {};
  }
}

function save(value: Remembered): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {

  }
}

function write(root: string, place: Place): void {
  const key = normalisePath(root);
  const current = load();

  delete current[key];
  const next: Remembered = { ...current, [key]: place };
  const keys = Object.keys(next);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_PROJECTS))) {
    delete next[stale];
  }
  save(next);
}

export function rememberLastFile(root: string, filePath: string, line: number, column: number): void {
  const path = normalisePath(filePath);
  const previous = load()[normalisePath(root)];
  write(root, {
    path,
    line: Math.max(1, Math.floor(line)),
    column: Math.max(1, Math.floor(column)),
    topLine: previous?.path === path ? previous.topLine : 1,
  });
}

export function rememberScroll(root: string, filePath: string, topLine: number): void {
  const path = normalisePath(filePath);
  const previous = load()[normalisePath(root)];

  if (previous && previous.path !== path) return;
  write(root, {
    path,
    line: previous?.line ?? 1,
    column: previous?.column ?? 1,
    topLine: Math.max(1, Math.floor(topLine)),
  });
}

export function recallLastFile(root: string): Place | null {
  const key = normalisePath(root);
  const remembered = load()[key];
  if (!remembered) return null;
  return remembered.path.startsWith(`${key}/`) ? remembered : null;
}

export function forgetLastFile(root: string): void {
  const key = normalisePath(root);
  const current = load();
  if (!(key in current)) return;
  delete current[key];
  save(current);
}
