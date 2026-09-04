import { FolderOpen, Layers, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { nameProblem } from "@/lib/fileTypes";
import { useT } from "@/lib/i18n";
import { basename } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/stores/workspace";

interface Draft {
  path: string;
  name: string;
}

export function NewWorkflowDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [folders, setFolders] = useState<Draft[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameField.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addFolder = async () => {
    const chosen = await bridge.openFolder();
    if (!chosen?.path) return;
    setError("");
    setFolders((current) =>

      current.some((folder) => folder.path.toLowerCase() === chosen.path.toLowerCase())
        ? current
        : [...current, { path: chosen.path, name: chosen.name || basename(chosen.path) }],
    );
  };

  const chooseLocation = async () => {
    const chosen = await bridge.openFolder();
    if (chosen?.path) {
      setLocation(chosen.path);
      setError("");
    }
  };

  const trimmed = name.trim();
  const problem = nameProblem(name);
  const fileName = trimmed ? `${trimmed}.wideflow` : "";
  const ready = Boolean(trimmed) && !problem && Boolean(location) && folders.length > 0 && !busy;

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");

    const failure = await useWorkspace.getState().createWorkflow(`${location}\\${fileName}`, folders);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    onClose();
  };

  return (
    <div
      className="wide-enter-fade fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("New workflow")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="wide-enter-fade flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-lg border border-line bg-chrome shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
          <Layers className="size-4 shrink-0 text-fg-dim" strokeWidth={1.5} />
          <span className="flex-1 text-[13px] text-fg-bright">{t("New workflow")}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <p className="text-[11px] leading-relaxed text-fg-faint">
            {t(
              "A workflow opens several folders in one window. They can be anywhere on the disk and need not be related.",
            )}
          </p>

          {}
          <div className="pt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] text-fg-dim">{t("Folders")}</span>
              {folders.length > 0 && (
                <span className="text-[10px] tabular-nums text-fg-faint">{folders.length}</span>
              )}
            </div>
            <div className="mt-1 rounded-md border border-line">
              {folders.length === 0 ? (
                <p className="px-2 py-3 text-[12px] text-fg-faint">{t("No folders added yet.")}</p>
              ) : (
                folders.map((folder, index) => (
                  <div
                    key={folder.path}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5",
                      index < folders.length - 1 && "border-b border-line",
                    )}
                  >
                    {

}
                    <input
                      value={folder.name}
                      onChange={(event) =>
                        setFolders((current) =>
                          current.map((item, at) =>
                            at === index ? { ...item, name: event.target.value } : item,
                          ),
                        )
                      }
                      spellCheck={false}
                      aria-label={t("Name in the tree")}
                      className="w-40 shrink-0 rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[12px] text-fg outline-none focus:border-accent"
                    />
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-faint"
                      title={folder.path}
                    >
                      {folder.path}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFolders((current) => current.filter((_, at) => at !== index))}
                      aria-label={t("Remove")}
                      className="shrink-0 rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
                    >
                      <Trash2 className="size-3" strokeWidth={1.5} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => void addFolder()}
              className="mt-1 flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-[12px] text-fg transition-colors duration-100 hover:bg-hover"
            >
              <FolderOpen className="size-3.5" strokeWidth={1.5} />
              {t("Add folder")}
            </button>
          </div>

          {}
          <label className="mt-4 flex flex-col gap-1">
            <span className="text-[11px] text-fg-dim">{t("Workflow name")}</span>
            <div className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 focus-within:border-accent">
              <input
                ref={nameField}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("without the extension")}
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-fg outline-none placeholder:text-fg-faint"
              />
              <span className="shrink-0 font-mono text-[13px] text-fg-faint">.wideflow</span>
            </div>
          </label>
          {problem && <p className="pt-1 text-[11px] text-rose-300">{t(problem)}</p>}

          <div className="pt-3">
            <span className="text-[11px] text-fg-dim">{t("Save the workflow in")}</span>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md border border-line bg-panel px-2 py-1.5 text-[12px]",
                  location ? "text-fg" : "text-fg-faint",
                )}
                title={location}
              >
                {location || t("No folder chosen yet")}
              </span>
              <button
                type="button"
                onClick={() => void chooseLocation()}
                className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-fg transition-colors duration-100 hover:bg-hover"
              >
                <FolderOpen className="size-3.5" strokeWidth={1.5} />
                {t("Choose")}
              </button>
            </div>
            <p className="pt-1 text-[10px] leading-snug text-fg-faint">
              {t(
                "Folder paths are stored relative to this file where they can be, so a workflow committed beside its folders still works after a clone.",
              )}
            </p>
          </div>

          {error && <p className="pt-2 text-[11px] text-rose-300">{t(error)}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-faint">
            {fileName && location ? `${location}\\${fileName}` : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-line px-3 py-1 text-[12px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => void create()}
            className="shrink-0 rounded-md border border-accent px-3 py-1 text-[12px] text-accent transition-colors duration-100 hover:bg-accent hover:text-bg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-accent"
          >
            {busy ? t("Working…") : t("Create")}
          </button>
        </div>
      </div>
    </div>
  );
}
