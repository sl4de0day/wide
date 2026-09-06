import { ArrowLeftRight, Crosshair, Dices, Layers, Pickaxe, Plus, Radar, Radio, Repeat2, Target, X, type LucideIcon } from "lucide-react";
import { useEffect } from "react";

import { CollaboratorView } from "@/components/CollaboratorView";
import { IntruderView } from "@/components/IntruderView";
import { MinerView } from "@/components/MinerView";
import { RepeaterView } from "@/components/RepeaterView";
import { ScannerView } from "@/components/ScannerView";
import { SequencerView } from "@/components/SequencerView";
import { TechnologiesView } from "@/components/TechnologiesView";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ProxyPanel } from "@/panels/ProxyPanel";
import { TargetPanel } from "@/panels/TargetPanel";
import { useCatcher, type CatcherTool } from "@/stores/catcher";
import { repeaterSeeds } from "@/stores/editor";
import { useExtensions } from "@/stores/extensions";

const TOOLS: { id: CatcherTool; label: string; icon: LucideIcon }[] = [
  { id: "proxy", label: "Proxy", icon: ArrowLeftRight },
  { id: "target", label: "Target", icon: Target },
  { id: "repeater", label: "Repeater", icon: Repeat2 },
  { id: "intruder", label: "Intruder", icon: Crosshair },
  { id: "scanner", label: "Scanner", icon: Radar },
  { id: "collaborator", label: "Collaborator", icon: Radio },
  { id: "sequencer", label: "Sequencer", icon: Dices },
];

const BLANK_SEED = { method: "GET", url: "https://example.com/", headers: [] as [string, string][], body: "" };

function repeaterLabel(id: string, index: number): string {
  const seed = repeaterSeeds.get(id);
  if (seed) {
    try {
      return `${seed.method} ${new URL(seed.url).host}`;
    } catch {

    }
  }
  return `#${index + 1}`;
}

function RepeaterWorkspace() {
  const t = useT();
  const ids = useCatcher((state) => state.repeaterIds);
  const active = useCatcher((state) => state.activeRepeater);
  const select = useCatcher((state) => state.selectRepeater);
  const close = useCatcher((state) => state.closeRepeater);
  const addBlank = () => useCatcher.getState().addRepeater({ ...BLANK_SEED });
  const current = active && ids.includes(active) ? active : (ids[ids.length - 1] ?? null);

  if (ids.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-faint">
        <span className="text-[12px]">{t("No Repeater sessions yet. Send a request here from Proxy or Target.")}</span>
        <button
          type="button"
          onClick={addBlank}
          className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <Plus className="size-3.5" strokeWidth={2} />
          {t("New request")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-chrome px-1.5 py-1">
        {ids.map((id, index) => (
          <div
            key={id}
            className={cn(
              "group flex shrink-0 items-center rounded-sm border text-[11px] transition-colors duration-100",
              current === id ? "border-accent bg-selected text-fg" : "border-line text-fg-faint hover:bg-hover hover:text-fg",
            )}
          >
            <button type="button" onClick={() => select(id)} className="max-w-[160px] truncate px-2 py-0.5 font-mono">
              {repeaterLabel(id, index)}
            </button>
            <button
              type="button"
              onClick={() => close(id)}
              aria-label={t("Close")}
              className="rounded-sm px-1 py-0.5 opacity-0 transition-opacity duration-100 hover:text-fg group-hover:opacity-100"
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addBlank}
          title={t("New request")}
          className="shrink-0 rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <Plus className="size-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {ids.map((id) => (
          <div key={id} className={cn("h-full", current !== id && "hidden")}>
            <RepeaterView id={id} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CatcherView() {
  const t = useT();
  const tool = useCatcher((state) => state.tool);
  const show = useCatcher((state) => state.show);
  const hasMiner = useExtensions((state) => state.installed.has("js-miner"));
  const hasTechnologies = useExtensions((state) => state.installed.has("wappalyzer"));
  useEffect(() => {
    if ((tool === "miner" && !hasMiner) || (tool === "technologies" && !hasTechnologies)) {
      useCatcher.getState().show("proxy");
    }
  }, [tool, hasMiner, hasTechnologies]);
  const tools: { id: CatcherTool; label: string; icon: LucideIcon }[] = [
    ...TOOLS,
    ...(hasMiner ? [{ id: "miner" as CatcherTool, label: "Miner", icon: Pickaxe }] : []),
    ...(hasTechnologies ? [{ id: "technologies" as CatcherTool, label: "Technologies", icon: Layers }] : []),
  ];
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-chrome px-2 py-1">
        {tools.map((tl) => {
          const Icon = tl.icon;
          return (
            <button
              key={tl.id}
              type="button"
              onClick={() => show(tl.id)}
              aria-pressed={tool === tl.id}
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[12px] transition-colors duration-100",
                tool === tl.id ? "bg-selected text-fg-bright" : "text-fg-dim hover:bg-hover hover:text-fg",
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              {t(tl.label)}
            </button>
          );
        })}
      </div>
      {}
      <div className="min-h-0 flex-1">
        <div className={cn("h-full", tool !== "proxy" && "hidden")}>
          <ProxyPanel />
        </div>
        <div className={cn("h-full", tool !== "target" && "hidden")}>
          <TargetPanel />
        </div>
        <div className={cn("h-full", tool !== "repeater" && "hidden")}>
          <RepeaterWorkspace />
        </div>
        <div className={cn("h-full", tool !== "intruder" && "hidden")}>
          <IntruderView />
        </div>
        <div className={cn("h-full", tool !== "scanner" && "hidden")}>
          <ScannerView />
        </div>
        <div className={cn("h-full", tool !== "collaborator" && "hidden")}>
          <CollaboratorView />
        </div>
        <div className={cn("h-full", tool !== "sequencer" && "hidden")}>
          <SequencerView />
        </div>
        {hasMiner && tool === "miner" && (
          <div className="h-full">
            <MinerView />
          </div>
        )}
        {hasTechnologies && tool === "technologies" && (
          <div className="h-full">
            <TechnologiesView />
          </div>
        )}
      </div>
    </div>
  );
}
