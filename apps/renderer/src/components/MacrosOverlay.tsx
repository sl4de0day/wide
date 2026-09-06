import { ChevronUp, Clipboard, KeyRound, Play, Plus, Trash2, X } from "lucide-react";
import { useMemo } from "react";

import { useT } from "@/lib/i18n";
import { cn, copyText } from "@/lib/utils";
import { useMacros } from "@/stores/macros";

export function MacrosOverlay() {
  const t = useT();
  const open = useMacros((state) => state.open);
  const macros = useMacros((state) => state.macros);
  const activeId = useMacros((state) => state.activeId);
  const running = useMacros((state) => state.running);
  const session = useMacros((state) => state.session);
  const sessionMacroId = useMacros((state) => state.sessionMacroId);

  const macro = useMemo(() => macros.find((item) => item.id === activeId) ?? null, [macros, activeId]);

  const cookieHeader = useMemo(
    () => (session?.cookies ?? []).map(([name, value]) => `${name}=${value}`).join("; "),
    [session],
  );

  if (!open) return null;

  const update = useMacros.getState().update;

  const setStep = (index: number, text: string) => {
    if (!macro) return;
    const steps = macro.steps.slice();
    steps[index] = text;
    update(macro.id, { steps });
  };
  const addStep = () => {
    if (!macro) return;
    update(macro.id, { steps: [...macro.steps, "GET https://example.com/\n\n"] });
  };
  const removeStep = (index: number) => {
    if (!macro || macro.steps.length <= 1) return;
    update(macro.id, { steps: macro.steps.filter((_, i) => i !== index) });
  };
  const moveStepUp = (index: number) => {
    if (!macro || index === 0) return;
    const steps = macro.steps.slice();
    [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
    update(macro.id, { steps });
  };

  const setExtract = (index: number, patch: Partial<{ name: string; source: "body" | "header"; pattern: string }>) => {
    if (!macro) return;
    const extract = macro.extract.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
    update(macro.id, { extract });
  };
  const addExtract = () => {
    if (!macro) return;
    update(macro.id, { extract: [...macro.extract, { name: "token", source: "body", pattern: "" }] });
  };
  const removeExtract = (index: number) => {
    if (!macro) return;
    update(macro.id, { extract: macro.extract.filter((_, i) => i !== index) });
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={() => useMacros.getState().close()} />
      <div className="wide-enter-fade fixed left-1/2 top-10 z-50 flex max-h-[88vh] w-[min(960px,95vw)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <KeyRound className="size-4 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <span className="flex-1 text-[12px] font-medium text-fg">{t("Session macros")}</span>
          <button
            type="button"
            onClick={() => useMacros.getState().close()}
            className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
            aria-label={t("Close")}
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {}
          <div className="flex w-44 shrink-0 flex-col border-r border-line">
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {macros.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => useMacros.getState().select(item.id)}
                  className={cn(
                    "flex w-full items-center gap-1 truncate px-2 py-1.5 text-left text-[11px] transition-colors duration-100",
                    item.id === activeId ? "bg-accent/15 text-fg-bright" : "text-fg-dim hover:bg-hover hover:text-fg",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.name || t("Untitled")}</span>
                  <span className="shrink-0 font-mono text-[10px] text-fg-faint">{item.steps.length}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => useMacros.getState().add()}
              className="flex shrink-0 items-center gap-1 border-t border-line px-2 py-1.5 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              <Plus className="size-3.5" strokeWidth={2} />
              {t("New macro")}
            </button>
          </div>

          {}
          {macro ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-auto p-2">
              <div className="mb-2 flex items-center gap-2">
                <input
                  value={macro.name}
                  onChange={(event) => update(macro.id, { name: event.target.value })}
                  placeholder={t("Macro name")}
                  className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => useMacros.getState().remove(macro.id)}
                  className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-status-error"
                  title={t("Delete macro")}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    sessionMacroId === macro.id
                      ? void useMacros.getState().clearSession()
                      : void useMacros.getState().useAsSession(macro)
                  }
                  disabled={running}
                  title={t("Run this macro before scans and replays so they stay authenticated")}
                  className={cn(
                    "flex items-center gap-1 rounded-sm px-2.5 py-1 text-[11px] transition-colors duration-100 disabled:opacity-40",
                    sessionMacroId === macro.id ? "bg-accent/25 text-accent" : "border border-line text-fg-dim hover:bg-hover hover:text-fg",
                  )}
                >
                  <KeyRound className="size-3.5" strokeWidth={2} />
                  {sessionMacroId === macro.id ? t("Session on") : t("Use as session")}
                </button>
                <button
                  type="button"
                  onClick={() => void useMacros.getState().run(macro)}
                  disabled={running}
                  className="flex items-center gap-1 rounded-sm bg-accent/15 px-2.5 py-1 text-[11px] text-accent transition-colors duration-100 hover:bg-accent/25 disabled:opacity-40"
                >
                  <Play className="size-3.5" strokeWidth={2} />
                  {running ? t("Running…") : t("Run macro")}
                </button>
              </div>

              {}
              <p className="mb-1 text-[11px] font-medium text-fg-dim">{t("Steps")}</p>
              {macro.steps.map((step, index) => (
                <div key={index} className="mb-2">
                  <div className="mb-0.5 flex items-center gap-1">
                    <span className="font-mono text-[10px] text-fg-faint">#{index + 1}</span>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => moveStepUp(index)}
                      disabled={index === 0}
                      className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-30"
                      title={t("Move up")}
                    >
                      <ChevronUp className="size-3" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStep(index)}
                      disabled={macro.steps.length <= 1}
                      className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-status-error disabled:opacity-30"
                      title={t("Remove step")}
                    >
                      <X className="size-3" strokeWidth={2} />
                    </button>
                  </div>
                  <textarea
                    value={step}
                    onChange={(event) => setStep(index, event.target.value)}
                    spellCheck={false}
                    rows={4}
                    placeholder={"POST https://host/login\nContent-Type: …\n\nbody"}
                    className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={addStep}
                className="mb-3 flex items-center gap-1 self-start rounded-sm px-1.5 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
              >
                <Plus className="size-3.5" strokeWidth={2} />
                {t("Add step")}
              </button>

              {}
              <p className="mb-1 text-[11px] font-medium text-fg-dim">{t("Extract for {{name}}")}</p>
              {macro.extract.length === 0 && (
                <p className="mb-1 text-[10px] text-fg-faint">
                  {t("Pull a value out of a response with a regex (group 1), then use {{name}} in a later step.")}
                </p>
              )}
              {macro.extract.map((rule, index) => (
                <div key={index} className="mb-1 flex items-center gap-1">
                  <input
                    value={rule.name}
                    onChange={(event) => setExtract(index, { name: event.target.value })}
                    placeholder={t("name")}
                    className="w-24 shrink-0 rounded-sm border border-line bg-canvas px-1.5 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent"
                  />
                  <select
                    value={rule.source}
                    onChange={(event) => setExtract(index, { source: event.target.value as "body" | "header" })}
                    className="shrink-0 rounded-sm border border-line bg-canvas px-1 py-1 text-[11px] text-fg outline-none focus:border-accent"
                  >
                    <option value="body">{t("body")}</option>
                    <option value="header">{t("headers")}</option>
                  </select>
                  <input
                    value={rule.pattern}
                    onChange={(event) => setExtract(index, { pattern: event.target.value })}
                    placeholder={"csrf\"\\s*:\\s*\"([^\"]+)"}
                    className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-1.5 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => removeExtract(index)}
                    className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-status-error"
                    title={t("Remove")}
                  >
                    <X className="size-3" strokeWidth={2} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addExtract}
                className="flex items-center gap-1 self-start rounded-sm px-1.5 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
              >
                <Plus className="size-3.5" strokeWidth={2} />
                {t("Add rule")}
              </button>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-fg-faint">
              {t("No macro selected.")}
            </div>
          )}
        </div>

        {}
        {session && (
          <div className="max-h-56 shrink-0 overflow-auto border-t border-line p-2">
            {session.error && (
              <p className="mb-2 text-[11px] text-status-error">
                {session.failedStep != null
                  ? t("Step {n} failed: {error}", { n: session.failedStep + 1, error: session.error })
                  : session.error}
              </p>
            )}
            <div className="mb-2 flex flex-wrap gap-1">
              {session.results.map((result, index) => (
                <span
                  key={index}
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 font-mono text-[10px]",
                    result.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300",
                  )}
                  title={t(result.error ?? "")}
                >
                  #{index + 1} {result.ok ? `${result.status} · ${result.ms}ms` : t("failed")}
                </span>
              ))}
            </div>

            {session.cookies.length > 0 && (
              <div className="mb-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[11px] font-medium text-fg-dim">{t("Cookies")}</span>
                  <button
                    type="button"
                    onClick={() => void copyText(`Cookie: ${cookieHeader}`)}
                    className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
                  >
                    <Clipboard className="size-3" strokeWidth={1.75} />
                    {t("Copy Cookie header")}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap break-all rounded-sm bg-canvas px-2 py-1 font-mono text-[10px] text-fg">
                  {cookieHeader}
                </pre>
              </div>
            )}

            {session.tokens.length > 0 && (
              <div>
                <span className="text-[11px] font-medium text-fg-dim">{t("Tokens")}</span>
                {session.tokens.map(([name, value]) => (
                  <div key={name} className="mt-0.5 flex items-start gap-2 font-mono text-[10px]">
                    <span className="shrink-0 text-accent">{`{{${name}}}`}</span>
                    <span className="min-w-0 flex-1 break-all text-fg">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
