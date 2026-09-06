import { ArrowDownUp, ChevronDown, ChevronRight, Crosshair, Play, Plus, Repeat2, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { parseHttpMessage } from "@/lib/httpMessage";
import { useT } from "@/lib/i18n";
import {
  applyProcessors,
  ENCODE_LABELS,
  numberRange,
  PRESETS,
  type EncodeKind,
  type PayloadRule,
} from "@/lib/payloads";
import { cn } from "@/lib/utils";
import { useCatcher } from "@/stores/catcher";
import { useComparer } from "@/stores/comparer";
import { useDecoder } from "@/stores/decoder";
import { useIntruder } from "@/stores/intruder";

interface Row {
  index: number;
  payload: string;
  request: string;
  status: number;
  length: number;
  ms: number;
  body: string;
  headers: [string, string][];
  error: boolean;
  grepHits: boolean[];
  extracted: string;
}

function countPositions(template: string): number {
  return (template.match(/§[^§]*§/g) ?? []).length;
}

function substitute(template: string, payloads: string[]): string {
  let out = "";
  let rest = template;
  let i = 0;
  for (;;) {
    const open = rest.indexOf("§");
    if (open === -1) {
      out += rest;
      break;
    }
    const close = rest.indexOf("§", open + 1);
    if (close === -1) {
      out += rest;
      break;
    }
    out += rest.slice(0, open) + (payloads[i] ?? "");
    rest = rest.slice(close + 1);
    i += 1;
  }
  return out;
}

type Mode = "sniper" | "ram" | "pitchfork" | "cluster";
const CLUSTER_CAP = 5000;
const splitLines = (text: string) => text.split("\n").filter((line) => line.length > 0);

function buildJobs(mode: Mode, positions: number, wordlists: string[]): { payloads: string[]; label: string }[] {
  if (positions === 0) return [];
  const lists = wordlists.map(splitLines);
  if (mode === "sniper") {
    const list = lists[0] ?? [];
    const jobs: { payloads: string[]; label: string }[] = [];
    for (let p = 0; p < positions; p += 1)
      for (const w of list) {
        const payloads = Array(positions).fill("");
        payloads[p] = w;
        jobs.push({ payloads, label: positions > 1 ? `#${p + 1}: ${w}` : w });
      }
    return jobs;
  }
  if (mode === "ram") {
    return (lists[0] ?? []).map((w) => ({ payloads: Array(positions).fill(w), label: w }));
  }
  if (mode === "pitchfork") {
    const used = lists.slice(0, positions).map((l) => l ?? []);
    const n = Math.min(...used.map((l) => l.length), Infinity);
    const jobs: { payloads: string[]; label: string }[] = [];
    for (let i = 0; i < (Number.isFinite(n) ? n : 0); i += 1) {
      const payloads = used.map((l) => l[i] ?? "");
      jobs.push({ payloads, label: payloads.join(" | ") });
    }
    return jobs;
  }
  let combos: string[][] = [[]];
  for (let p = 0; p < positions; p += 1) {
    const list = lists[p] ?? [];
    const next: string[][] = [];
    for (const combo of combos)
      for (const w of list) {
        next.push([...combo, w]);
        if (next.length >= CLUSTER_CAP) break;
      }
    combos = next;
    if (combos.length >= CLUSTER_CAP) break;
  }
  return combos.map((payloads) => ({ payloads, label: payloads.join(" | ") }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ruleSeq = 0;
const freshRuleId = () => `r${(ruleSeq += 1)}`;

function Fold({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border-b border-line">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wide text-fg-faint hover:text-fg">
        {open ? <ChevronDown className="size-3" strokeWidth={2} /> : <ChevronRight className="size-3" strokeWidth={2} />}
        {title}
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

const smallInput = "rounded-sm border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint";

function RuleRow({ rule, onChange, onRemove }: { rule: PayloadRule; onChange: (r: PayloadRule) => void; onRemove: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1 py-0.5">
      <span className="w-16 shrink-0 text-[10px] text-fg-faint">
        {t(
          rule.type === "prefix" ? "Prefix"
          : rule.type === "suffix" ? "Suffix"
          : rule.type === "case" ? "Case"
          : rule.type === "encode" ? "Encode"
          : rule.type === "hash" ? "Hash"
          : rule.type === "arith" ? "Arithmetic"
          : rule.type === "substring" ? "Substring"
          : rule.type === "reverse" ? "Reverse"
          : rule.type === "replace" ? "Replace"
          : "Skip if",
        )}
      </span>
      {(rule.type === "prefix" || rule.type === "suffix") && (
        <input value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })} placeholder={t("text")} className={cn(smallInput, "flex-1")} />
      )}
      {rule.type === "case" && (
        <select value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value as "upper" | "lower" })} className={cn(smallInput, "flex-1")}>
          <option value="upper">{t("UPPER")}</option>
          <option value="lower">{t("lower")}</option>
        </select>
      )}
      {rule.type === "encode" && (
        <select value={rule.kind} onChange={(e) => onChange({ ...rule, kind: e.target.value as EncodeKind })} className={cn(smallInput, "flex-1")}>
          {(Object.keys(ENCODE_LABELS) as EncodeKind[]).map((k) => (
            <option key={k} value={k}>
              {ENCODE_LABELS[k]}
            </option>
          ))}
        </select>
      )}
      {rule.type === "hash" && <span className="flex-1 text-[10px] text-fg-faint">MD5</span>}
      {rule.type === "reverse" && <span className="flex-1 text-[10px] text-fg-faint">{t("reverses the payload")}</span>}
      {rule.type === "arith" && (
        <>
          <select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as "add" | "sub" })} className={cn(smallInput, "w-16")}>
            <option value="add">+</option>
            <option value="sub">-</option>
          </select>
          <input value={rule.amount} onChange={(e) => onChange({ ...rule, amount: e.target.value })} placeholder={t("amount")} className={cn(smallInput, "flex-1")} />
        </>
      )}
      {rule.type === "substring" && (
        <>
          <input value={rule.start} onChange={(e) => onChange({ ...rule, start: e.target.value })} placeholder={t("start")} className={cn(smallInput, "flex-1")} />
          <input value={rule.length} onChange={(e) => onChange({ ...rule, length: e.target.value })} placeholder={t("length")} className={cn(smallInput, "flex-1")} />
        </>
      )}
      {(rule.type === "replace" || rule.type === "skip") && (
        <input value={rule.match} onChange={(e) => onChange({ ...rule, match: e.target.value })} placeholder={t("match")} className={cn(smallInput, "flex-1")} />
      )}
      {rule.type === "replace" && (
        <input value={rule.replace} onChange={(e) => onChange({ ...rule, replace: e.target.value })} placeholder={t("with")} className={cn(smallInput, "flex-1")} />
      )}
      {(rule.type === "replace" || rule.type === "skip") && (
        <label className="flex items-center gap-0.5 text-[10px] text-fg-faint">
          <input type="checkbox" checked={rule.regex} onChange={(e) => onChange({ ...rule, regex: e.target.checked })} />
          {t("regex")}
        </label>
      )}
      <button type="button" onClick={onRemove} className="rounded-sm p-0.5 text-fg-faint hover:text-status-error" aria-label={t("Remove")}>
        <X className="size-3" strokeWidth={2} />
      </button>
    </div>
  );
}

