import { repeaterSeeds } from "@/stores/editor";
import { useCatcher } from "@/stores/catcher";
import { useProxy } from "@/stores/proxy";
import { useScanner } from "@/stores/scanner";

export function exportCatcherSession(): string {
  const proxy = useProxy.getState();
  const scanner = useScanner.getState();
  const { repeaterIds } = useCatcher.getState();
  const repeaters = repeaterIds.map((id) => repeaterSeeds.get(id)).filter((seed): seed is NonNullable<typeof seed> => Boolean(seed));
  return JSON.stringify(
    {
      version: 2,
      savedAt: new Date().toISOString(),
      scope: proxy.scope,
      rules: proxy.rules,
      entries: proxy.entries,
      issues: scanner.issues,
      repeaters,
    },
    null,
    2,
  );
}

export function importCatcherSession(json: string): boolean {
  try {
    const data = JSON.parse(json);
    if (!data || typeof data !== "object") return false;
    useProxy.setState({
      entries: Array.isArray(data.entries) ? data.entries : [],
      scope: Array.isArray(data.scope) ? data.scope : useProxy.getState().scope,
      rules: Array.isArray(data.rules) ? data.rules : useProxy.getState().rules,
      selected: null,
    });
    if (Array.isArray(data.issues)) useScanner.setState({ issues: data.issues, selected: null });
    if (Array.isArray(data.repeaters)) {
      for (const seed of data.repeaters) {
        if (seed && typeof seed === "object" && typeof seed.method === "string") useCatcher.getState().addRepeater(seed);
      }
    }
    return true;
  } catch {
    return false;
  }
}
