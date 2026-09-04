import { CaseSensitive, ChevronDown, ChevronRight, Regex, WholeWord } from "lucide-react";
import { useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import { useT } from "@/lib/i18n";
import { cn, normalisePath } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { useSearch, type SearchFlags } from "@/stores/search";
import { useWorkspace } from "@/stores/workspace";

const FLAGS: { key: keyof SearchFlags; icon: typeof Regex; title: string }[] = [
  { key: "caseSensitive", icon: CaseSensitive, title: "Match case" },
  { key: "wholeWord", icon: WholeWord, title: "Match whole word" },
  { key: "regexp", icon: Regex, title: "Use regular expression" },
];

export function SearchPanel() {
  const query = useSearch((state) => state.query);
  const flags = useSearch((state) => state.flags);
  const files = useSearch((state) => state.files);
  const total = useSearch((state) => state.total);
  const truncated = useSearch((state) => state.truncated);
  const running = useSearch((state) => state.running);
  const error = useSearch((state) => state.error);
  const collapsed = useSearch((state) => state.collapsed);
  const setQuery = useSearch((state) => state.setQuery);
  const toggleFlag = useSearch((state) => state.toggleFlag);
  const toggleFile = useSearch((state) => state.toggleFile);

  const root = useWorkspace((state) => state.root);
  const revealAt = useEditor((state) => state.revealAt);
  const t = useT();
  const [replacement, setReplacement] = useState("");
  const [notice, setNotice] = useState("");

  const relative = (path: string) =>
    root ? normalisePath(path).slice(normalisePath(root).length + 1) : normalisePath(path);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Search")} />

      <div className="shrink-0 border-b border-line px-2 py-2">
        <div className="flex items-center gap-1 rounded-md border border-line bg-panel px-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search in project")}
            aria-label={t("Search in project")}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint"
          />
          {FLAGS.map(({ key, icon: Icon, title }) => (
            <button
              key={key}
              type="button"
              title={t(title)}
              aria-label={t(title)}
              aria-pressed={flags[key]}
              onClick={() => toggleFlag(key)}
              className={cn(
                "flex size-5 items-center justify-center rounded-sm transition-colors duration-100",
                flags[key] ? "bg-selected text-fg-bright" : "text-fg-dim hover:bg-hover hover:text-fg",
              )}
            >
              <Icon className="size-3" strokeWidth={1.5} />
            </button>
          ))}
        </div>

        {
}
        <div className="mt-1.5 flex items-center gap-1">
          <input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder={t("Replace")}
            aria-label={t("Replace")}
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint"
          />
          <button
            type="button"
            disabled={running || query.trim().length < 2 || files.length === 0}
            onClick={() => {
              setNotice("");
              void useSearch
                .getState()
                .replaceAll(replacement)
                .then((result) => {
                  setNotice(
                    t("Replaced {n} matches in {f} files.", { n: result.replacements, f: result.filesChanged }) +
                      (result.skipped ? " " + t("{s} unsaved files were skipped.", { s: result.skipped }) : ""),
                  );
                });
            }}
            title={t("Replace all")}
            aria-label={t("Replace all")}
            className="shrink-0 rounded-md border border-line px-2 py-1.5 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
          >
            {t("Replace all")}
          </button>
        </div>
        {notice && <p className="pt-1 text-[11px] text-emerald-300">{notice}</p>}

        <p className="pt-1.5 text-[11px] text-fg-faint">
          {error
            ? error
            : running
              ? t("Searching…")
              : query.trim().length < 2
                ? t("Type at least two characters.")
                :

                  t(
                    files.length === 1
                      ? total === 1
                        ? "{total} result in one file"
                        : "{total} results in one file"
                      : total === 1
                        ? "{total} result in {files} files"
                        : "{total} results in {files} files",
                    { total, files: files.length },
                  ) + (truncated ? t(" (truncated)") : "")}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {files.map((file) => {
          const isCollapsed = collapsed.has(file.path);
          return (
            <div key={file.path}>
              <button
                type="button"
                onClick={() => toggleFile(file.path)}
                title={file.path}
                className="flex w-full items-center gap-1 px-2 text-left text-[12px] text-fg-muted transition-colors duration-100 hover:bg-hover"
                style={{ height: "var(--h-row)" }}
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3 shrink-0" strokeWidth={2} />
                ) : (
                  <ChevronDown className="size-3 shrink-0" strokeWidth={2} />
                )}
                <span className="truncate">{relative(file.path)}</span>
                <span className="ml-auto shrink-0 tabular-nums text-fg-faint">{file.matches.length}</span>
              </button>

              {!isCollapsed &&
                file.matches.map((match, index) => (
                  <button
                    key={`${file.path}:${match.line}:${index}`}
                    type="button"
                    onClick={() => void revealAt(file.path, match.line, match.column)}
                    className="flex w-full items-center gap-2 pl-7 pr-2 text-left text-[12px] transition-colors duration-100 hover:bg-hover"
                    style={{ height: "var(--h-row)" }}
                  >
                    <span className="shrink-0 tabular-nums text-fg-faint">{match.line}</span>
                    <span className="truncate font-mono text-fg-dim">{match.preview}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
