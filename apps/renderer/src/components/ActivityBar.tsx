import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Bug,
  CircleAlert,
  FlaskConical,
  Folder,
  GitBranch,
  Globe,
  Hammer,
  NotebookPen,
  Puzzle,
  Radar,
  Search,
  Send,
  Server,
  Settings,
  Terminal,
  TestTube2,
} from "lucide-react";
import { lazy, type ComponentType } from "react";

import { useT } from "@/lib/i18n";
import { extensionById } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { FileTree } from "@/panels/FileTree";
import { ProblemsPanel } from "@/panels/ProblemsPanel";
import { SearchPanel } from "@/panels/SearchPanel";
import { StructurePanel } from "@/panels/StructurePanel";
import { ToolsPanel } from "@/panels/ToolsPanel";
import { BROWSER_PATH, CATCHER_PATH, CYBERCHEF_PATH, PITCHER_PATH, SETTINGS_PATH, useEditor } from "@/stores/editor";
import { useExtensions } from "@/stores/extensions";

const BuildPanel = lazy(() => import("@/panels/BuildPanel").then((m) => ({ default: m.BuildPanel })));
const TerminalPanel = lazy(() =>
  import("@/panels/TerminalPanel").then((m) => ({ default: m.TerminalPanel })),
);
const CodebergPanel = lazy(() =>
  import("@/panels/CodebergPanel").then((m) => ({ default: m.CodebergPanel })),
);
const AiPanel = lazy(() => import("@/panels/AiPanel").then((m) => ({ default: m.AiPanel })));
const DebugPanel = lazy(() => import("@/panels/DebugPanel").then((m) => ({ default: m.DebugPanel })));
const FindingsPanel = lazy(() => import("@/panels/FindingsPanel").then((m) => ({ default: m.FindingsPanel })));
const RemotePanel = lazy(() => import("@/panels/RemotePanel").then((m) => ({ default: m.RemotePanel })));
const SourceControlPanel = lazy(() =>
  import("@/panels/CodebergPanel").then((m) => ({ default: () => <m.CodebergPanel builtin /> })),
);
const TestsPanel = lazy(() => import("@/panels/TestsPanel").then((m) => ({ default: m.TestsPanel })));

function AiMark({ className }: { className?: string; strokeWidth?: number }) {
  const mark = extensionById("ai-assistant");
  if (!mark) return null;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d={mark.path} />
    </svg>
  );
}

function CodebergMark({ className }: { className?: string; strokeWidth?: number }) {
  const mark = extensionById("codeberg");
  if (!mark) return null;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d={mark.path} />
    </svg>
  );
}

function GitHubMark({ className }: { className?: string; strokeWidth?: number }) {
  const mark = extensionById("github");
  if (!mark) return null;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d={mark.path} />
    </svg>
  );
}

export interface PanelDef {
  id: string;
  label: string;

  icon: LucideIcon | ComponentType<{ className?: string; strokeWidth?: number }>;
  component: ComponentType<{ onOpenPanel?: (id: string) => void }>;
  place: "top" | "bottom";

  extension?: string;
}

export const PANELS: PanelDef[] = [
  { id: "project", label: "Explorer", icon: Folder, component: FileTree, place: "top" },
  { id: "search", label: "Search", icon: Search, component: SearchPanel, place: "top" },
  { id: "structure", label: "Structure", icon: Boxes, component: StructurePanel, place: "top" },
  { id: "source-control", label: "Source Control", icon: GitBranch, component: SourceControlPanel, place: "top" },
  { id: "build", label: "Build", icon: Hammer, component: BuildPanel, place: "bottom" },

  { id: "tools", label: "Extensions", icon: Puzzle, component: ToolsPanel, place: "top" },
  {
    id: "ai",
    label: "AI Assistant",
    icon: AiMark,
    component: AiPanel,
    place: "top",
    extension: "ai-assistant",
  },
  {
    id: "codeberg",
    label: "Codeberg",
    icon: CodebergMark,
    component: CodebergPanel,
    place: "top",
    extension: "codeberg",
  },
  {

    id: "github",
    label: "GitHub",
    icon: GitHubMark,
    component: CodebergPanel,
    place: "top",
    extension: "github",
  },
  {

    id: "findings",
    label: "Findings",
    icon: NotebookPen,
    component: FindingsPanel,
    place: "top",
  },
  { id: "problems", label: "Problems", icon: CircleAlert, component: ProblemsPanel, place: "bottom" },
  { id: "tests", label: "Tests", icon: TestTube2, component: TestsPanel, place: "bottom" },
  { id: "debug", label: "Debug", icon: Bug, component: DebugPanel, place: "bottom" },
  { id: "remote", label: "Remote", icon: Server, component: RemotePanel, place: "bottom" },
  { id: "terminal", label: "Terminal", icon: Terminal, component: TerminalPanel, place: "bottom" },
];

