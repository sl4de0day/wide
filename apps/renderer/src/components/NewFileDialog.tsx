import { Check, FolderOpen, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { DEFAULT_FILE_TYPE, FILE_TYPES, nameProblem, type FileType } from "@/lib/fileTypes";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function NewFileDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;

  onCreate: (folder: string, filePath: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [type, setType] = useState<FileType>(DEFAULT_FILE_TYPE);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
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

  const types = useMemo(() => {
    const raw = query.trim().toLowerCase().replace(/^\./, "");
    if (!raw) return FILE_TYPES;
    return FILE_TYPES.filter(
      (candidate) =>
        candidate.extension.includes(raw) || candidate.language.toLowerCase().includes(raw),
    );
  }, [query]);

  const trimmed = name.trim();
  const problem = nameProblem(name);
  const fileName = trimmed ? `${trimmed}.${type.extension}` : "";
  const ready = Boolean(trimmed) && !problem && Boolean(folder) && !busy;

  const chooseFolder = async () => {
    const chosen = await bridge.openFolder();
    if (chosen?.path) {
      setFolder(chosen.path);
      setError("");
    }
  };

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    const result = await bridge.create(folder, fileName, "file");
    setBusy(false);
    if (!result || "error" in result) {
      setError((result as { error?: string })?.error ?? t("That file could not be created."));
      return;
    }
    onCreate(folder, (result as { path: string }).path);
  };

  return (
    <div
      className="wide-enter-fade fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("New file")}
      onMouseDown={(event) => {

        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="wide-enter-fade flex max-h-[80vh] w-full max-w-[520px] flex-col rounded-lg border border-line bg-chrome shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="flex-1 text-[13px] text-fg-bright">{t("New file")}</span>
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
          {}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-dim">{t("File name")}</span>
            <div className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 focus-within:border-accent">
              <input
                ref={nameField}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void create();
                }}
                placeholder={t("without the extension")}
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-fg outline-none placeholder:text-fg-faint"
              />
              <span className="shrink-0 font-mono text-[13px] text-fg-faint">.{type.extension}</span>
            </div>
          </label>
          {problem && <p className="pt-1 text-[11px] text-rose-300">{t(problem)}</p>}

          {}
          <div className="pt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] text-fg-dim">{t("File type")}</span>
              <span className="text-[10px] tabular-nums text-fg-faint">
                {t("{count} supported", { count: FILE_TYPES.length })}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1 rounded-md border border-line bg-panel px-2">
              <Search className="size-3 shrink-0 text-fg-faint" strokeWidth={1.5} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Search file types")}
                aria-label={t("Search file types")}
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint"
              />
            </div>
            <div className="mt-1 max-h-[190px] overflow-auto rounded-md border border-line">
              {types.length === 0 && (
                <p className="px-2 py-3 text-[12px] text-fg-faint">{t("No file type matches that.")}</p>
              )}
              {types.map((candidate) => {
                const chosen =
                  candidate.extension === type.extension && candidate.language === type.language;
                return (
                  <button
                    key={`${candidate.language}:${candidate.extension}`}
                    type="button"
                    onClick={() => setType(candidate)}
                    className={cn(
                      "flex w-full items-center gap-2 px-2 py-1 text-left transition-colors duration-100",
                      chosen ? "bg-selected" : "hover:bg-hover",
                    )}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-3.5 shrink-0"
                      fill={candidate.colour}
                      aria-hidden="true"
                    >
                      <path d={candidate.path} />
                    </svg>
                    <span className="w-20 shrink-0 font-mono text-[12px] text-fg">
                      .{candidate.extension}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-fg-dim">
                      {candidate.language}
                    </span>
                    {chosen && <Check className="size-3 shrink-0 text-accent" strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
          </div>

          {}
          <div className="pt-3">
            <span className="text-[11px] text-fg-dim">{t("Location")}</span>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md border border-line bg-panel px-2 py-1.5 text-[12px]",
                  folder ? "text-fg" : "text-fg-faint",
                )}
                title={folder}
              >
                {folder || t("No folder chosen yet")}
              </span>
              <button
                type="button"
                onClick={() => void chooseFolder()}
                className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-fg transition-colors duration-100 hover:bg-hover"
              >
                <FolderOpen className="size-3.5" strokeWidth={1.5} />
                {t("Choose")}
              </button>
            </div>
            <p className="pt-1 text-[10px] leading-snug text-fg-faint">
              {t("This folder opens as the project, so the file is ready to edit straight away.")}
            </p>
          </div>

          {error && <p className="pt-2 text-[11px] text-rose-300">{t(error)}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-faint">
            {fileName && folder ? `${folder}\\${fileName}` : ""}
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
