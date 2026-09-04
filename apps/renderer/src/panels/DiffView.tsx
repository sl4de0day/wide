import { useEffect, useMemo, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { basename, cn } from "@/lib/utils";
import { useWorkspace } from "@/stores/workspace";

type Row =
  | { kind: "hunk"; text: string }
  | { kind: "add"; text: string; newLine: number }
  | { kind: "del"; text: string; oldLine: number }
  | { kind: "ctx"; text: string; oldLine: number; newLine: number }
  | { kind: "meta"; text: string };

function parseDiff(diff: string): Row[] {
  const rows: Row[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) { oldLine = Number(m[1]); newLine = Number(m[2]); }
      rows.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("similarity") || line.startsWith("rename ")) {
      rows.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), newLine });
      newLine += 1;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), oldLine });
      oldLine += 1;
    } else if (line.startsWith("\\")) {
      rows.push({ kind: "meta", text: line });
    } else {
      rows.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return rows;
}

export function DiffView({ relPath, staged }: { relPath: string; staged: boolean }) {
  const t = useT();
  const root = useWorkspace((state) => state.root);
  const stamp = useWorkspace((state) => state.children);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!root) return;
    setError(null);
    void bridge
      .codebergDiff(root, relPath, staged)
      .then((reply) => {
        if (!alive) return;
        if (reply.ok) setDiff(reply.diff ?? "");
        else setError(reply.reason ?? reply.error ?? "Could not read the diff.");
      })
      .catch((e) => { if (alive) setError(String((e as Error)?.message ?? e)); });
    return () => { alive = false; };
  }, [root, relPath, staged, stamp]);

  const rows = useMemo(() => (diff == null ? [] : parseDiff(diff)), [diff]);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 text-[12px]">
        <span className="font-medium text-fg-bright">{basename(relPath)}</span>
        <span className="min-w-0 flex-1 truncate text-fg-faint">{relPath}</span>
        <span className="shrink-0 rounded-sm bg-panel px-1.5 text-[10px] text-fg-dim">{staged ? t("Staged") : t("Working tree")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-relaxed">
        {error ? (
          <p className="px-3 py-3 text-status-error">{error}</p>
        ) : diff == null ? (
          <p className="px-3 py-3 text-fg-faint">{t("Loading…")}</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-3 text-fg-faint">{t("No changes.")}</p>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className={cn(
                    row.kind === "add" && "bg-emerald-500/10",
                    row.kind === "del" && "bg-rose-500/10",
                    row.kind === "hunk" && "bg-panel",
                    row.kind === "meta" && "bg-panel/50",
                  )}
                >
                  <td className="w-10 select-none border-r border-line/50 px-1 text-right text-fg-faint tabular-nums">
                    {row.kind === "del" || row.kind === "ctx" ? row.oldLine : ""}
                  </td>
                  <td className="w-10 select-none border-r border-line/50 px-1 text-right text-fg-faint tabular-nums">
                    {row.kind === "add" || row.kind === "ctx" ? row.newLine : ""}
                  </td>
                  <td className="w-4 select-none px-1 text-center text-fg-faint">
                    {row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""}
                  </td>
                  <td
                    className={cn(
                      "whitespace-pre-wrap break-all px-2",
                      row.kind === "add" && "text-emerald-300",
                      row.kind === "del" && "text-rose-300",
                      row.kind === "hunk" && "text-accent",
                      row.kind === "meta" && "text-fg-faint",
                      row.kind === "ctx" && "text-fg-dim",
                    )}
                  >
                    {row.text || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
