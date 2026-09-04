import { Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { usePitcherEnv, type EnvVar } from "@/stores/pitcherEnv";

import { Modal } from "./Modal";

function VarTable({ rows, onChange }: { rows: EnvVar[]; onChange: (rows: EnvVar[]) => void }) {
  const t = useT();
  const [shown, setShown] = useState<Set<number>>(new Set());
  const set = (i: number, patch: Partial<EnvVar>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggleShown = (i: number) =>
    setShown((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  return (
    <div className="text-[11px]">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1 border-b border-line/50 py-0.5">
          <input type="checkbox" checked={r.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} className="shrink-0" />
          <input value={r.key} onChange={(e) => set(i, { key: e.target.value })} placeholder={t("key")} className="w-2/5 bg-transparent px-1 font-mono text-syn-property outline-none" />
          <input
            value={r.value}
            onChange={(e) => set(i, { value: e.target.value })}
            placeholder={t("value")}
            type={r.secret && !shown.has(i) ? "password" : "text"}
            className="min-w-0 flex-1 bg-transparent px-1 font-mono text-syn-string outline-none"
          />
          <button type="button" onClick={() => set(i, { secret: !r.secret })} title={t("Secret")} className={cn("shrink-0 px-1", r.secret ? "text-accent" : "text-fg-faint hover:text-fg")}>
            {r.secret && !shown.has(i) ? <EyeOff className="size-3" strokeWidth={2} /> : <Eye className="size-3" strokeWidth={2} />}
          </button>
          {r.secret && (
            <button type="button" onClick={() => toggleShown(i)} className="shrink-0 px-0.5 text-[9px] text-fg-faint hover:text-fg">
              {shown.has(i) ? t("Hide") : t("Show")}
            </button>
          )}
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="shrink-0 px-1 text-fg-faint hover:text-status-error">
            <X className="size-3" strokeWidth={2} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { key: "", value: "", enabled: true }])} className="mt-1 flex items-center gap-1 px-1 text-[10px] text-fg-faint hover:text-fg">
        <Plus className="size-3" strokeWidth={2} />
        {t("Add row")}
      </button>
    </div>
  );
}

export function EnvManager({ onClose }: { onClose: () => void }) {
  const t = useT();
  const environments = usePitcherEnv((s) => s.environments);
  const globals = usePitcherEnv((s) => s.globals);
  const activeId = usePitcherEnv((s) => s.activeId);
  const [selected, setSelected] = useState<string | "globals" | null>(activeId ?? (environments[0]?.id ?? "globals"));

  const selectedEnv = environments.find((e) => e.id === selected) ?? null;

  return (
    <Modal title={t("Environments")} onClose={onClose} wide>
      <div className="flex h-[60vh] gap-3">
        {}
        <div className="flex w-48 shrink-0 flex-col border-r border-line pr-2">
          <div className="mb-1 flex items-center">
            <span className="flex-1 text-[10px] uppercase tracking-wide text-fg-faint">{t("Environments")}</span>
            <button type="button" onClick={() => setSelected(usePitcherEnv.getState().addEnv())} title={t("New environment")} className="rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg">
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {environments.map((e) => (
              <div key={e.id} className={cn("group flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px]", selected === e.id ? "bg-selected text-fg" : "text-fg-dim hover:bg-hover")}>
                <input type="radio" checked={activeId === e.id} onChange={() => usePitcherEnv.getState().setActive(e.id)} title={t("Set active")} className="shrink-0" />
                <button type="button" onClick={() => setSelected(e.id)} className="min-w-0 flex-1 truncate text-left">{e.name}</button>
                <button type="button" onClick={() => usePitcherEnv.getState().removeEnv(e.id)} className="shrink-0 px-0.5 text-fg-faint opacity-0 group-hover:opacity-100 hover:text-status-error">
                  <Trash2 className="size-3" strokeWidth={2} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setSelected("globals")} className={cn("mt-2 w-full rounded-sm px-1.5 py-1 text-left text-[11px]", selected === "globals" ? "bg-selected text-fg" : "text-fg-dim hover:bg-hover")}>
              {t("Globals")}
            </button>
          </div>
        </div>
        {}
        <div className="min-w-0 flex-1 overflow-auto">
          {selected === "globals" ? (
            <>
              <div className="mb-2 text-[11px] font-medium text-fg">{t("Globals")}</div>
              <VarTable rows={globals} onChange={(v) => usePitcherEnv.getState().setGlobals(v)} />
            </>
          ) : selectedEnv ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <input
                  value={selectedEnv.name}
                  onChange={(e) => usePitcherEnv.getState().renameEnv(selectedEnv.id, e.target.value)}
                  className="rounded-sm border border-line bg-canvas px-2 py-1 text-[12px] font-medium text-fg outline-none focus:border-accent"
                />
                <button type="button" onClick={() => usePitcherEnv.getState().duplicateEnv(selectedEnv.id)} className="text-[10px] text-fg-faint hover:text-fg">{t("Duplicate")}</button>
              </div>
              <VarTable rows={selectedEnv.vars} onChange={(v) => usePitcherEnv.getState().setEnvVars(selectedEnv.id, v)} />
            </>
          ) : (
            <p className="text-[11px] text-fg-faint">{t("No environment selected.")}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