export const panelById = (id: string): PanelDef | null =>
  PANELS.find((panel) => panel.id === id) ?? null;

interface ToolButton {
  id: string;
  label: string;
  icon: LucideIcon | ComponentType<{ className?: string; strokeWidth?: number }>;
  open: () => void;
}

const CATCHER_BUTTON: ToolButton = {
  id: "catcher",
  label: "Catcher",
  icon: Radar,
  open: () => useEditor.getState().openCatcher(),
};

const PITCHER_BUTTON: ToolButton = {
  id: "pitcher",
  label: "Pitcher",
  icon: Send,
  open: () => useEditor.getState().openPitcher(),
};

const BROWSER_BUTTON: ToolButton = {
  id: "browser",
  label: "Browser",
  icon: Globe,
  open: () => useEditor.getState().openBrowser(),
};

const CYBERCHEF_BUTTON: ToolButton = {
  id: "cyberchef",
  label: "CyberChef",
  icon: FlaskConical,
  open: () => useEditor.getState().openCyberchef(),
};

const SETTINGS_BUTTON: ToolButton = {
  id: "settings",
  label: "Settings",
  icon: Settings,
  open: () => useEditor.getState().openSettings(),
};

function ActivityButton({
  panel,
  active,
  onSelect,
}: {
  panel: PanelDef;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const Icon = panel.icon;
  const t = useT();

  const label = t(panel.label);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => onSelect(panel.id)}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-md",
        "transition-colors duration-100",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-selected text-fg-bright" : "text-fg-dim hover:bg-hover hover:text-fg",
      )}
    >
      <Icon className="size-6" strokeWidth={1.5} />
    </button>
  );
}

function ToolBarButton({ tool, active }: { tool: ToolButton; active: boolean }) {
  const Icon = tool.icon;
  const t = useT();
  const label = t(tool.label);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={tool.open}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-md",
        "transition-colors duration-100",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-selected text-fg-bright" : "text-fg-dim hover:bg-hover hover:text-fg",
      )}
    >
      <Icon className="size-6" strokeWidth={1.5} />
    </button>
  );
}

export function ActivityBar({
  isActive,
  onSelect,
}: {

  isActive: (id: string) => boolean;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const installed = useExtensions((state) => state.installed);
  const activePath = useEditor((state) => state.activePath);

  const topBuiltin = PANELS.filter((panel) => panel.place === "top" && !panel.extension);
  const topExtension = PANELS.filter((panel) => panel.place === "top" && panel.extension && installed.has(panel.extension));
  const bottom = PANELS.filter((panel) => panel.place === "bottom" && (!panel.extension || installed.has(panel.extension)));
  return (
    <nav
      aria-label={t("Tools")}
      className="flex shrink-0 flex-col items-center gap-1 border-r border-line bg-chrome py-2"
      style={{ width: "var(--w-activitybar)" }}
    >
      {topBuiltin.map((panel) => (
        <ActivityButton key={panel.id} panel={panel} active={isActive(panel.id)} onSelect={onSelect} />
      ))}
      {}
      <ToolBarButton tool={CATCHER_BUTTON} active={activePath === CATCHER_PATH} />
      <ToolBarButton tool={PITCHER_BUTTON} active={activePath === PITCHER_PATH} />
      <ToolBarButton tool={BROWSER_BUTTON} active={activePath === BROWSER_PATH} />
      {installed.has("cyberchef") && (
        <ToolBarButton tool={CYBERCHEF_BUTTON} active={activePath === CYBERCHEF_PATH} />
      )}
      {topExtension.length > 0 && <div className="my-1 h-px w-5 shrink-0 bg-line" />}
      {topExtension.map((panel) => (
        <ActivityButton key={panel.id} panel={panel} active={isActive(panel.id)} onSelect={onSelect} />
      ))}
      <div className="flex-1" />
      {bottom.map((panel) => (
        <ActivityButton key={panel.id} panel={panel} active={isActive(panel.id)} onSelect={onSelect} />
      ))}
      <ToolBarButton tool={SETTINGS_BUTTON} active={activePath === SETTINGS_PATH} />
    </nav>
  );
}
