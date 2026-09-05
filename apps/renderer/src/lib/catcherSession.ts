import { bridge } from "@/lib/bridge";
import { repeaterSeeds } from "@/stores/editor";
import { useCatcher } from "@/stores/catcher";
import { useProxy } from "@/stores/proxy";
import { useScanner } from "@/stores/scanner";

const SESSION_DEBOUNCE_MS = 10000;

export const catcherSessionPath = (root: string): string => `${root}/.wide/catcher-session.json`;

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

function sessionSignature(): string {
  const proxy = useProxy.getState();
  const scanner = useScanner.getState();
  const last = proxy.entries[proxy.entries.length - 1];
  return [
    proxy.entries.length,
    last ? String(last.id) : "",
    proxy.scope.length,
    proxy.rules.length,
    scanner.issues.length,
  ].join(":");
}

export function installCatcherSession(root: string): () => void {
  let disposed = false;
  let loaded = false;
  let signature = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    if (disposed || !loaded) return;
    const next = sessionSignature();
    if (next === signature) return;
    signature = next;
    void bridge.catcherAutosaveWrite(root, exportCatcherSession());
  };

  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SESSION_DEBOUNCE_MS);
  };

  void bridge
    .catcherAutosaveRead(root)
    .then((saved) => {
      if (disposed) return;
      if (saved.ok && saved.json) importCatcherSession(saved.json);
    })
    .catch(() => undefined)
    .finally(() => {
      if (disposed) return;
      loaded = true;
      signature = sessionSignature();
    });

  const stopProxy = useProxy.subscribe(schedule);
  const stopScanner = useScanner.subscribe(schedule);
  const flush = () => save();
  window.addEventListener("beforeunload", flush);

  return () => {
    if (timer) clearTimeout(timer);
    save();
    disposed = true;
    stopProxy();
    stopScanner();
    window.removeEventListener("beforeunload", flush);
  };
}

export function importCatcherSession(json: string): boolean {
  try {
    const data = JSON.parse(json);
    if (!data || typeof data !== "object") return false;
    const scope = Array.isArray(data.scope) ? data.scope : useProxy.getState().scope;
    const rules = Array.isArray(data.rules) ? data.rules : useProxy.getState().rules;
    useProxy.setState({
      entries: Array.isArray(data.entries) ? data.entries : [],
      scope,
      rules,
      selected: null,
    });
    void bridge.proxyScope(scope);
    void bridge.proxyMatchReplace(rules);
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
