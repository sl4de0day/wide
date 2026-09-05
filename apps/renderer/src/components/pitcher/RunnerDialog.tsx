import { Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n";
import { flattenRequests, parseDataFile, runCollection, type RunItemResult } from "@/lib/pitcher/runner";
import { cn } from "@/lib/utils";
import type { Collection } from "@/stores/pitcher";

import { Modal } from "./Modal";

export function RunnerDialog({ collection, onClose }: { collection: Collection; onClose: () => void }) {
  const t = useT();
  const [iterations, setIterations] = useState(1);
  const [data, setData] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunItemResult[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stopRef = useRef(false);

  const requests = flattenRequests(collection.nodes);
  const rows = parseDataFile(data);

  useEffect(() => {
    if (rows.length > 0) setIterations(rows.length);

  }, [rows.length]);

  const totalPass = results.reduce((n, r) => n + r.tests.filter((x) => x.passed).length, 0);
  const totalFail = results.reduce((n, r) => n + r.tests.filter((x) => !x.passed).length, 0);

  const run = async () => {
    setResults([]);
    setRunning(true);
    stopRef.current = false;
    await runCollection(
      requests,
      iterations,
      rows,
      (p) => setProgress({ done: p.done, total: p.total }),
      () => stopRef.current,
      (r) => setResults((s) => [...s, r]),
    );
    setRunning(false);
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setData(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Modal title={`${t("Run")} · ${collection.name}`} onClose={onClose} wide>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1 text-fg-dim">
            {t("Iterations")}
            <input type="number" min={1} value={iterations} onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))} className="w-16 rounded-sm border border-line bg-canvas px-1.5 py-0.5 text-fg outline-none focus:border-accent" />
          </label>
          <label className="cursor-pointer rounded-sm border border-line px-2 py-0.5 text-fg-dim hover:bg-hover hover:text-fg">
            {t("Data file (CSV/JSON)")}
            <input type="file" accept=".csv,.json,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          </label>
          {rows.length > 0 && <span className="text-fg-faint">{t("{n} data rows").replace("{n}", String(rows.length))}</span>}
          <span className="text-fg-faint">· {requests.length} {t("requests")}</span>
          <div className="flex-1" />
          {running ? (
            <button type="button" onClick={() => (stopRef.current = true)} className="flex items-center gap-1 rounded-sm border border-status-error px-3 py-1 text-status-error hover:bg-status-error hover:text-bg">
              <Square className="size-3" strokeWidth={2} />
              {t("Stop")}
            </button>
          ) : (
            <button type="button" onClick={run} disabled={requests.length === 0} className="flex items-center gap-1 rounded-sm border border-accent px-3 py-1 text-accent hover:bg-accent hover:text-bg disabled:opacity-40">
              <Play className="size-3" strokeWidth={2} />
              {t("Run")}
            </button>
          )}
        </div>

        {data.trim() && rows.length > 0 && (
          <textarea value={data} onChange={(e) => setData(e.target.value)} rows={3} spellCheck={false} className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[10px] text-fg outline-none focus:border-accent" />
        )}

        {(running || progress.total > 0) && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] tabular-nums text-fg-faint">{progress.done}/{progress.total}</span>
            {results.length > 0 && (
              <span className="text-[10px] tabular-nums">
                <span className="text-emerald-400">{totalPass} {t("passed")}</span>
                {totalFail > 0 && <span className="text-status-error"> · {totalFail} {t("failed")}</span>}
              </span>
            )}
          </div>
        )}

        {results.length > 0 && (
          <div className="max-h-[46vh] overflow-auto rounded-sm border border-line">
            <table className="w-full text-left text-[11px]">
              <tbody className="font-mono">
                {results.map((r, i) => {
                  const fail = r.tests.filter((x) => !x.passed).length;
                  const tone = !r.ok || fail > 0 ? "text-status-error" : "text-emerald-400";
                  return (
                    <tr key={i} className="border-b border-line/40">
                      <td className="py-1 pl-2 pr-1 text-fg-faint tabular-nums">#{r.iteration + 1}</td>
                      <td className={cn("py-1 pr-2 font-semibold", methodTone(r.method))}>{r.method}</td>
                      <td className="min-w-0 max-w-48 truncate py-1 pr-2 text-fg">{r.name}</td>
                      <td className={cn("py-1 pr-2 tabular-nums", tone)}>{r.ok ? r.status : "ERR"}</td>
                      <td className="py-1 pr-2 tabular-nums text-fg-faint">{r.ms} ms</td>
                      <td className="py-1 pr-2">
                        {r.tests.length > 0 && (
                          <span className={fail > 0 ? "text-status-error" : "text-emerald-400"}>{r.tests.length - fail}/{r.tests.length}</span>
                        )}
                        {r.error && <span className="text-status-error"> {t(r.error)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function methodTone(m: string): string {
  switch (m) {
    case "GET":
      return "text-emerald-400";
    case "POST":
      return "text-amber-400";
    case "PUT":
    case "PATCH":
      return "text-sky-400";
    case "DELETE":
      return "text-status-error";
    default:
      return "text-fg-dim";
  }
}
