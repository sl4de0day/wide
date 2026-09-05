import { ArrowDown, AtSign, Check, ChevronDown, ChevronRight, Copy, Send, Square, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModelPicker, useModelLabel } from "@/components/ai/ModelPicker";
import { bridge } from "@/lib/bridge";
import { useT, type Values } from "@/lib/i18n";
import { createStripper, plainText } from "@/lib/plainText";
import { basename, cn } from "@/lib/utils";
import { useAi, type AiToolStep, type AiTurn } from "@/stores/ai";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";

const kept: Record<string, { draft: string; scroll: number; pinned: boolean }> = {};
const keptFor = (id: string) => (kept[id] ??= { draft: "", scroll: 0, pinned: true });

const unfolded: Record<string, boolean> = {};

const NOTHING_ATTACHED: string[] = [];

const BODY = "text-[13px] leading-relaxed text-fg";

const QUESTION = "data-question";

function stepCount(t: (text: string, values?: Values) => string, count: number) {
  return count === 1 ? t("1 step") : t("{count} steps", { count });
}

function tokens(total: number): string {
  if (total < 1000) return String(total);
  const thousands = total / 1000;
  return `${thousands.toFixed(thousands >= 10 ? 0 : 1)}k`;
}

function resolvePath(root: string, path: string): string {
  if (!path) return "";
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\")) return path;
  if (!root) return "";
  const separator = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  const rest = separator === "\\" ? path.replace(/\//g, "\\") : path.replace(/\\/g, "/");
  return `${base}${separator}${rest}`;
}

function stepTarget(step: AiToolStep): string {
  const input = step.input as { path?: string; query?: string } | null;
  return String(input?.path ?? input?.query ?? "");
}

const OPENS_A_FILE = new Set(["read_file", "open_file", "write_file"]);

function Steps({
  steps,
  streaming,
  turnId,
  onFailure,
}: {
  steps: AiToolStep[];
  streaming: boolean;
  turnId: string;
  onFailure: (message: string) => void;
}) {
  const t = useT();
  const root = useWorkspace((state) => state.root) ?? "";
  const [open, setOpen] = useState(() => unfolded[turnId] === true);
  const folded = !streaming && !open;

  const unfold = (next: boolean) => {
    unfolded[turnId] = next;
    setOpen(next);
  };

  const names = useMemo(() => {
    const seen: string[] = [];
    for (const step of steps) if (!seen.includes(step.name)) seen.push(step.name);
    return seen;
  }, [steps]);

  if (folded) {
    return (
      <button
        type="button"
        onClick={() => unfold(true)}
        className={cn("mb-2 flex w-full items-center gap-1.5 text-left hover:text-fg-bright", BODY)}
      >
        <ChevronRight className="size-3.5 shrink-0 text-fg-faint" strokeWidth={2} />
        <span className="shrink-0 text-fg-faint">{stepCount(t, steps.length)}</span>
        <span className="min-w-0 flex-1 truncate text-fg-faint">{names.join(", ")}</span>
      </button>
    );
  }

  return (
    <div className="mb-2 flex flex-col gap-0.5">
      {!streaming && (
        <button
          type="button"
          onClick={() => unfold(false)}
          className={cn("flex w-full items-center gap-1.5 text-left hover:text-fg-bright", BODY)}
        >
          <ChevronDown className="size-3.5 shrink-0 text-fg-faint" strokeWidth={2} />
          <span className="text-fg-faint">{stepCount(t, steps.length)}</span>
        </button>
      )}
      {steps.map((step, index) => {
        const target = stepTarget(step);

        const path = OPENS_A_FILE.has(step.name) ? resolvePath(root, target) : "";
        const key = `${step.name}-${index}`;
        const inside = (
          <>
            {

}
            <span className={cn("shrink-0", step.done ? "text-fg-faint" : "text-accent wide-pulse")}>
              ▸
            </span>
            <span className="shrink-0">{step.name}</span>
            <span
              className={cn("min-w-0 flex-1 truncate", path && "underline-offset-2 group-hover/step:underline")}
            >
              {target}
            </span>
          </>
        );

        return path ? (
          <button
            key={key}
            type="button"
            title={path}

            onClick={() =>
              void useEditor
                .getState()
                .openFile(path)
                .then((opened) => {
                  if (!opened) onFailure(t("{name} could not be opened.", { name: target }));
                })
            }
            className={cn(
              "group/step flex w-full items-center gap-1.5 rounded-sm text-left hover:bg-hover",
              BODY,
            )}
          >
            {inside}
          </button>
        ) : (
          <div key={key} className={cn("flex w-full items-center gap-1.5", BODY)}>
            {inside}
          </div>
        );
      })}
    </div>
  );
}

const Turn = memo(function Turn({
  turn,
  divider,
  onFailure,
}: {
  turn: AiTurn;
  divider: boolean;
  onFailure: (message: string) => void;
}) {
  const t = useT();
  const [openThinking, setOpenThinking] = useState(false);
  const [copied, setCopied] = useState(false);

  const strip = useRef<((text: string) => string) | null>(null);
  if (!strip.current) strip.current = createStripper();
  const shown = useMemo(() => strip.current!(turn.text), [turn.text]);

  const reasoning = useMemo(
    () => (openThinking ? plainText(turn.thinking) : ""),
    [turn.thinking, openThinking],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
    } catch {

      const scratch = document.createElement("textarea");
      scratch.value = shown;
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.append(scratch);
      scratch.select();
      document.execCommand("copy");
      scratch.remove();
    }
    setCopied(true);
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (turn.role === "user") {
    return (
      <div
        {...{ [QUESTION]: "" }}
        className={cn("border-l-2 border-accent/60 py-1 pl-3", divider && "mt-3")}
      >
        <p className={cn("whitespace-pre-wrap", BODY)}>{turn.text}</p>
      </div>
    );
  }

  return (
    <div className="group/turn relative py-1">
      {
}
      {shown && (
        <button
          type="button"
          onClick={() => void copy()}
          title={copied ? t("Copied") : t("Copy the answer")}
          aria-label={copied ? t("Copied") : t("Copy the answer")}
          className="absolute right-0 top-0 rounded-sm p-1 text-fg-faint opacity-0 transition-opacity duration-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/turn:opacity-100"
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-400" strokeWidth={2} />
          ) : (
            <Copy className="size-3.5" strokeWidth={1.75} />
          )}
        </button>
      )}

      {turn.steps.length > 0 && (
        <Steps
          steps={turn.steps}
          streaming={turn.streaming}
          turnId={turn.id}
          onFailure={onFailure}
        />
      )}

      {turn.thinking && (
        <>
          <button
            type="button"
            onClick={() => setOpenThinking((was) => !was)}
            className={cn("mb-1 flex items-center gap-1 hover:text-fg-bright", BODY)}
          >
            {openThinking ? (
              <ChevronDown className="size-3.5" strokeWidth={2} />
            ) : (
              <ChevronRight className="size-3.5" strokeWidth={2} />
            )}
            {t("Reasoning")}
          </button>
          {openThinking && (
            <p className={cn("mb-2 whitespace-pre-wrap border-l border-line pl-3", BODY)}>
              {reasoning}
            </p>
          )}
        </>
      )}

      {shown && (
        <p className={cn("whitespace-pre-wrap", BODY)}>
          {shown}
          {
}
          {turn.streaming && <span className="wide-caret" aria-hidden="true" />}
        </p>
      )}
      {turn.streaming && !shown && !turn.steps.length && (
        <p className={cn(BODY, "text-fg-faint")}>
          {t("Thinking…")}
          <span className="wide-caret" aria-hidden="true" />
        </p>
      )}
      {
}
      {!turn.streaming && turn.usage && turn.usage.total > 0 && (
        <p className={cn("pt-1", BODY, "text-fg-faint")}>
          {t("{count} tokens", { count: tokens(turn.usage.total) })}
        </p>
      )}
      {}
      {turn.error && <p className={cn("pt-1", BODY, "text-status-error")}>{t(turn.error)}</p>}
    </div>
  );
});

