import { Bug, Play, RotateCw } from "lucide-react";
import { useEffect } from "react";

import { PanelHeader, panelButtonClass } from "@/components/SidePanel";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useRun } from "@/stores/run";
import { useWorkspace } from "@/stores/workspace";

export function BuildPanel({ onOpenPanel }: { onOpenPanel?: (id: string) => void }) {
  const scripts = useRun((state) => state.scripts);
  const loading = useRun((state) => state.loading);
  const lastScript = useRun((state) => state.lastScript);
  const refresh = useRun((state) => state.refresh);
  const runScript = useRun((state) => state.runScript);
  const debugScript = useRun((state) => state.debugScript);
  const root = useWorkspace((state) => state.root);
  const t = useT();

  useEffect(() => {
    void refresh();
  }, [refresh, root]);

  const run = (name: string) => {
    runScript(name);
    onOpenPanel?.("terminal");
  };
  const debug = (name: string) => {
    debugScript(name);
    onOpenPanel?.("terminal");
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Build")}>
        <button
          type="button"
          title={t("Reload scripts")}
          aria-label={t("Reload scripts")}
          onClick={() => void refresh()}
          className={panelButtonClass}
        >
          <RotateCw className={cn("size-3.5", loading && "animate-spin")} strokeWidth={1.5} />
        </button>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {scripts.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-fg-faint">
            {t(
              "No run tasks found. Wide looks for package.json, composer.json, Cargo.toml, go.mod, mix.exs, Rakefile, Makefile, pom.xml, build.gradle and pyproject.toml.",
            )}
          </p>
        ) : (
          scripts.map((script) => (
            <div
              key={script.name}
              className={cn(
                "group flex items-center gap-2 px-3 transition-colors duration-100 hover:bg-hover",
                lastScript === script.name && "bg-panel",
              )}
              style={{ height: "var(--h-row)" }}
            >
              <button
                type="button"
                onClick={() => run(script.name)}
                title={script.command}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12px] text-fg"
              >
                <Play className="size-3 shrink-0 text-fg-dim" strokeWidth={1.5} />
                <span className="truncate">{script.name}</span>
                <span className="truncate text-[11px] text-fg-faint">
                  {script.detail ?? script.command}
                </span>
              </button>
              {script.manifest === "package.json" && (
                <button
                  type="button"
                  title={t("Run with the Node inspector")}
                  aria-label={t("Debug {name}", { name: script.name })}
                  onClick={() => debug(script.name)}
                  className={cn(panelButtonClass, "opacity-0 group-hover:opacity-100")}
                >
                  <Bug className="size-3.5" strokeWidth={1.5} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
