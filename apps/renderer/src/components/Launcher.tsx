import {
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  Layers,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { fileMark } from "@/lib/fileIcons";
import { NewFileDialog } from "./NewFileDialog";
import { NewWorkflowDialog } from "./NewWorkflowDialog";

import { bridge, type Project } from "@/lib/bridge";
import logo from "@/assets/wide-logo.png";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";

function ActionRow({
  icon: Icon,
  label,
  shortcut,
  title,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left",
        "transition-colors duration-100 hover:bg-hover",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <Icon className="size-4 shrink-0 text-fg-dim transition-colors duration-100 group-hover:text-fg" strokeWidth={1.5} />
      <span className="flex-1 text-[13.5px] text-fg">{label}</span>
      {shortcut && <span className="shrink-0 font-mono text-[11px] text-fg-faint">{shortcut}</span>}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-7">
      <p className="text-[10px] uppercase tracking-[0.13em] text-fg-faint">{title}</p>
      <div className="mt-1.5 border-t border-line" />
      <div className="mt-1 flex flex-col">{children}</div>
    </div>
  );
}

export function Launcher() {
  const [recents, setRecents] = useState<Project[]>([]);

  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const openFolder = useWorkspace((state) => state.openFolder);
  const openFileFromDisk = useWorkspace((state) => state.openFileFromDisk);
  const adoptNewFile = useWorkspace((state) => state.adoptNewFile);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newWorkflowOpen, setNewWorkflowOpen] = useState(false);
  const openWorkflow = useWorkspace((state) => state.openWorkflow);
  const openPath = useWorkspace((state) => state.openPath);
  const openRecentFile = useWorkspace((state) => state.openRecentFile);
  const error = useWorkspace((state) => state.error);
  const openSettings = useEditor((state) => state.openSettings);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const ask = () => {
      bridge
        .recentProjects()
        .then((result) => {
          if (cancelled) return;
          setRecents(result?.projects ?? []);
          setLoaded(true);
        })
        .catch(() => {
          if (cancelled) return;
          attempt += 1;
          if (attempt > 8) {
            setLoaded(true);
            return;
          }
          timer = setTimeout(ask, Math.min(150 * 2 ** (attempt - 1), 1200));
        });
    };
    ask();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const open = async (project: Project) => {
    if (project.missing || busy) return;
    setBusy(project.path);
    const kind = project.kind ?? "folder";
    const ok =
      kind === "workflow"
        ? await openWorkflow(project.path)
        : kind === "file"
          ? await openRecentFile(project.path)
          : await openPath(project.path);
    if (!ok) setBusy(null);
  };

  const pickWorkflow = async () => {
    const picked = await bridge.openFile();
    if (!picked) return;
    if (!picked.path.toLowerCase().endsWith(".wideflow")) {
      useWorkspace.setState({ error: t("That is not a Wide workflow file.") });
      return;
    }
    await openWorkflow(picked.path);
  };

  const ICONS = { folder: Folder, file: FileText, workflow: Layers } as const;

  const shown = recents.slice(0, 4);

  return (
    <div className="flex h-full flex-col overflow-auto bg-canvas">
      <div className="wide-enter mx-auto w-full max-w-[460px] px-6 pb-12 pt-[12vh]">
        {

}
        <div className="flex items-center gap-3.5">
          <img
            src={logo}
            alt="Wide"
            width={88}
            height={88}
            className="block size-[88px] shrink-0 select-none"
            draggable={false}
          />
          <div className="min-w-0">
            <h1 className="text-[19px] font-semibold leading-tight text-fg-bright">{t("Welcome to Wide")}</h1>
            <p className="text-[13px] italic text-fg-muted">{t("The IDE for building and testing the web")}</p>
          </div>
        </div>

        <Section title={t("Get started")}>
          <ActionRow icon={FilePlus2} label={t("New file")} onClick={() => setNewFileOpen(true)} />
          <ActionRow icon={FolderOpen} label={t("Open folder")} onClick={() => void openFolder()} />
          <ActionRow
            icon={FileText}
            label={t("Open file")}
            title={t("Opens the folder around it as the project")}
            onClick={() => void openFileFromDisk()}
          />
        </Section>

        <Section title={t("Workspace")}>
          <ActionRow
            icon={Layers}
            label={t("New workflow")}
            title={t("Several folders open in one window")}
            onClick={() => setNewWorkflowOpen(true)}
          />
          <ActionRow icon={FolderOpen} label={t("Open workflow")} onClick={() => void pickWorkflow()} />
        </Section>

        <Section title={t("Configure")}>
          <ActionRow icon={Settings} label={t("Settings")} onClick={openSettings} />
        </Section>

        {error && <p className="pt-4 text-[12px] text-status-error">{t(error)}</p>}

        {
}
        <div className="pt-7">
          <p className="text-[10px] uppercase tracking-[0.13em] text-fg-faint">{t("Recent")}</p>
          <div className="mt-1.5 border-t border-line" />
          {!loaded ? (

            <div className="mt-2 h-[76px]" aria-hidden="true" />
          ) : recents.length === 0 ? (
            <p className="mt-2 rounded-md border border-line px-3 py-6 text-center text-[12px] text-fg-faint">
              {t("Projects you open will be listed here.")}
            </p>
          ) : (
            <div className="mt-2 flex flex-col rounded-md border border-line p-1">
              {shown.map((project, index) => (
                <div
                  key={project.path}
                  onMouseMove={() => setSelected(index)}
                  className={cn(
                    "group flex items-center gap-1 rounded-md pr-2 transition-colors duration-100",
                    index === selected && !project.missing && "bg-hover",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void open(project)}
                    disabled={project.missing || Boolean(busy)}
                    title={project.path}
                    aria-current={index === selected}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-left",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      project.missing && "cursor-default",
                    )}
                  >
                    {(() => {

                      const kind = project.kind ?? "folder";
                      const mark = kind === "file" ? fileMark(project.name) : null;
                      if (mark && !project.missing) {
                        if (mark.kind === "icon") {
                          const Glyph = mark.Icon;
                          return (
                            <Glyph
                              className="size-3.5 shrink-0"
                              strokeWidth={1.5}
                              style={{ color: mark.colour }}
                            />
                          );
                        }
                        return (
                          <svg
                            viewBox="0 0 24 24"
                            className="size-3.5 shrink-0"
                            fill={mark.colour}
                            aria-hidden="true"
                          >
                            <path d={mark.path} />
                          </svg>
                        );
                      }
                      const Icon = ICONS[kind];
                      return (
                        <Icon
                          className={cn(
                            "size-3.5 shrink-0",
                            project.missing ? "text-fg-faint" : "text-fg-dim",
                          )}
                          strokeWidth={1.5}
                        />
                      );
                    })()}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={cn(
                          "truncate text-[13px]",
                          project.missing
                            ? "text-fg-faint line-through"
                            : index === selected
                              ? "text-fg-bright"
                              : "text-fg",
                        )}
                      >
                        {project.name}
                      </span>
                      <span className="truncate text-[11px] text-fg-faint">{project.path}</span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {newWorkflowOpen && <NewWorkflowDialog onClose={() => setNewWorkflowOpen(false)} />}
      {newFileOpen && (
        <NewFileDialog
          onClose={() => setNewFileOpen(false)}
          onCreate={(folder, filePath) => {
            setNewFileOpen(false);
            void adoptNewFile(folder, filePath);
          }}
        />
      )}
    </div>
  );
}