function AttachButton({ session }: { session: string }) {
  const t = useT();
  const root = useWorkspace((state) => state.root);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<{ path: string; relativePath: string }[]>([]);

  useEffect(() => {
    if (!open || !root) return;
    setQuery("");
    void bridge.listProjectFiles(root).then((reply) => setFiles(reply.files ?? []));
  }, [open, root]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((file) => !q || file.relativePath.toLowerCase().includes(q)).slice(0, 30);
  }, [files, query]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("Attach a file as context")}
        aria-label={t("Attach a file as context")}
        className={cn(
          "flex size-6 items-center justify-center rounded-md border border-line transition-colors duration-100 hover:bg-hover",
          open ? "text-fg" : "text-fg-faint hover:text-fg",
        )}
      >
        <AtSign className="size-3.5" strokeWidth={1.75} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-1 w-[min(360px,80vw)] overflow-hidden rounded-md border border-line bg-panel shadow-xl">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Attach a file…")}
              spellCheck={false}
              className="w-full border-b border-line bg-transparent px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint"
            />
            <div className="max-h-48 overflow-auto py-1">
              {matches.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-fg-faint">{root ? t("No files match.") : t("Open a folder first.")}</p>
              ) : (
                matches.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => {
                      useAi.getState().attach(session, file.path);
                      setOpen(false);
                    }}
                    className="block w-full truncate px-2 py-1 text-left text-[12px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
                    title={file.relativePath}
                  >
                    {file.relativePath}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AiChatView({ id }: { id: string }) {
  const t = useT();
  const root = useWorkspace((state) => state.root);
  const chat = useAi((state) => state.chats[id]);
  const revealTurn = useAi((state) => state.revealTurn);
  const attachments = useAi((state) => state.attachments[id] ?? NOTHING_ATTACHED);

  const context = useEditor((state) => state.lastFilePath);
  const { ready } = useModelLabel();

  const store = keptFor(id);
  const [draft, setDraft] = useState(store.draft);

  const stuck = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const frame = useRef(0);

  const loaded = chat?.loaded ?? false;

  useEffect(() => {
    void useAi.getState().openChat(id);
  }, [id]);

  useEffect(() => {
    store.draft = draft;
  }, [draft, store]);

  useEffect(() => {
    const element = composer.current;
    if (!element) return;
    element.style.height = "auto";

    const chrome = element.offsetHeight - element.clientHeight;
    element.style.height = `${Math.min(element.scrollHeight + chrome, 240)}px`;
  }, [draft]);

  const restored = useRef("");
  useEffect(() => {
    if (!loaded || restored.current === id) return;
    const element = scroller.current;
    if (!element) return;
    restored.current = id;

    if (store.pinned || store.scroll <= 0) {
      element.scrollTop = element.scrollHeight;
      stuck.current = true;
    } else {
      element.scrollTop = store.scroll;
      stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    }
    setAtBottom(stuck.current);
    composer.current?.focus();
  }, [id, store, loaded]);

  const turns = chat?.turns;
  useEffect(() => {

    if (!stuck.current) {

      setAtBottom(false);
      return;
    }
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const element = scroller.current;
      if (element && stuck.current) element.scrollTop = element.scrollHeight;
    });
  }, [turns]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const toBottom = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    stuck.current = true;
    setAtBottom(true);
  }, []);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight < 32;

    if (near !== stuck.current) setAtBottom(near);
    stuck.current = near;
    store.scroll = element.scrollTop;
    store.pinned = near;
  };

  const landOn = useCallback((mark: HTMLElement) => {
    const element = scroller.current;
    if (!element) return;
    const max = element.scrollHeight - element.clientHeight;
    const top = Math.min(Math.max(0, mark.offsetTop - 12), max);
    if (top === element.scrollTop) return;
    element.scrollTo({ top, behavior: "smooth" });

    const near = max - top < 32;
    stuck.current = near;
    setAtBottom(near);
    store.pinned = near;
  }, [store]);

  const at = useRef<number | null>(null);

  const jump = useCallback(
    (direction: -1 | 1) => {
      const element = scroller.current;
      if (!element) return;
      const marks = Array.from(element.querySelectorAll<HTMLElement>(`[${QUESTION}]`));
      if (marks.length === 0) return;

      let next: number;
      if (at.current === null) {
        const here = element.scrollTop;
        const tops = marks.map((mark) => mark.offsetTop);
        const found =
          direction < 0
            ? tops.reduce((best, top, index) => (top < here - 8 ? index : best), -1)
            : tops.findIndex((top) => top > here + 8);
        if (found < 0) return;
        next = found;
      } else {
        next = at.current + direction;
        if (next < 0 || next >= marks.length) return;
      }
      at.current = next;
      landOn(marks[next]);
    },
    [landOn],
  );

  useEffect(() => {
    if (!revealTurn || revealTurn.session !== id || !loaded) return;
    const element = scroller.current;
    const marks = element ? Array.from(element.querySelectorAll<HTMLElement>(`[${QUESTION}]`)) : [];
    const mark = marks[revealTurn.index];
    if (mark) {
      at.current = revealTurn.index;
      landOn(mark);
    }
    useAi.setState({ revealTurn: null });
  }, [revealTurn, id, loaded, landOn]);

  const active = chat?.activeTurn ?? null;
  const stopping = chat?.stopping ?? false;
  const error = chat?.error ?? "";

  useEffect(() => {
    if (active) return;
    const here = document.activeElement;
    if (here instanceof HTMLElement && here.dataset.stop === "") composer.current?.focus();
  }, [active]);

  const report = useCallback(
    (message: string) =>
      useAi.setState((state) =>
        state.chats[id] ? { chats: { ...state.chats, [id]: { ...state.chats[id], error: message } } } : state,
      ),
    [id],
  );

  const submit = () => {
    const text = draft.trim();
    if (!text || !ready || !root || active || !loaded) return;
    setDraft("");
    stuck.current = true;
    setAtBottom(true);
    void useAi.getState().ask(id, text);

    composer.current?.focus();
  };

  return (
    <div

      tabIndex={-1}
      className="wide-enter-fade flex h-full flex-col bg-canvas outline-none"
      onWheel={() => {
        at.current = null;
      }}
      onPointerDown={() => {
        at.current = null;
      }}
      onKeyDown={(event) => {

        if (!event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.key === "ArrowUp") {
          event.preventDefault();
          jump(-1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          jump(1);
        }
      }}
    >
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-auto">
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 py-5">
            {!chat?.loaded ? null : chat.turns.length === 0 ? (
              <p className={cn(BODY, "text-fg-faint")}>
                {!root
                  ? t("Open a folder first.")
                  : ready
                    ? t("Ask about the code. The assistant can read the project and change files.")
                    : t("No model is set up yet.")}
              </p>
            ) : (
              chat.turns.map((turn, index) => (
                <Turn
                  key={turn.id}
                  turn={turn}
                  divider={turn.role === "user" && index > 0}
                  onFailure={report}
                />
              ))
            )}
          </div>
        </div>

        {

}
        {!atBottom && (
          <button
            type="button"
            onClick={toBottom}
            className="wide-enter-fade absolute bottom-3 right-6 flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-[11px] text-fg-dim shadow-lg transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <ArrowDown className="size-3" strokeWidth={2} />
            {active ? t("New text") : t("Latest")}
          </button>
        )}
      </div>

      {error && (
        <button
          type="button"
          onClick={() =>
            useAi.setState((state) => ({
              chats: state.chats[id]
                ? { ...state.chats, [id]: { ...state.chats[id], error: "" } }
                : state.chats,
            }))
          }
          className="wide-enter-fade shrink-0 border-t border-line px-6 py-1.5 text-left text-[13px] text-status-error"
        >
          {t(error)}
        </button>
      )}

      <div className="shrink-0 border-t border-line px-6 py-3">
        <div className="mx-auto w-full max-w-[760px]">
          {

}
          {context && (
            <p className="pb-1.5 text-[11px] text-fg-faint">
              {t("Context: {name}", { name: basename(context) })}
            </p>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1 pb-1.5">
              {attachments.map((path) => (
                <span key={path} className="flex items-center gap-1 rounded-sm bg-panel px-1.5 py-0.5 text-[11px] text-fg-dim" title={path}>
                  <AtSign className="size-3 shrink-0 text-fg-faint" strokeWidth={1.75} />
                  <span className="max-w-[160px] truncate">{basename(path)}</span>
                  <button type="button" onClick={() => useAi.getState().detach(id, path)} className="text-fg-faint hover:text-fg" aria-label={t("Remove")}>
                    <X className="size-3" strokeWidth={2} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={composer}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;

              if (event.nativeEvent.isComposing) return;

              if (active) return;
              event.preventDefault();
              submit();
            }}
            placeholder={ready ? t("Ask about the code…") : t("Not set up yet")}
            rows={1}
            spellCheck={false}
            disabled={!ready || !root}
            className={cn(
              "w-full resize-none overflow-auto rounded-md border border-line bg-panel px-3 py-2 outline-none",
              "transition-colors duration-100 focus:border-accent disabled:opacity-50 placeholder:text-fg-faint",
              BODY,
            )}
          />
          {

}
          <div className="flex items-center gap-2 pt-2">
            <AttachButton session={id} />
            <ModelPicker />
            <span className="flex-1" />
            {

}
            <div className="relative">
              <button
                type="button"
                onClick={() => void useAi.getState().stop(id)}
                title={t("Stop")}
                aria-label={t("Stop")}
                data-stop=""
                aria-disabled={stopping}
                tabIndex={active && !stopping ? 0 : -1}
                aria-hidden={!active}
                className={cn(
                  "absolute inset-0 flex items-center justify-center gap-1.5 rounded-md border border-line px-3 py-1 text-[11px] text-fg-dim",
                  "transition-opacity duration-100 hover:bg-hover hover:text-fg",
                  active ? "opacity-100" : "pointer-events-none opacity-0",
                  stopping && "opacity-60",
                )}
              >
                <Square className="size-3" strokeWidth={2} fill="currentColor" />
                {stopping ? t("Stopping…") : t("Stop")}
              </button>
              <button
                type="button"
                onClick={submit}

                disabled={!draft.trim() || !ready || !root || !loaded}
                title={t("Send")}
                aria-label={t("Send")}
                tabIndex={active ? -1 : 0}
                aria-hidden={Boolean(active)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border border-accent px-3 py-1 text-[11px] text-accent",
                  "transition-opacity duration-100 hover:bg-accent hover:text-bg",
                  "disabled:hover:bg-transparent disabled:hover:text-accent",

                  active
                    ? "pointer-events-none opacity-0 disabled:opacity-0"
                    : "disabled:opacity-40",
                )}
              >
                <Send className="size-3" strokeWidth={1.75} />
                {t("Send")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
