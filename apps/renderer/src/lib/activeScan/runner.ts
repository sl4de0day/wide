import { enumerateInsertionPoints } from "@/components/http/Inspector";
import { bridge } from "@/lib/bridge";
import { parseHttpMessage, setHeader } from "@/lib/httpMessage";
import type { Severity } from "@/stores/findings";

import { BLIND_PROBES } from "./blindProbes";
import { mutateRequest } from "./mutate";
import { CORS_PROBE, PROBES } from "./probes";

export interface ScanIssue {
  id: string;
  probeId: string;
  name: string;
  severity: Severity;
  cwe?: string;
  point: string;
  evidence: string;
  request: string;
  status: number;
  url: string;
}

export interface OastHook {
  running: boolean;
  newPayload(): { id: string; host: string };
  onInteraction(cb: (raw: string) => void): () => void;
}

export interface ScanControls {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  onIssue?: (issue: ScanIssue) => void;
  signal?: { cancelled: boolean };
  sessionHeaders?: [string, string][];
}

export function applySessionHeaders(requestText: string, session: [string, string][]): string {
  if (!session.length) return requestText;
  const nl = requestText.includes("\r\n") ? "\r\n" : "\n";
  const parts = requestText.split(/\r?\n/);
  let sep = parts.length;
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i].trim() === "") {
      sep = i;
      break;
    }
  }
  const headerLines = parts.slice(1, sep);
  const rest = parts.slice(sep);
  const wanted = new Map(session.map(([k, v]) => [k.toLowerCase(), v]));
  const used = new Set<string>();
  const out: string[] = [];
  for (const line of headerLines) {
    const m = /^([^:]+):/.exec(line);
    const key = m ? m[1].trim().toLowerCase() : "";
    if (key && wanted.has(key)) {
      out.push(`${m![1].trim()}: ${wanted.get(key)}`);
      used.add(key);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of session) if (!used.has(k.toLowerCase())) out.push(`${k}: ${v}`);
  return [parts[0], ...out, ...rest].join(nl);
}

