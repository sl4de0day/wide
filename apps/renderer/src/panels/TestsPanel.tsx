import { ChevronDown, ChevronRight, CircleCheck, CircleX, FlaskConical, Play, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PanelHeader, panelButtonClass } from "@/components/SidePanel";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { useTests, type TestStatus } from "@/stores/tests";
import { useWorkspace } from "@/stores/workspace";

function StatusDot({ status }: { status: TestStatus | undefined }) {
  if (status === "pass") return <CircleCheck className="size-3.5 shrink-0 text-emerald-400" strokeWidth={2} />;
  if (status === "fail") return <CircleX className="size-3.5 shrink-0 text-rose-400" strokeWidth={2} />;
  return <span className="size-3.5 shrink-0" />;
}

export function TestsPanel() {
  const t = useT();
  const root = useWorkspace((state) => state.root);
  const framework = useTests((state) => state.framework);
  const files = useTests((state) => state.files);
  const loading = useTests((state) => state.loading);
  const running = useTests((state) => state.running);
  const statuses = useTests((state) => state.statuses);
  const output = useTests((state) => state.output);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void useTests.getState().discover(root);
  }, [root]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      files
        .map((f) => ({ ...f, cases: q ? f.cases.filter((c) => c.name.toLowerCase().includes(q) || f.rel.toLowerCase().includes(q)) : f.cases }))
        .filter((f) => f.cases.length > 0),
    [files, q],
  );

  const total = useMemo(() => files.reduce((n, f) => n + f.cases.length, 0), [files]);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Tests")}>
        <span className="flex-1" />
        {framework && total > 0 && (
          <button type="button" onClick={() => root && void useTests.getState().runAll(root)} disabled={running !== null} title={t("Run all tests")} aria-label={t("Run all tests")} className={panelButtonClass}>
            <Play className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        <button type="button" onClick={() => void useTests.getState().discover(root)} title={t("Rescan tests")} aria-label={t("Rescan tests")} className={panelButtonClass}>
          <RotateCw className={cn("size-3.5", loading && "animate-spin")} strokeWidth={1.5} />
        </button>
      </PanelHeader>

      {framework && total > 0 && (
        <div className="shrink-0 border-b border-line px-2 py-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Filter tests…")}
            spellCheck={false}
            className="w-full rounded-sm border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {!root ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">{t("Open a project to discover its tests.")}</p>
        ) : !framework ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">{t("No test framework detected in this project.")}</p>
        ) : total === 0 ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">{t("No tests found.")}</p>
        ) : (
          shown.map((file) => {
            const open = !collapsed[file.rel];
            const fileRunning = running === file.rel || running === "*";
            return (
              <div key={file.rel} className="border-b border-line/60">
                <div className="group flex items-center gap-1 px-2 py-0.5">
                  <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [file.rel]: open }))} className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] text-fg-dim hover:text-fg">
                    {open ? <ChevronDown className="size-3 shrink-0 text-fg-faint" strokeWidth={2} /> : <ChevronRight className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />}
                    <FlaskConical className="size-3 shrink-0 text-fg-faint" strokeWidth={1.75} />
                    <span className="truncate" title={file.rel}>{file.rel}</span>
                    <span className="shrink-0 text-fg-faint">{file.cases.length}</span>
                  </button>
                  <button type="button" onClick={() => root && void useTests.getState().runFile(root, file.rel)} disabled={running !== null} title={t("Run this file")} aria-label={t("Run this file")} className="shrink-0 rounded-sm p-0.5 text-fg-faint opacity-0 transition-opacity duration-100 hover:bg-hover hover:text-fg group-hover:opacity-100 disabled:opacity-0">
                    <Play className={cn("size-3", fileRunning && "text-accent")} strokeWidth={2} />
                  </button>
                </div>
                {open &&
                  file.cases.map((c) => {
                    const key = useTests.getState().key(file.rel, c.name);
                    return (
                      <div key={key} className="group flex items-center gap-1.5 py-0.5 pl-6 pr-2 hover:bg-hover">
                        <StatusDot status={statuses[key]} />
                        <button type="button" onClick={() => void useEditor.getState().revealAt(file.file, c.line)} className="min-w-0 flex-1 truncate text-left text-[12px] text-fg" title={c.name}>
                          {c.name}
                        </button>
                        <button type="button" onClick={() => root && void useTests.getState().runCase(root, file.rel, c.name)} disabled={running !== null} title={t("Run this test")} aria-label={t("Run this test")} className="shrink-0 rounded-sm p-0.5 text-fg-faint opacity-0 transition-opacity duration-100 hover:bg-hover hover:text-fg group-hover:opacity-100 disabled:opacity-0">
                          <Play className={cn("size-3", running === key && "text-accent")} strokeWidth={2} />
                        </button>
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      {output && (
        <div className="max-h-[30vh] shrink-0 overflow-auto border-t border-line bg-canvas p-2">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-fg-dim">{output}</pre>
        </div>
      )}
    </div>
  );
}
