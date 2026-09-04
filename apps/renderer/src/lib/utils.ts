import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.append(scratch);
      scratch.select();
      const ok = document.execCommand("copy");
      scratch.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export const normalisePath = (path: string): string => path.split("\\").join("/");

export function basename(path: string): string {
  const norm = normalisePath(path);
  const cut = norm.lastIndexOf("/");
  return cut === -1 ? norm : norm.slice(cut + 1);
}

export function dirname(path: string): string {
  const norm = normalisePath(path);
  const cut = norm.lastIndexOf("/");
  return cut <= 0 ? "" : norm.slice(0, cut);
}

export function extname(path: string): string {
  const name = basename(path);
  const cut = name.lastIndexOf(".");
  return cut <= 0 ? "" : name.slice(cut + 1).toLowerCase();
}

const isBoundary = (char: string): boolean =>
  char === "/" || char === "\\" || char === "-" || char === "_" || char === "." || char === " ";

export function fuzzyScore(
  text: string,
  query: string,
): { score: number; positions: number[] } | null {
  if (!query) return { score: 0, positions: [] };
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let score = 0;
  let textIndex = 0;
  let previousMatch = -2;
  const positions: number[] = [];

  for (const wanted of needle) {
    const found = haystack.indexOf(wanted, textIndex);
    if (found === -1) return null;
    let step = 1;
    if (found === previousMatch + 1) step += 6;
    if (found === 0) step += 8;
    else if (isBoundary(haystack[found - 1]!)) step += 7;
    else if (text[found]! >= "A" && text[found]! <= "Z") step += 4;
    score += step;
    positions.push(found);
    previousMatch = found;
    textIndex = found + 1;
  }

  score -= Math.min(20, Math.floor((text.length - needle.length) / 6));
  return { score, positions };
}

export function fuzzyMatch(text: string, query: string): number[] | null {
  return fuzzyScore(text, query)?.positions ?? null;
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  toText: (item: T) => string,
): { item: T; positions: number[] }[] {
  if (!query) return items.map((item) => ({ item, positions: [] }));
  const scored: { item: T; positions: number[]; score: number }[] = [];
  for (const item of items) {
    const result = fuzzyScore(toText(item), query);
    if (result) scored.push({ item, positions: result.positions, score: result.score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ item, positions }) => ({ item, positions }));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** power;
  return `${power === 0 ? value : value.toFixed(1)} ${units[power]}`;
}
