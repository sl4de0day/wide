import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useDiagnostics } from "@/stores/diagnostics";
import { toast } from "@/stores/toast";

interface CustomRule {
  id: string;
  pattern: string;
  message: string;
  severity: string;
}

const SEVERITIES = ["info", "low", "medium", "high", "critical"];
const BLANK: CustomRule = { id: "", pattern: "", message: "", severity: "warning" };

export function SecurityRulesModal({ root, onClose }: { root: string; onClose: () => void }) {
  const t = useT();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [rules, setRules] = useState<CustomRule[]>([]);
  const [draft, setDraft] = useState<CustomRule>(BLANK);
  const [sample, setSample] = useState("");
  const [test, setTest] = useState<{ count: number; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void bridge.readFile(`${root}/.wide/security.json`).then((reply) => {
      if (!alive) return;
      try {
        const parsed = JSON.parse(reply.content || "{}");
        if (parsed && typeof parsed === "object") {
          setConfig(parsed);
          if (Array.isArray(parsed.rules)) setRules(parsed.rules.filter((r: unknown) => r && typeof r === "object"));
        }
      } catch {
        void 0;
      }
    });
    return () => {
      alive = false;
    };
  }, [root]);

  const runTest = async () => {
    if (!draft.pattern) return;
    const reply = await bridge.securityTestRule(draft.pattern, "", sample);
    if (reply.ok) setTest({ count: (reply.matches ?? []).length });
    else setTest({ count: 0, error: reply.error });
  };

  const addRule = () => {
    if (!draft.id.trim() || !draft.pattern.trim()) {
      toast.error(t("A rule needs an id and a pattern."));
      return;
    }
    setRules((prev) => [...prev.filter((r) => r.id !== draft.id), { ...draft, id: draft.id.trim() }]);
    setDraft(BLANK);
    setTest(null);
  };

  const save = async () => {
    const next = { ...config, rules };
    const reply = await bridge.writeFile(`${root}/.wide/security.json`, JSON.stringify(next, null, 2));
    if (reply.error) {
      toast.error(reply.error || t("Could not save the rules."));
      return;
    }
    toast.success(t("Rules saved."));
    void useDiagnostics.getState().scanProject(root);
    onClose();
  };

  return (
    <Modal title={t("Custom security rules")} onClose={onClose} wide>
      <div className="flex flex-col gap-4 p-4 text-[12px]">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-fg-dim">{t("Rules")}</span>
          {rules.length === 0 ? (
            <p className="pt-1 text-[11px] text-fg-faint">{t("No custom rules yet.")}</p>
          ) : (
            <ul className="mt-1 divide-y divide-line rounded-sm border border-line">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="min-w-0">
                    <code className="text-fg">{rule.id}</code>
                    <code className="ml-2 truncate font-mono text-[10px] text-fg-faint">{rule.pattern}</code>
                  </span>
                  <button type="button" onClick={() => setRules((p) => p.filter((r) => r.id !== rule.id))} className="shrink-0 text-[10px] text-fg-faint hover:text-status-error">
                    {t("Remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-sm border border-line p-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-fg-dim">{t("Add rule")}</span>
          <div className="flex gap-2">
            <input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder={t("Rule id")} className="w-40 rounded-sm border border-line bg-canvas px-2 py-1 text-[12px] text-fg outline-none focus:border-accent placeholder:text-fg-faint" />
            <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })} className="rounded-sm border border-line bg-canvas px-2 py-1 text-[12px] text-fg outline-none focus:border-accent">
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <input value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} placeholder={t("Pattern (regex)")} className="w-full rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-accent placeholder:text-fg-faint" />
          <input value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} placeholder={t("Message")} className="w-full rounded-sm border border-line bg-canvas px-2 py-1 text-[12px] text-fg outline-none focus:border-accent placeholder:text-fg-faint" />
          <textarea value={sample} onChange={(e) => setSample(e.target.value)} placeholder={t("Test against a sample")} rows={3} className="w-full resize-none rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void runTest()} disabled={!draft.pattern} className="rounded-sm border border-line px-2 py-1 text-[11px] text-fg-dim hover:bg-hover hover:text-fg disabled:opacity-50">{t("Test")}</button>
            {test && <span className={cn("text-[11px]", test.error ? "text-status-error" : "text-fg-dim")}>{test.error ? test.error : t("{count} matches", { count: test.count })}</span>}
            <span className="flex-1" />
            <button type="button" onClick={addRule} className="rounded-sm border border-line px-2 py-1 text-[11px] text-fg-dim hover:bg-hover hover:text-fg">{t("Add rule")}</button>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-sm border border-line px-3 py-1 text-[12px] text-fg-dim hover:bg-hover hover:text-fg">{t("Cancel")}</button>
          <button type="button" onClick={() => void save()} className="rounded-sm border border-line bg-selected px-3 py-1 text-[12px] text-fg-bright hover:bg-hover">{t("Save")}</button>
        </div>
      </div>
    </Modal>
  );
}
