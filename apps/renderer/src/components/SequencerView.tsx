import { Dices, Play, Square, Trash2 } from "lucide-react";
import { useState } from "react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useSequencer } from "@/stores/sequencer";

const VERDICT_TONE: Record<string, string> = {
  strong: "text-emerald-400",
  moderate: "text-amber-400",
  weak: "text-status-error",
};

function Bar({ label, value, max }: { label: string; value: string; max?: { v: number; of: number } }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-32 shrink-0 text-[10px] uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="w-16 shrink-0 font-mono text-[12px] tabular-nums text-fg">{value}</span>
      {max && (
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, (max.v / max.of) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function SequencerView() {
  const t = useT();
  const seed = useSequencer((s) => s.seed);
  const rule = useSequencer((s) => s.rule);
  const tokens = useSequencer((s) => s.tokens);
  const running = useSequencer((s) => s.running);
  const doneN = useSequencer((s) => s.done);
  const total = useSequencer((s) => s.total);
  const error = useSequencer((s) => s.error);
  const stats = useSequencer((s) => s.stats);
  const [count, setCount] = useState(200);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Dices className="size-4 shrink-0 text-fg-faint" strokeWidth={1.75} />
        <span className="flex-1 text-[12px] font-medium text-fg">{t("Sequencer")}</span>
        <span className="text-[11px] text-fg-faint">{running || doneN > 0 ? `${doneN}/${total}` : `${tokens.length} ${t("tokens")}`}</span>
        {(tokens.length > 0 || stats) && (
          <button type="button" onClick={() => useSequencer.getState().clear()} title={t("Clear")} className="rounded-sm p-1 text-fg-faint hover:bg-hover hover:text-fg">
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>

      <div className="shrink-0 border-b border-line p-2">
        <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Request that issues the token")}</span>
        <textarea
          value={seed}
          onChange={(e) => useSequencer.getState().setSeed(e.target.value)}
          placeholder={"GET https://host/login\nHost: host\n\n"}
          spellCheck={false}
          rows={4}
          className="mt-1 w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Token")}</span>
          <input
            value={rule}
            onChange={(e) => useSequencer.getState().setRule(e.target.value)}
            placeholder={t("auto, or a regex with a capture group")}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-0.5 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
          />
          <label className="flex items-center gap-1 text-[10px] text-fg-faint">
            {t("samples")}
            <input type="number" min={20} max={5000} value={count} onChange={(e) => setCount(Number(e.target.value) || 200)} className="w-16 rounded-sm border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-fg outline-none focus:border-accent" />
          </label>
          {running ? (
            <button type="button" onClick={() => useSequencer.getState().stop()} className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 text-[11px] text-status-error hover:bg-hover">
              <Square className="size-3" strokeWidth={2} fill="currentColor" />
              {t("Stop")}
            </button>
          ) : (
            <button type="button" onClick={() => useSequencer.getState().run(count)} disabled={!seed.trim()} className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 text-[11px] text-emerald-300 hover:bg-hover disabled:opacity-40">
              <Play className="size-3" strokeWidth={2} fill="currentColor" />
              {t("Analyze")}
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-[11px] text-status-error">{t(error)}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!stats ? (
          <p className="text-[12px] text-fg-faint">{running ? t("Sampling…") : t("Paste a request and analyze to measure the token's randomness.")}</p>
        ) : (
          <>
            <div className="mb-3 flex items-baseline gap-2">
              <span className={cn("text-[20px] font-semibold tabular-nums", VERDICT_TONE[stats.verdict])}>{stats.effectiveBits.toFixed(1)}</span>
              <span className="text-[12px] text-fg-dim">{t("effective bits of entropy")}</span>
              <span className={cn("text-[12px] font-medium uppercase", VERDICT_TONE[stats.verdict])}>{t(stats.verdict)}</span>
            </div>
            <Bar label={t("samples")} value={String(stats.count)} />
            <Bar label={t("character set")} value={String(stats.charset)} max={{ v: stats.charset, of: 95 }} />
            <Bar label={t("length")} value={stats.fixedLength != null ? String(stats.fixedLength) : t("variable")} />
            <Bar label={t("entropy / char")} value={`${stats.perCharEntropy.toFixed(2)} b`} max={{ v: stats.perCharEntropy, of: Math.log2(Math.max(2, stats.charset)) }} />
            <Bar label={t("entropy / bit")} value={`${stats.bitEntropy.toFixed(3)}`} max={{ v: stats.bitEntropy, of: 1 }} />
            <Bar label={t("bit balance (0.5 is ideal)")} value={stats.bitBalance.toFixed(3)} max={{ v: 1 - Math.abs(stats.bitBalance - 0.5) * 2, of: 1 }} />
            <Bar label={t("transition entropy")} value={`${stats.transitionEntropy.toFixed(2)} b`} max={{ v: stats.transitionEntropy, of: Math.log2(Math.max(2, stats.charset)) * 2 }} />
            <Bar label={t("compression ratio")} value={stats.compressionRatio.toFixed(2)} max={{ v: stats.compressionRatio, of: 1 }} />
            <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">
              {stats.effectiveBits >= 64
                ? t("Strong: guessing this token is computationally infeasible.")
                : stats.effectiveBits >= 32
                  ? t("Moderate: acceptable for short-lived tokens, weak for long-lived ones.")
                  : t("Weak: this token is guessable — treat it as a finding.")}
            </p>
            <div className="mt-3">
              <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("sample tokens")}</span>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-canvas px-2 py-1 font-mono text-[10px] text-fg-dim">
                {tokens.slice(0, 20).join("\n")}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
