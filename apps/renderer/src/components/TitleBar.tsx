import { ChevronDown, Command, GitBranch, Globe, Search, Settings } from "lucide-react";
import type { ReactNode } from "react";

import logo from "@/assets/wide-logo.png";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCodeberg } from "@/stores/codeberg";
import { useCommandPalette } from "@/stores/commands";
import { useEditor } from "@/stores/editor";
import { useExtensions } from "@/stores/extensions";
import { useWorkspace } from "@/stores/workspace";

function TitleButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "no-drag flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-fg-dim",
        "transition-colors duration-100 hover:bg-hover hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      {children}
    </button>
  );
}

export function TitleBar({ onOpenPanel }: { onOpenPanel: (id: string) => void }) {
  const openSettings = useEditor((state) => state.openSettings);
  const rootName = useWorkspace((state) => state.rootName);

  const workflowName = useWorkspace((state) => state.workflowName);
  const projectLabel = workflowName || rootName;

  const hasCodeberg = useExtensions((state) => state.installed.has("codeberg"));
  const branch = useCodeberg((state) =>
    state.status?.repository ? (state.status.branch?.name ?? "") : "",
  );

  const hasBrowser = useExtensions((state) => state.installed.has("browser"));
  const openBrowser = useEditor((state) => state.openBrowser);
  const openFolder = useWorkspace((state) => state.openFolder);
  const t = useT();

  return (
    <header
      className={cn(

        "drag-region flex shrink-0 items-center gap-1 border-b border-line bg-chrome pr-[140px]",
      )}
      style={{ height: "var(--h-titlebar)" }}
    >
      {

}
      {

}
      <span className="flex shrink-0 items-center justify-center" style={{ width: "var(--w-activitybar)" }}>
        <img
          src={logo}
          alt=""
          width={44}
          height={44}
          aria-hidden="true"
          draggable={false}
          className="size-11 shrink-0 select-none"
        />
      </span>

      <TitleButton title={t("Project")} onClick={openFolder}>
        <span className="max-w-48 truncate text-fg">{projectLabel || t("Open project")}</span>
        <ChevronDown className="size-3 shrink-0" strokeWidth={2} />
      </TitleButton>

      {hasCodeberg && branch && (
        <span
          title={t("Git branch")}
          className="wide-enter-fade ml-1 flex shrink-0 items-center gap-1 text-fg-dim"
        >
          <GitBranch className="size-3" strokeWidth={1.75} />
          <span className="max-w-32 truncate text-[11px]">{branch}</span>
        </span>
      )}

      <div className="flex-1" />

      {hasBrowser && (
        <TitleButton title={t("Open a web page inside Wide")} onClick={openBrowser}>
          <Globe className="size-3.5" strokeWidth={1.5} />
        </TitleButton>
      )}
      <TitleButton title={t("Command palette — every action (Ctrl+Shift+P)")} onClick={() => useCommandPalette.getState().openPalette()}>
        <Command className="size-3.5" strokeWidth={1.5} />
      </TitleButton>
      <TitleButton title={t("Search in project (Ctrl+Shift+F)")} onClick={() => onOpenPanel("search")}>
        <Search className="size-3.5" strokeWidth={1.5} />
      </TitleButton>
      <TitleButton title={t("Settings")} onClick={openSettings}>
        <Settings className="size-3.5" strokeWidth={1.5} />
      </TitleButton>
    </header>
  );
}
