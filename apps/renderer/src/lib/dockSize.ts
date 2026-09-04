

export function loadDockSize(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function saveDockSize(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {

  }
}
