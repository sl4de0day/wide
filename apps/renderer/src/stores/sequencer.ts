import { create } from "zustand";

import { bridge } from "@/lib/bridge";
import { parseHttpMessage } from "@/lib/httpMessage";

export interface SeqStats {
  count: number;
  charset: number;
  fixedLength: number | null;
  perCharEntropy: number;
  effectiveBits: number;
  verdict: "strong" | "moderate" | "weak";
}

function extractorFor(rule: string): (reply: { headers?: [string, string][] }, raw: string) => string | null {
  const trimmed = rule.trim();
  if (trimmed && trimmed.toLowerCase() !== "auto") {
    let re: RegExp | null = null;
    try {
      re = new RegExp(trimmed);
    } catch {
      re = null;
    }
    return (_reply, raw) => {
      if (!re) return null;
      const m = raw.match(re);
      return m ? m[1] ?? m[0] : null;
    };
  }

  return (reply, raw) => {
    const sc = (reply.headers ?? []).find(([n]) => n.toLowerCase() === "set-cookie")?.[1];
    if (sc) {
      const eq = sc.indexOf("=");
      const semi = sc.indexOf(";");
      if (eq >= 0) return sc.slice(eq + 1, semi >= 0 ? semi : undefined).trim();
    }
    const m =
      raw.match(/name=["'][^"']*(?:csrf|token|nonce|session)[^"']*["'][^>]*\bvalue=["']([^"']+)["']/i) ||
      raw.match(/["'](?:csrf|token|nonce|sessionid)["']\s*:\s*["']([^"']+)["']/i);
    return m ? m[1] : null;
  };
}

function computeStats(tokens: string[]): SeqStats {
  const count = tokens.length;
  const concat = tokens.join("");
  const charset = new Set(concat.split("")).size;
  const freq: Record<string, number> = {};
  for (const c of concat) freq[c] = (freq[c] || 0) + 1;
  const N = concat.length || 1;
  let perChar = 0;
  for (const k in freq) {
    const p = freq[k] / N;
    perChar -= p * Math.log2(p);
  }
  const lengths = tokens.map((t) => t.length);
  const L0 = lengths[0] ?? 0;
  const fixedLength = count > 1 && lengths.every((l) => l === L0) ? L0 : null;
  let effectiveBits = perChar * (lengths.reduce((a, b) => a + b, 0) / (count || 1));
  if (fixedLength) {
    effectiveBits = 0;
    for (let i = 0; i < fixedLength; i += 1) {
      const f: Record<string, number> = {};
      for (const t of tokens) {
        const c = t[i];
        f[c] = (f[c] || 0) + 1;
      }
      let h = 0;
      for (const k in f) {
        const p = f[k] / count;
        h -= p * Math.log2(p);
      }
      effectiveBits += h;
    }
  }
  const verdict = effectiveBits >= 64 ? "strong" : effectiveBits >= 32 ? "moderate" : "weak";
  return { count, charset, fixedLength, perCharEntropy: perChar, effectiveBits, verdict };
}

interface SequencerState {
  seed: string;
  rule: string;
  tokens: string[];
  running: boolean;
  done: number;
  total: number;
  error: string;
  stats: SeqStats | null;
  _signal: { cancelled: boolean } | null;
  setSeed(v: string): void;
  setRule(v: string): void;
  run(count: number): void;
  stop(): void;
  clear(): void;
}

export const useSequencer = create<SequencerState>((set, get) => ({
  seed: "",
  rule: "auto",
  tokens: [],
  running: false,
  done: 0,
  total: 0,
  error: "",
  stats: null,
  _signal: null,

  setSeed: (v) => set({ seed: v }),
  setRule: (v) => set({ rule: v }),
  clear: () => set({ tokens: [], stats: null, done: 0, total: 0, error: "" }),
  stop: () => {
    const sig = get()._signal;
    if (sig) sig.cancelled = true;
    set({ running: false });
  },

  run: (count) => {
    if (get().running) return;
    const req = parseHttpMessage(get().seed);
    if (!req) {
      set({ error: "The request does not parse." });
      return;
    }
    const signal = { cancelled: false };
    set({ running: true, tokens: [], done: 0, total: count, error: "", stats: null, _signal: signal });
    const extract = extractorFor(get().rule);
    const conc = Math.max(1, Math.min(8, count));
    let next = 0;
    const worker = async () => {
      while (next < count && !signal.cancelled) {
        next += 1;
        try {
          const reply = await bridge.proxyReplay(req);
          if (reply.ok) {
            const raw = `HTTP ${reply.status ?? 0}\n${(reply.headers ?? []).map(([n, v]) => `${n}: ${v}`).join("\n")}\n\n${reply.body ?? ""}`;
            const tok = extract(reply, raw);
            if (tok) set((s) => ({ tokens: [...s.tokens, tok] }));
          }
        } catch {

        }
        set((s) => ({ done: s.done + 1 }));
      }
    };
    void Promise.all(Array.from({ length: conc }, () => worker())).then(() => {
      set((s) => ({ running: false, stats: s.tokens.length > 1 ? computeStats(s.tokens) : null }));
    });
  },
}));