let issueSeq = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScan(rawRequest: string, controls: ScanControls = {}, oast?: OastHook): Promise<ScanIssue[]> {
  const requestText = applySessionHeaders(rawRequest, controls.sessionHeaders ?? []);
  const base = parseHttpMessage(requestText);
  if (!base) return [];
  const points = enumerateInsertionPoints(requestText);

  const baseReply = await bridge.proxyReplay(base);
  const baseline = {
    body: baseReply.ok ? baseReply.body ?? "" : "",
    status: baseReply.ok ? baseReply.status ?? 0 : 0,
    headers: baseReply.ok ? baseReply.headers ?? [] : [],
  };

  const tasks: {
    pointKind: (typeof points)[number]["kind"];
    pointName: string;
    probeId: string;
    probeName: string;
    severity: Severity;
    cwe?: string;
    send: string;
    detect: (c: { body: string; status: number; headers: [string, string][]; baseline: typeof baseline }) => { snippet: string } | null;
  }[] = [];
  for (const point of points) {
    for (const probe of PROBES) {
      if (probe.points !== "all" && !probe.points.includes(point.kind)) continue;
      for (const scase of probe.cases(point.value)) {
        tasks.push({
          pointKind: point.kind,
          pointName: point.name,
          probeId: probe.id,
          probeName: probe.name,
          severity: probe.severity,
          cwe: probe.cwe,
          send: scase.send,
          detect: scase.detect,
        });
      }
    }
  }

  const conc = Math.max(1, Math.min(16, controls.concurrency ?? 6));
  let total = tasks.length + 3;
  let done = 0;
  const issues: ScanIssue[] = [];
  const hitKeys = new Set<string>();
  const emit = (issue: ScanIssue) => {
    issues.push(issue);
    controls.onIssue?.(issue);
  };
  const tick = () => {
    done += 1;
    controls.onProgress?.(done, total);
  };

  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      if (controls.signal?.cancelled) return;
      const task = tasks[next++];
      const key = `${task.probeId}:${task.pointKind}:${task.pointName}`;
      if (hitKeys.has(key)) {
        tick();
        continue;
      }
      const mutated = mutateRequest(requestText, task.pointKind, task.pointName, task.send);
      const req = mutated ? parseHttpMessage(mutated) : null;
      if (req) {
        try {
          const reply = await bridge.proxyReplay(req);
          const ctx = {
            body: reply.ok ? reply.body ?? "" : "",
            status: reply.ok ? reply.status ?? 0 : 0,
            headers: reply.ok ? reply.headers ?? [] : [],
            baseline,
          };
          const ev = task.detect(ctx);
          if (ev && !hitKeys.has(key)) {
            hitKeys.add(key);
            emit({
              id: `i${(issueSeq += 1)}`,
              probeId: task.probeId,
              name: task.probeName,
              severity: task.severity,
              cwe: task.cwe,
              point: `${task.pointKind}:${task.pointName}`,
              evidence: ev.snippet,
              request: mutated ?? requestText,
              status: ctx.status,
              url: base.url,
            });
          }
        } catch {

        }
      }
      tick();
    }
  };
  await Promise.all(Array.from({ length: conc }, () => worker()));

  if (!controls.signal?.cancelled) {
    try {
      const reply = await bridge.proxyReplay({ ...base, headers: setHeader(base.headers, "Origin", CORS_PROBE.origin) });
      if (reply.ok) {
        const ev = CORS_PROBE.detect(reply.headers ?? []);
        if (ev) emitOne(CORS_PROBE.id, CORS_PROBE.name, CORS_PROBE.severity, CORS_PROBE.cwe, "header:Origin", ev.snippet, requestText, reply.status ?? 0);
      }
    } catch {

    }
  }
  tick();

  if (!controls.signal?.cancelled) {
    try {
      const marker = `wivhost${Math.random().toString(36).slice(2, 7)}.example`;
      const headers = setHeader(setHeader(base.headers, "X-Forwarded-Host", marker), "X-Host", marker);
      const reply = await bridge.proxyReplay({ ...base, headers });
      if (reply.ok) {
        const loc = (reply.headers ?? []).find(([n]) => n.toLowerCase() === "location")?.[1] ?? "";
        if (loc.includes(marker) || (reply.body ?? "").includes(marker)) {
          emitOne("host-header", "Host header injection", "medium", "CWE-644", "header:X-Forwarded-Host", `reflected: ${marker}`, requestText, reply.status ?? 0);
        }
      }
    } catch {

    }
  }
  tick();

  if (!controls.signal?.cancelled && /graphql/i.test(base.url)) {
    try {
      const body = JSON.stringify({ query: "{__schema{queryType{name}}}" });
      const reply = await bridge.proxyReplay({ ...base, method: "POST", headers: setHeader(base.headers, "Content-Type", "application/json"), body });
      if (reply.ok && /"__schema"|"queryType"|"types"\s*:/.test(reply.body ?? "")) {
        emitOne("graphql-introspection", "GraphQL introspection enabled", "medium", "CWE-200", "endpoint", "__schema is queryable", requestText, reply.status ?? 0);
      }
    } catch {

    }
  }
  tick();

  if (oast?.running && !controls.signal?.cancelled) {
    const candidates = new Map<string, ScanIssue>();
    const off = oast.onInteraction((raw) => {
      for (const [id, issue] of candidates) {
        if (raw.includes(id)) {
          candidates.delete(id);
          emit(issue);
        }
      }
    });

    const blindTasks: { point: (typeof points)[number]; probe: (typeof BLIND_PROBES)[number]; id: string; host: string; payloads: string[] }[] = [];
    for (const point of points) {
      for (const probe of BLIND_PROBES) {
        if (probe.points !== "all" && !probe.points.includes(point.kind)) continue;
        const { id, host } = oast.newPayload();
        if (!host) continue;
        blindTasks.push({ point, probe, id, host, payloads: probe.payloads(host) });
      }
    }
    total += blindTasks.length;

    let bnext = 0;
    const bworker = async () => {
      while (bnext < blindTasks.length) {
        if (controls.signal?.cancelled) return;
        const task = blindTasks[bnext++];

        candidates.set(task.id, {
          id: `i${(issueSeq += 1)}`,
          probeId: task.probe.id,
          name: task.probe.name,
          severity: task.probe.severity,
          cwe: task.probe.cwe,
          point: `${task.point.kind}:${task.point.name}`,
          evidence: `Out-of-band callback to ${task.host}`,
          request: requestText,
          status: 0,
          url: base.url,
        });
        for (const payload of task.payloads) {
          if (controls.signal?.cancelled) break;
          const mutated = mutateRequest(requestText, task.point.kind, task.point.name, payload);
          const req = mutated ? parseHttpMessage(mutated) : null;
          if (req) {
            try {
              await bridge.proxyReplay(req);
            } catch {

            }
          }
        }
        tick();
      }
    };
    await Promise.all(Array.from({ length: conc }, () => bworker()));

    const graceMs = 15000;
    const step = 500;
    for (let waited = 0; waited < graceMs && !controls.signal?.cancelled && candidates.size > 0; waited += step) {
      await sleep(step);
    }
    off();
  }

  return issues;

  function emitOne(probeId: string, name: string, severity: Severity, cwe: string | undefined, point: string, evidence: string, request: string, status: number) {
    emit({ id: `i${(issueSeq += 1)}`, probeId, name, severity, cwe, point, evidence, request, status, url: base!.url });
  }
}
