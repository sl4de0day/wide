import {
  ArrowDownToLine,
  ArrowRightToLine,
  ArrowUpFromLine,
  Bug,
  Circle,
  Globe,
  ChevronDown,
  ChevronRight,
  Play,
  Plus,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import { useT } from "@/lib/i18n";
import { basename } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useDebug, urlToPath } from "@/stores/debug";
import { useActiveTab, useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";

const RUNNABLE = new Set(["js", "mjs", "cjs", "py", "pyw", "go", "rb"]);

function Controls() {
  const t = useT();
  const running = useDebug((state) => state.running);
  const paused = useDebug((state) => state.paused);
  const tab = useActiveTab();
  const root = useWorkspace((state) => state.root);

  const canDebug =
    tab?.kind === "file" && RUNNABLE.has((tab.name.split(".").pop() ?? "").toLowerCase());

  const control = (run: () => void, icon: React.ReactNode, label: string, on: boolean) => (
    <button
      type="button"
      onClick={run}
      disabled={!on}
      title={label}
      aria-label={label}
      className="rounded-sm p-1 text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-30"
    >
      {icon}
    </button>
  );

  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-2 py-1.5">
      {!running ? (
        <>
          <button
            type="button"
            onClick={async () => {
              if (!tab || tab.kind !== "file") return;
              await useEditor.getState().saveActive();
              void useDebug.getState().start(root ?? "", tab.path);
            }}
            disabled={!canDebug}
            title={canDebug ? t("Debug {name}", { name: tab?.name ?? "" }) : t("Open a .js file to debug")}
            className="flex items-center gap-1.5 rounded-md border border-accent px-2.5 py-1 text-[11px] text-accent transition-colors duration-100 hover:bg-accent hover:text-bg disabled:opacity-40"
          >
            <Bug className="size-3.5" strokeWidth={1.75} />
            {t("Debug")}
          </button>
          {}
          <button
            type="button"
            onClick={() => void useDebug.getState().startBrowser()}
            title={t("Debug the browser page")}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <Globe className="size-3.5" strokeWidth={1.75} />
            {t("Browser")}
          </button>
        </>
      ) : (
        <>
          {control(() => void useDebug.getState().resume(), <Play className="size-4" strokeWidth={2} fill="currentColor" />, t("Continue"), paused)}
          {control(() => void useDebug.getState().stepOver(), <ArrowRightToLine className="size-4" strokeWidth={2} />, t("Step over"), paused)}
          {control(() => void useDebug.getState().stepInto(), <ArrowDownToLine className="size-4" strokeWidth={2} />, t("Step into"), paused)}
          {control(() => void useDebug.getState().stepOut(), <ArrowUpFromLine className="size-4" strokeWidth={2} />, t("Step out"), paused)}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void useDebug.getState().stop()}
            title={t("Stop")}
            aria-label={t("Stop")}
            className="rounded-sm p-1 text-status-error transition-colors duration-100 hover:bg-hover"
          >
            <Square className="size-3.5" strokeWidth={2} fill="currentColor" />
          </button>
        </>
      )}
    </div>
  );
}

function CallStack() {
  const t = useT();
  const frames = useDebug((state) => state.frames);
  const active = useDebug((state) => state.activeFrame);
  if (frames.length === 0) return null;
  return (
    <div className="shrink-0 border-b border-line">
      <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-fg-faint">{t("Call stack")}</p>
      {frames.map((frame, index) => (
        <button
          key={frame.id}
          type="button"
          onClick={() => useDebug.getState().selectFrame(index)}
          className={cn(
            "flex w-full items-baseline gap-2 px-3 py-1 text-left transition-colors duration-100",
            index === active ? "bg-selected" : "hover:bg-hover",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{frame.name}</span>
          <span className="shrink-0 text-[10px] text-fg-faint">
            {basename(urlToPath(frame.url))}:{frame.line + 1}
          </span>
        </button>
      ))}
    </div>
  );
}

function BreakpointRow({ file, line }: { file: string; line: number }) {
  const t = useT();
  const key = `${file}:${line}`;
  const storedCondition = useDebug((state) => state.conditions[key] ?? "");
  const storedLog = useDebug((state) => state.logMessages[key] ?? "");
  const [condition, setCondition] = useState(storedCondition);
  const [log, setLog] = useState(storedLog);
  useEffect(() => setCondition(storedCondition), [storedCondition]);
  useEffect(() => setLog(storedLog), [storedLog]);

  const inputClass = cn(
    "min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] text-fg-dim outline-none placeholder:text-fg-faint",
    "hover:border-line focus:border-accent focus:bg-bg",
  );

  return (
    <div className="flex items-start gap-1.5 py-0.5 pl-2 pr-2">
      <button
        type="button"
        onClick={() => void useEditor.getState().revealAt(file, line + 1, 1)}
        title={`${file}:${line + 1}`}
        className="flex min-w-0 shrink-0 items-center gap-1.5 pt-0.5 text-left"
      >
        <Circle
          className={cn(
            "size-2.5 shrink-0",
            storedLog ? "fill-status-warn text-status-warn" : "fill-status-error text-status-error",
          )}
          strokeWidth={0}
        />
        <span className="truncate text-[11px] text-fg">
          {basename(file)}:{line + 1}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <input
          value={condition}
          onChange={(event) => setCondition(event.target.value)}
          onBlur={() => condition !== storedCondition && useDebug.getState().setCondition(file, line, condition)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setCondition(storedCondition);
          }}
          placeholder={t("condition")}
          spellCheck={false}
          className={inputClass}
        />
        <input
          value={log}
          onChange={(event) => setLog(event.target.value)}
          onBlur={() => log !== storedLog && useDebug.getState().setLogMessage(file, line, log)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setLog(storedLog);
          }}
          placeholder={t("log message, {expr} to interpolate")}
          spellCheck={false}
          className={inputClass}
        />
      </div>
    </div>
  );
}

