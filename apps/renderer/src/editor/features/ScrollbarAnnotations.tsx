import { useMemo } from "react";

import type { Diagnostic } from "@/lib/bridge";
import { normalisePath } from "@/lib/utils";
import { useDiagnostics } from "@/stores/diagnostics";
import { useProjectScan } from "@/stores/projectScan";

const NO_DIAGNOSTICS: Diagnostic[] = [];

interface ScrollbarAnnotationsProps {
  tabPath: string;
  contentLength: number;
  totalLines: number;
  onJump: (pos: number) => void;
  onJumpLine: (line: number) => void;
}

export function ScrollbarAnnotations({
  tabPath,
  contentLength,
  totalLines,
  onJump,
  onJumpLine,
}: ScrollbarAnnotationsProps) {
  const norm = normalisePath(tabPath);
  const diags = useDiagnostics(
    (state) => state.byFile[norm] ?? state.byFile[tabPath] ?? NO_DIAGNOSTICS,
  );
  const findings = useProjectScan((state) => state.findings);
  const scanFindings = useMemo(
    () => findings.filter((f) => normalisePath(f.file) === norm || f.file === tabPath),
    [findings, norm, tabPath],
  );

  if (diags.length === 0 && scanFindings.length === 0) return null;

  return (
    <div
      className="absolute top-0 right-0 w-[12px] h-full pointer-events-none z-20 select-none"
      aria-hidden="true"
    >
      {/* Code Diagnostics */}
      {diags.map((d, i) => {
        const pct = Math.min(99, Math.max(1, (d.from / Math.max(1, contentLength)) * 100));
        const isError = d.severity === "error";
        const isWarn = d.severity === "warning";

        return (
          <div
            key={`diag-${i}-${d.from}`}
            onClick={() => onJump(d.from)}
            title={`[${d.severity.toUpperCase()}] ${d.message}`}
            style={{ top: `${pct}%` }}
            className={`absolute right-[2px] w-[8px] h-[3px] rounded-xs cursor-pointer pointer-events-auto transition-all hover:w-[12px] hover:h-[5px] ${
              isError
                ? "bg-rose-500 shadow-xs shadow-rose-500/70"
                : isWarn
                  ? "bg-amber-400 shadow-xs shadow-amber-400/70"
                  : "bg-sky-400 shadow-xs shadow-sky-400/50"
            }`}
          />
        );
      })}

      {/* Security Scan Findings */}
      {scanFindings.map((f, i) => {
        const pct = Math.min(99, Math.max(1, (f.line / Math.max(1, totalLines)) * 100));
        return (
          <div
            key={`sec-${i}-${f.line}`}
            onClick={() => onJumpLine(f.line)}
            title={`[SECURITY] ${f.message || f.ruleId}: line ${f.line}`}
            style={{ top: `${pct}%` }}
            className="absolute right-[2px] w-[8px] h-[3px] rounded-xs cursor-pointer pointer-events-auto bg-purple-500 shadow-xs shadow-purple-500/70 transition-all hover:w-[12px] hover:h-[5px]"
          />
        );
      })}
    </div>
  );
}

