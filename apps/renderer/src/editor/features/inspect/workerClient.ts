import type { Diagnostic } from "@/lib/bridge";
import type { SerializedTextRule } from "./shared";

export interface FlowResult {
  security: Diagnostic[];
  inspection: Diagnostic[];
}

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, { resolve: (r: FlowResult) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
let queuedProjectRules: SerializedTextRule[] | null = null;

function rejectAll(reason: unknown) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(reason);
  }
  pending.clear();
}

function ensureWorker(): Worker | null {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; security: Diagnostic[]; inspection: Diagnostic[] }>) => {
      const { id, security, inspection } = e.data;
      const p = pending.get(id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(id);
        p.resolve({ security, inspection });
      }
    };
    worker.onerror = () => {

      failed = true;
      rejectAll(new Error("inspection worker error"));
      try {
        worker?.terminate();
      } catch {

      }
      worker = null;
    };
    if (queuedProjectRules) {
      worker.postMessage({ type: "projectRules", rules: queuedProjectRules });
      queuedProjectRules = null;
    }
  } catch {
    failed = true;
    worker = null;
  }
  return worker;
}

export function runFlow(docText: string, ext: string, securityOn: boolean): Promise<FlowResult> {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error("inspection worker unavailable"));
  const id = (seq += 1);
  return new Promise<FlowResult>((resolve, reject) => {

    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error("inspection worker timed out"));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, docText, ext, securityOn });
  });
}

export function setWorkerProjectRules(rules: SerializedTextRule[]): void {
  const w = ensureWorker();
  if (w) w.postMessage({ type: "projectRules", rules });
  else if (!failed) queuedProjectRules = rules;
}