function PauseOnExceptions() {
  const t = useT();
  const mode = useDebug((state) => state.pauseOnExceptions);
  const options: { id: "none" | "uncaught" | "all"; label: string }[] = [
    { id: "none", label: t("Off") },
    { id: "uncaught", label: t("Uncaught") },
    { id: "all", label: t("All") },
  ];
  return (
    <div className="flex items-center gap-1 px-3 pb-1.5 pt-1">
      <span className="mr-1 text-[10px] text-fg-faint">{t("Pause on exceptions")}</span>
      <div className="flex overflow-hidden rounded-sm border border-line">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => useDebug.getState().setPauseOnExceptions(option.id)}
            className={cn(
              "px-1.5 py-0.5 text-[10px] transition-colors duration-100",
              mode === option.id ? "bg-selected text-fg-bright" : "text-fg-faint hover:bg-hover hover:text-fg",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Breakpoints() {
  const t = useT();
  const breakpoints = useDebug((state) => state.breakpoints);
  const rows = Object.entries(breakpoints)
    .flatMap(([file, lines]) => lines.map((line) => ({ file, line })))
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return (
    <div className="max-h-48 shrink-0 overflow-auto border-b border-line">
      <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-fg-faint">{t("Breakpoints")}</p>
      <PauseOnExceptions />
      {rows.map((row) => (
        <BreakpointRow key={`${row.file}:${row.line}`} file={row.file} line={row.line} />
      ))}
    </div>
  );
}

function Watches() {
  const t = useT();
  const watches = useDebug((state) => state.watches);
  const [draft, setDraft] = useState("");
  return (
    <div className="max-h-40 shrink-0 overflow-auto border-b border-line">
      <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-fg-faint">{t("Watch")}</p>
      {watches.map((watch, index) => (
        <div key={`${watch.expr}-${index}`} className="group flex items-baseline gap-2 py-0.5 pl-3 pr-2">
          <span className="shrink-0 font-mono text-[11px] text-accent">{watch.expr}</span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-[11px]",
              watch.error ? "text-status-error" : "text-fg-dim",
            )}
            title={watch.value ?? ""}
          >
            {watch.value ?? "—"}
          </span>
          <button
            type="button"
            onClick={() => useDebug.getState().removeWatch(index)}
            title={t("Remove")}
            className="shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        </div>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void useDebug.getState().addWatch(draft);
          setDraft("");
        }}
        className="flex items-center gap-1.5 px-3 py-1"
      >
        <Plus className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("Add expression")}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-fg outline-none placeholder:text-fg-faint"
        />
      </form>
    </div>
  );
}

function Variables() {
  const t = useT();
  const scopes = useDebug((state) => state.scopes);
  const paused = useDebug((state) => state.paused);
  if (!paused) return null;
  return (
    <div className="min-h-0 flex-1 overflow-auto border-b border-line">
      <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-fg-faint">{t("Variables")}</p>
      {scopes.map((scope, index) => (
        <div key={`${scope.name}-${index}`}>
          <button
            type="button"
            onClick={() => void useDebug.getState().toggleScope(index)}
            className="flex w-full items-center gap-1 px-2 py-1 text-left transition-colors duration-100 hover:bg-hover"
          >
            {scope.open ? (
              <ChevronDown className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
            ) : (
              <ChevronRight className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
            )}
            <span className="text-[12px] text-fg">{scope.name}</span>
          </button>
          {scope.open &&
            (scope.properties ?? []).map((prop) => (
              <div key={prop.name} className="flex items-baseline gap-2 py-0.5 pl-7 pr-2">
                <span className="shrink-0 font-mono text-[11px] text-accent">{prop.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-dim" title={prop.value}>
                  {prop.value}
                </span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function Output() {
  const t = useT();
  const output = useDebug((state) => state.output);
  const running = useDebug((state) => state.running);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [output.length]);

  const color = (level: string) =>
    level === "error" || level === "stderr"
      ? "text-status-error"
      : level === "info"
        ? "text-fg-faint"
        : level === "input"
          ? "text-accent"
          : level === "result"
            ? "text-fg"
            : "text-fg-dim";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-fg-faint">{t("Output")}</p>
      <div className="min-h-0 flex-1 overflow-auto">
        {output.length === 0 ? (
          <p className="px-3 py-1 text-[11px] text-fg-faint">{t("Nothing yet.")}</p>
        ) : (
          <div className="px-3 pb-2 font-mono text-[11px] leading-relaxed">
            {output.map((line, index) => (
              <div key={index} className={cn("whitespace-pre-wrap break-all", color(line.level))}>
                {line.text}
              </div>
            ))}
            <div ref={end} />
          </div>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void useDebug.getState().evalConsole(draft);
          setDraft("");
        }}
        className="flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-1.5"
      >
        <ChevronRight className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!running}
          placeholder={running ? t("Evaluate an expression") : t("Start a session to use the console")}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-fg outline-none placeholder:text-fg-faint disabled:opacity-50"
        />
      </form>
    </div>
  );
}

export function DebugPanel() {
  const t = useT();
  const error = useDebug((state) => state.error);
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Debug")} />
      <Controls />
      {error && (
        <button
          type="button"
          onClick={() => useDebug.setState({ error: "" })}
          className="wide-enter-fade shrink-0 border-b border-line px-3 py-1.5 text-left text-[11px] text-status-error"
        >
          {t(error)}
        </button>
      )}
      <Breakpoints />
      <CallStack />
      <Watches />
      <Variables />
      <Output />
    </div>
  );
}
