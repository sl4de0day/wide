import type { Node, PitcherRequest } from "@/stores/pitcher";

import { executeRequest } from "./execute";
import type { TestResult } from "./pm";

export interface RunItemResult {
  requestId: string;
  name: string;
  method: string;
  iteration: number;
  status: number;
  ok: boolean;
  ms: number;
  tests: TestResult[];
  error?: string;
}

export interface RunProgress {
  done: number;
  total: number;
  current: string;
}

export function flattenRequests(nodes: Node[]): PitcherRequest[] {
  const out: PitcherRequest[] = [];
  const walk = (ns: Node[]) => {
    for (const n of ns) {
      if (n.kind === "folder") walk(n.nodes);
      else out.push(n.request);
    }
  };
  walk(nodes);
  return out;
}

export function parseDataFile(text: string): Record<string, string>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      return Array.isArray(arr) ? arr.map((r) => coerceRow(r)) : [];
    } catch {
      return [];
    }
  }
  return parseCsv(trimmed);
}

function coerceRow(r: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (r && typeof r === "object") for (const [k, v] of Object.entries(r as Record<string, unknown>)) out[k] = String(v);
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export async function runCollection(
  requests: PitcherRequest[],
  iterations: number,
  data: Record<string, string>[],
  onProgress: (p: RunProgress) => void,
  shouldStop: () => boolean,
  onResult: (r: RunItemResult) => void,
): Promise<void> {
  const iters = data.length ? (iterations > 0 ? iterations : data.length) : Math.max(1, iterations);
  const total = iters * requests.length;
  let done = 0;
  for (let i = 0; i < iters; i += 1) {
    const extra = data.length ? data[i % data.length] : {};
    for (const req of requests) {
      if (shouldStop()) return;
      onProgress({ done, total, current: req.name });
      const out = await executeRequest(req, { extraVars: extra, iteration: i });
      onResult({
        requestId: req.id,
        name: req.name,
        method: req.method,
        iteration: i,
        status: out.resp.status ?? 0,
        ok: out.resp.ok,
        ms: out.resp.ms ?? 0,
        tests: out.tests,
        error: out.resp.ok ? out.scriptError : out.resp.error,
      });
      done += 1;
    }
  }
  onProgress({ done, total, current: "" });
}