export function IntruderView() {
  const t = useT();
  const seed = useIntruder((state) => state.seed);
  const [template, setTemplate] = useState("");
  const [wordlists, setWordlists] = useState<string[]>([""]);
  const [mode, setMode] = useState<Mode>("sniper");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [chosen, setChosen] = useState<Row | null>(null);
  const [sortCol, setSortCol] = useState<"index" | "status" | "length" | "ms" | "extract">("index");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [processors, setProcessors] = useState<PayloadRule[]>([]);
  const [grepText, setGrepText] = useState("");
  const [grepExtract, setGrepExtract] = useState("");
  const [filterText, setFilterText] = useState("");
  const [onlyHits, setOnlyHits] = useState(false);
  const [concurrency, setConcurrency] = useState(8);
  const [delayMs, setDelayMs] = useState(0);
  const [useSession, setUseSession] = useState(false);
  const [openFold, setOpenFold] = useState<string | null>(null);
  const [rangeFrom, setRangeFrom] = useState("0");
  const [rangeTo, setRangeTo] = useState("100");
  const stop = useRef(false);

  useEffect(() => {
    setTemplate(seed);
    setRows([]);
    setChosen(null);
    setDone(0);
  }, [seed]);

  const positions = useMemo(() => countPositions(template), [template]);
  const marked = positions > 0;
  const listCount = mode === "sniper" || mode === "ram" ? 1 : Math.max(1, positions);
  const jobs = useMemo(() => buildJobs(mode, positions, wordlists), [mode, positions, wordlists]);
  const grepPhrases = useMemo(() => grepText.split("\n").map((s) => s.trim()).filter(Boolean), [grepText]);
  const setWordlistAt = (i: number, value: string) =>
    setWordlists((current) => {
      const next = [...current];
      next[i] = value;
      return next;
    });

  const view = useMemo(() => {
    let list = rows;
    if (filterText) {
      const f = filterText.toLowerCase();
      list = list.filter(
        (r) => r.payload.toLowerCase().includes(f) || String(r.status).includes(f) || r.extracted.toLowerCase().includes(f),
      );
    }
    if (onlyHits) list = list.filter((r) => r.grepHits.some(Boolean));
    const copy = [...list];
    copy.sort((a, b) => {
      let d = 0;
      if (sortCol === "index") d = a.index - b.index;
      else if (sortCol === "extract") d = a.extracted.localeCompare(b.extracted);
      else d = (a[sortCol] as number) - (b[sortCol] as number);
      return sortDir === "asc" ? d : -d;
    });
    return copy;
  }, [rows, filterText, onlyHits, sortCol, sortDir]);

  const attack = async () => {
    if (!marked || jobs.length === 0 || running) return;
    setRunning(true);
    setRows([]);
    setChosen(null);
    setDone(0);
    stop.current = false;
    const phrases = grepPhrases;
    let extractRe: RegExp | null = null;
    if (grepExtract) {
      try {
        extractRe = new RegExp(grepExtract);
      } catch {
        extractRe = null;
      }
    }

    let next = 0;
    const worker = async () => {
      while (next < jobs.length && !stop.current) {
        const index = next++;
        const processed = jobs[index].payloads.map((p) => applyProcessors(p, processors));
        if (processed.some((p) => p === null)) {
          setDone((d) => d + 1);
          continue;
        }
        const requestText = substitute(template, processed as string[]);
        const request = parseHttpMessage(requestText);
        if (request) {
          try {
            const reply = await bridge.proxyReplay(request, { session: useSession });
            const body = reply.ok ? reply.body ?? "" : "";
            const extracted = extractRe ? (body.match(extractRe)?.[1] ?? body.match(extractRe)?.[0] ?? "") : "";
            setRows((current) => [
              ...current,
              {
                index,
                payload: jobs[index].label,
                request: requestText,
                status: reply.ok ? reply.status ?? 0 : 0,
                length: reply.ok ? reply.bytes ?? body.length : 0,
                ms: reply.ok ? reply.ms ?? 0 : 0,
                body,
                headers: reply.ok ? reply.headers ?? [] : [],
                error: !reply.ok,
                grepHits: phrases.map((ph) => body.includes(ph)),
                extracted,
              },
            ]);
          } catch {
            setRows((current) => [
              ...current,
              { index, payload: jobs[index].label, request: requestText, status: 0, length: 0, ms: 0, body: "", headers: [], error: true, grepHits: phrases.map(() => false), extracted: "" },
            ]);
          }
        }
        setDone((d) => d + 1);
        if (delayMs > 0) await sleep(delayMs);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(32, concurrency)) }, () => worker()));
    setRunning(false);
  };

  const total = jobs.length;
  const statusTone = (status: number) =>
    status >= 500 || status === 0 ? "text-status-error" : status >= 400 ? "text-amber-400" : status >= 300 ? "text-fg-faint" : "text-emerald-400";
  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  };
  const sendRowToRepeater = (row: Row) => {
    const parsed = parseHttpMessage(row.request);
    if (parsed) useCatcher.getState().addRepeater(parsed);
  };
  const addRule = (type: PayloadRule["type"]) => {
    const base = { id: freshRuleId() };
    const rule: PayloadRule =
      type === "prefix" || type === "suffix"
        ? { ...base, type, value: "" }
        : type === "case"
          ? { ...base, type, value: "upper" }
          : type === "encode"
            ? { ...base, type, kind: "url" }
            : type === "hash"
              ? { ...base, type, algo: "md5" }
              : type === "arith"
                ? { ...base, type, op: "add", amount: "1" }
                : type === "substring"
                  ? { ...base, type, start: "0", length: "" }
                  : type === "reverse"
                    ? { ...base, type }
                    : type === "replace"
                      ? { ...base, type, match: "", replace: "", regex: false }
                      : { ...base, type: "skip", match: "", regex: false };
    setProcessors((p) => [...p, rule]);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Crosshair className="size-4 shrink-0 text-fg-faint" strokeWidth={1.75} />
        <span className="flex-1 text-[12px] font-medium text-fg">{t("Intruder")}</span>
        <span className="text-[11px] text-fg-faint">{running || done > 0 ? `${done}/${total}` : `${total} ${t("requests")}`}</span>
      </div>

      <div className="grid min-h-0 shrink-0 grid-cols-2 gap-2 border-b border-line p-2">
        <div className="flex min-h-0 flex-col">
          <span className="pb-1 text-[10px] uppercase tracking-wide text-fg-faint">{t("Request — mark the payload with §…§")}</span>
          <textarea
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
            spellCheck={false}
            rows={8}
            className="w-full flex-1 resize-y rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg outline-none focus:border-accent"
          />
        </div>
        <div className="flex min-h-0 flex-col gap-1">
          <div className="flex items-center gap-1">
            {(["sniper", "ram", "pitchfork", "cluster"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                title={
                  m === "sniper" ? t("Sniper — sweep each position with one list")
                  : m === "ram" ? t("Battering ram — the same payload in every position")
                  : m === "pitchfork" ? t("Pitchfork — one list per position, stepped together")
                  : t("Cluster bomb — every combination of the lists")
                }
                className={cn(
                  "rounded-sm border px-1.5 py-0.5 text-[9px] transition-colors duration-100",
                  mode === m ? "border-accent bg-selected text-fg" : "border-line text-fg-faint hover:bg-hover hover:text-fg",
                )}
              >
                {m === "sniper" ? t("Sniper") : m === "ram" ? t("Ram") : m === "pitchfork" ? t("Pitchfork") : t("Cluster")}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
            {Array.from({ length: listCount }, (_, i) => (
              <div key={i} className="flex min-h-0 flex-col">
                <div className="flex flex-wrap items-center gap-1 pb-0.5">
                  <span className="flex-1 text-[10px] uppercase tracking-wide text-fg-faint">
                    {listCount > 1 ? t("Position {n}", { n: i + 1 }) : t("Payloads")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        const picked = await bridge.openFile();
                        if (!picked) return;
                        const file = await bridge.readFile(picked.path);
                        if (file && file.content != null) setWordlistAt(i, file.content);
                      })();
                    }}
                    title={t("Load a wordlist file")}
                    className="rounded-sm border border-line px-1 py-0.5 text-[9px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
                  >
                    {t("Load file")}
                  </button>
                  {PRESETS.map((preset) => (
                    <button key={preset.label} type="button" onClick={() => setWordlistAt(i, preset.make())} className="rounded-sm border border-line px-1 py-0.5 text-[9px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 pb-0.5">
                  <span className="text-[9px] text-fg-faint">{t("Range")}</span>
                  <input value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className={cn(smallInput, "w-14")} />
                  <span className="text-[9px] text-fg-faint">→</span>
                  <input value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className={cn(smallInput, "w-14")} />
                  <button
                    type="button"
                    onClick={() => setWordlistAt(i, numberRange(Number(rangeFrom) || 0, Number(rangeTo) || 0, 1))}
                    className="rounded-sm border border-line px-1 py-0.5 text-[9px] text-fg-faint hover:bg-hover hover:text-fg"
                  >
                    {t("Fill")}
                  </button>
                </div>
                <textarea
                  value={wordlists[i] ?? ""}
                  onChange={(event) => setWordlistAt(i, event.target.value)}
                  placeholder={t("One payload per line…")}
                  spellCheck={false}
                  rows={listCount > 1 ? 3 : 6}
                  className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {}
      <Fold title={`${t("Payload processing")}${processors.length ? ` (${processors.length})` : ""}`} open={openFold === "proc"} onToggle={() => setOpenFold((f) => (f === "proc" ? null : "proc"))}>
        <div className="flex flex-col gap-0.5">
          {processors.map((rule, i) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onChange={(r) => setProcessors((p) => p.map((x, j) => (j === i ? r : x)))}
              onRemove={() => setProcessors((p) => p.filter((_, j) => j !== i))}
            />
          ))}
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <Plus className="size-3 text-fg-faint" strokeWidth={2} />
            {(["prefix", "suffix", "case", "encode", "hash", "arith", "substring", "reverse", "replace", "skip"] as PayloadRule["type"][]).map((ty) => (
              <button key={ty} type="button" onClick={() => addRule(ty)} className="rounded-sm border border-line px-1.5 py-0.5 text-[9px] text-fg-faint hover:bg-hover hover:text-fg">
                {t(ty === "prefix" ? "Prefix" : ty === "suffix" ? "Suffix" : ty === "case" ? "Case" : ty === "encode" ? "Encode" : ty === "replace" ? "Replace" : "Skip if")}
              </button>
            ))}
          </div>
        </div>
      </Fold>

      <Fold title={`${t("Grep")}${grepPhrases.length ? ` (${grepPhrases.length})` : ""}`} open={openFold === "grep"} onToggle={() => setOpenFold((f) => (f === "grep" ? null : "grep"))}>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wide text-fg-faint">{t("Match — flag responses containing (one per line)")}</span>
          <textarea value={grepText} onChange={(e) => setGrepText(e.target.value)} rows={2} spellCheck={false} className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent" />
          <span className="text-[9px] uppercase tracking-wide text-fg-faint">{t("Extract — regex (capture group 1) pulled into a column")}</span>
          <input value={grepExtract} onChange={(e) => setGrepExtract(e.target.value)} placeholder={t("e.g. <title>(.*?)</title>")} spellCheck={false} className={cn(smallInput, "w-full")} />
        </div>
      </Fold>

      <Fold title={t("Options")} open={openFold === "opt"} onToggle={() => setOpenFold((f) => (f === "opt" ? null : "opt"))}>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 text-[10px] text-fg-faint">
            {t("Concurrency")}
            <input type="number" min={1} max={32} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value) || 1)} className={cn(smallInput, "w-14")} />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-fg-faint">
            {t("Delay (ms)")}
            <input type="number" min={0} value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value) || 0)} className={cn(smallInput, "w-16")} />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-fg-faint">
            <input type="checkbox" checked={useSession} onChange={(e) => setUseSession(e.target.checked)} />
            {t("Use session")}
          </label>
        </div>
      </Fold>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-1.5">
        {running ? (
          <button type="button" onClick={() => (stop.current = true)} className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 text-[11px] text-status-error transition-colors duration-100 hover:bg-hover">
            <Square className="size-3" strokeWidth={2} fill="currentColor" />
            {t("Stop")}
          </button>
        ) : (
          <button type="button" onClick={() => void attack()} disabled={!marked || total === 0} className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 text-[11px] text-emerald-300 transition-colors duration-100 hover:bg-hover disabled:opacity-40">
            <Play className="size-3" strokeWidth={2} fill="currentColor" />
            {t("Attack")}
          </button>
        )}
        {!marked && <span className="text-[10px] text-amber-400">{t("Mark a payload position with §…§")}</span>}
        <span className="flex-1" />
        <input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder={t("Filter results…")} spellCheck={false} className={cn(smallInput, "w-40")} />
        {grepPhrases.length > 0 && (
          <label className="flex items-center gap-1 text-[10px] text-fg-faint">
            <input type="checkbox" checked={onlyHits} onChange={(e) => setOnlyHits(e.target.checked)} />
            {t("only hits")}
          </label>
        )}
        <span className="text-[10px] tabular-nums text-fg-faint">{view.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-[10px] uppercase tracking-wide text-fg-faint">
              <th onClick={() => toggleSort("index")} className="cursor-pointer border-b border-line px-2 py-1 font-normal hover:text-fg">
                {t("payload")}
                {sortCol === "index" && <ArrowDownUp className="ml-1 inline size-2.5" />}
              </th>
              {grepExtract && (
                <th onClick={() => toggleSort("extract")} className="cursor-pointer border-b border-line px-2 py-1 font-normal hover:text-fg">
                  {t("extract")}
                </th>
              )}
              {grepPhrases.map((ph, i) => (
                <th key={i} className="border-b border-line px-1 py-1 font-normal" title={ph}>
                  <span className="block max-w-16 truncate">{ph}</span>
                </th>
              ))}
              {(["status", "length", "ms"] as const).map((col) => (
                <th key={col} onClick={() => toggleSort(col)} className="cursor-pointer border-b border-line px-2 py-1 font-normal hover:text-fg">
                  {t(col === "ms" ? "time" : col)}
                  {sortCol === col && <ArrowDownUp className="ml-1 inline size-2.5" />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr
                key={row.index}
                onClick={() => setChosen(row)}
                className={cn("cursor-pointer border-b border-line text-[11px] transition-colors duration-100 hover:bg-hover", chosen?.index === row.index && "bg-selected")}
              >
                <td className="max-w-0 truncate px-2 py-0.5 font-mono text-fg" title={row.payload}>
                  {row.payload}
                </td>
                {grepExtract && (
                  <td className="max-w-32 truncate px-2 py-0.5 font-mono text-syn-string" title={row.extracted}>
                    {row.extracted}
                  </td>
                )}
                {grepPhrases.map((_, i) => (
                  <td key={i} className="px-1 py-0.5 text-center">
                    {row.grepHits[i] ? <span className="text-emerald-400">✓</span> : <span className="text-fg-faint">·</span>}
                  </td>
                ))}
                <td className={cn("px-2 py-0.5 font-mono tabular-nums", statusTone(row.status))}>{row.status || "—"}</td>
                <td className="px-2 py-0.5 font-mono tabular-nums text-fg-dim">{row.length}</td>
                <td className="px-2 py-0.5 font-mono tabular-nums text-fg-faint">{row.ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chosen && (
        <div className="max-h-[30vh] shrink-0 overflow-auto border-t border-line p-2">
          <div className="flex items-center gap-2 pb-1">
            <span className="flex-1 truncate font-mono text-[11px] text-fg" title={chosen.payload}>
              {chosen.payload}
            </span>
            <button type="button" onClick={() => sendRowToRepeater(chosen)} className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim hover:bg-hover hover:text-fg">
              <Repeat2 className="size-3" strokeWidth={1.75} />
              {t("Repeater")}
            </button>
            <button type="button" onClick={() => useDecoder.getState().openDecoder(chosen.body)} className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim hover:bg-hover hover:text-fg">
              {t("Decoder")}
            </button>
            <button type="button" onClick={() => useComparer.getState().send(chosen.body)} className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim hover:bg-hover hover:text-fg">
              {t("Comparer")}
            </button>
          </div>
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-fg-dim">{chosen.body || t("(empty)")}</pre>
        </div>
      )}
    </div>
  );
}
