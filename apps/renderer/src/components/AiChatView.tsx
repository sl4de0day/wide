import { ArrowDown, AtSign, Check, ChevronDown, ChevronRight, Copy, FilePlus, FileUp, ImagePlus, RefreshCw, Send, Square, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModelPicker, useModelLabel } from "@/components/ai/ModelPicker";
import { bridge } from "@/lib/bridge";
import { splitChatSegments, renderProse } from "@/lib/chatMarkdown";
import { useT, type Values } from "@/lib/i18n";
import { plainText } from "@/lib/plainText";
import { basename, cn, copyText } from "@/lib/utils";
import { confirm } from "@/stores/confirm";
import { promptText } from "@/stores/prompt";
import { toast } from "@/stores/toast";
import { AI_IMAGE_PROVIDERS, useAi, type AiImage, type AiToolStep, type AiTurn } from "@/stores/ai";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";

const kept: Record<string, { draft: string; scroll: number; pinned: boolean }> = {};
const keptFor = (id: string) => (kept[id] ??= { draft: "", scroll: 0, pinned: true });

const unfolded: Record<string, boolean> = {};

const NOTHING_ATTACHED: string[] = [];
const NO_IMAGES: AiImage[] = [];

const BODY = "text-[13px] leading-relaxed text-fg";

const QUESTION = "data-question";

const SLASH_COMMANDS: { name: string; label: string; prompt: string; open?: boolean }[] = [
  { name: "explain", label: "Explain the current file", prompt: "Explain what the current file does, step by step. Read it first." },
  { name: "summarize", label: "Summarize the file", prompt: "Summarize the current file: its purpose, its key functions, and how it fits into the project. Read it first." },
  { name: "review", label: "Review for issues", prompt: "Review the current file for bugs, security issues, and code smells, ranked by severity. Read it first." },
  { name: "fix", label: "Find and fix bugs", prompt: "Review the current file for bugs and fix them. Read the file first, then apply the fix." },
  { name: "security", label: "Security audit", prompt: "Audit the current file for security vulnerabilities — injection, XSS, auth/access control, SSRF, path traversal, hard-coded secrets, unsafe deserialization. List each with severity and a fix. Read it first." },
  { name: "harden", label: "Harden the code", prompt: "Harden the current file against security vulnerabilities and apply the fixes. Read it first." },
  { name: "cwe", label: "Find CWE weaknesses", prompt: "Identify the CWE weaknesses present in the current file, cite the CWE id for each, and explain how to remediate them. Read it first." },
  { name: "threats", label: "Threat model", prompt: "Produce a short threat model for the current file: assets, entry points, trust boundaries, likely attacks, and mitigations. Read it first." },
  { name: "refactor", label: "Refactor for clarity", prompt: "Refactor the current file to be cleaner and simpler without changing its behavior. Read it first, then apply the change." },
  { name: "simplify", label: "Simplify the code", prompt: "Simplify the current file: remove dead code and redundancy while keeping the behavior identical. Read it first." },
  { name: "optimize", label: "Improve performance", prompt: "Find and fix performance problems in the current file without changing behavior. Read it first." },
  { name: "types", label: "Improve the types", prompt: "Add or tighten the TypeScript types in the current file, removing any 'any'. Read it first." },
  { name: "tests", label: "Write tests", prompt: "Write unit tests for the current file. Read it first and follow the project's existing test style." },
  { name: "doc", label: "Document the code", prompt: "Add clear documentation comments to the current file, matching the surrounding style. Read it first." },
  { name: "log", label: "Add logging", prompt: "Add helpful, non-noisy logging to the current file. Read it first." },
  { name: "example", label: "Show a usage example", prompt: "Show a concise usage example for the code in the current file. Read it first." },
  { name: "commit-message", label: "Write a commit message", prompt: "Write a concise, conventional commit message for the current git changes. Inspect the changes first." },
  { name: "name", label: "Suggest better names", prompt: "Suggest clearer names for the variables, functions, and types in the current file. Read it first." },
  { name: "plan", label: "Plan an implementation", prompt: "Propose a step-by-step implementation plan for: ", open: true },
  { name: "regex", label: "Write a regex", prompt: "Write a regular expression, with an explanation and examples, for: ", open: true },
  { name: "find", label: "Find in the project", prompt: "Search the project and tell me where: ", open: true },
  { name: "payload", label: "Suggest test payloads", prompt: "Suggest attack payloads (for authorized security testing) to probe: ", open: true },
];

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

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  const newFile = async () => {
    const root = useWorkspace.getState().root;
    if (!root) {
      toast.error(t("Open a folder first."));
      return;
    }
    const name = await promptText({ title: t("New file from code"), placeholder: t("path/to/file.ext") });
    if (!name || !name.trim()) return;
    const sep = root.includes("\\") ? "\\" : "/";
    const target = `${root.replace(/[\\/]+$/, "")}${sep}${name.trim().replace(/^[\\/]+/, "")}`;
    const written = await bridge.writeFile(target, code);
    if (written.error) {
      toast.error(t(written.error));
      return;
    }
    await useEditor.getState().openFile(target);
    toast.success(t("Created {name}.", { name: name.trim() }));
  };
  const applyToFile = async () => {
    const editor = useEditor.getState();
    const tab = editor.tabs.find((x) => x.path === editor.activePath);
    if (!tab || tab.kind !== "file") {
      toast.error(t("Open a file first."));
      return;
    }
    const ok = await confirm({
      title: t("Replace the file's contents?"),
      message: t("This replaces the whole active file with this code block."),
      confirmLabel: t("Replace"),
      danger: true,
    });
    if (!ok) return;
    editor.replaceContent(tab.path, code);
  };

  const iconBtn = "rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg";
  return (
    <div className="my-2 overflow-hidden rounded-md border border-line">
      <div className="flex items-center gap-1 border-b border-line bg-panel px-2 py-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-wide text-fg-faint">{lang || t("code")}</span>
        <button type="button" onClick={() => void copy()} title={copied ? t("Copied") : t("Copy")} aria-label={t("Copy")} className={iconBtn}>
          {copied ? <Check className="size-3.5 text-emerald-400" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={1.75} />}
        </button>
        <button type="button" onClick={() => void applyToFile()} title={t("Apply to the active file")} aria-label={t("Apply to the active file")} className={iconBtn}>
          <FileUp className="size-3.5" strokeWidth={1.75} />
        </button>
        <button type="button" onClick={() => void newFile()} title={t("Save as a new file")} aria-label={t("Save as a new file")} className={iconBtn}>
          <FilePlus className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <pre className="overflow-auto bg-canvas p-3 font-mono text-[12px] leading-relaxed text-fg">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MessageBody({ text }: { text: string }) {
  const segments = useMemo(() => splitChatSegments(text), [text]);
  return (
    <div className="flex flex-col">
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <CodeBlock key={i} lang={seg.lang} code={seg.code} />
        ) : (
          <div key={i} className="flex flex-col gap-2">
            {renderProse(seg.text)}
          </div>
        ),
      )}
    </div>
  );
}

const Turn = memo(function Turn({
  turn,
  divider,
  last,
  onFailure,
  onRegenerate,
}: {
  turn: AiTurn;
  divider: boolean;
  last: boolean;
  onFailure: (message: string) => void;
  onRegenerate: () => void;
}) {
  const t = useT();
  const [openThinking, setOpenThinking] = useState(false);
  const [copied, setCopied] = useState(false);

  const shown = turn.text;

  const reasoning = useMemo(
    () => (openThinking ? plainText(turn.thinking) : ""),
    [turn.thinking, openThinking],
  );

  const copy = async () => {
    if (await copyText(shown)) setCopied(true);
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
      {(shown || (last && !turn.streaming)) && (
        <div className="absolute right-0 top-0 flex items-center gap-0.5 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover/turn:opacity-100">
          {last && !turn.streaming && (
            <button
              type="button"
              onClick={onRegenerate}
              title={t("Regenerate the answer")}
              aria-label={t("Regenerate the answer")}
              className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              <RefreshCw className="size-3.5" strokeWidth={1.75} />
            </button>
          )}
          {shown && (
            <button
              type="button"
              onClick={() => void copy()}
              title={copied ? t("Copied") : t("Copy the answer")}
              aria-label={copied ? t("Copied") : t("Copy the answer")}
              className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-400" strokeWidth={2} />
              ) : (
                <Copy className="size-3.5" strokeWidth={1.75} />
              )}
            </button>
          )}
        </div>
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
        <div className={cn("min-w-0", BODY)}>
          <MessageBody text={shown} />
          {turn.streaming && <span className="wide-caret" aria-hidden="true" />}
        </div>
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
  const pendingDraft = useAi((state) => state.pendingDraft);
  const attachments = useAi((state) => state.attachments[id] ?? NOTHING_ATTACHED);

  const context = useEditor((state) => state.lastFilePath);
  const { ready } = useModelLabel();

  const store = keptFor(id);
  const [draft, setDraft] = useState(store.draft);

  const stuck = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const [slashIndex, setSlashIndex] = useState(0);
  const [slashHidden, setSlashHidden] = useState(false);
  const slashMatches = useMemo(() => {
    const match = /^\/([\w-]*)$/.exec(draft);
    return match ? SLASH_COMMANDS.filter((command) => command.name.startsWith(match[1].toLowerCase())) : [];
  }, [draft]);
  const slashOpen = slashMatches.length > 0 && !slashHidden;
  useEffect(() => {
    setSlashIndex(0);
    setSlashHidden(false);
  }, [draft]);
  const pickSlash = (command: { prompt: string; open?: boolean }) => {
    setDraft(command.open ? command.prompt : `${command.prompt} `);
    composer.current?.focus();
  };

  const images = useAi((state) => state.images[id] ?? NO_IMAGES);
  const providerSupportsImages = useAi((state) => {
    const config = state.config;
    if (!config) return false;
    return AI_IMAGE_PROVIDERS.has(config.tab === "local" ? "local" : config.provider);
  });

  const addImage = useCallback(
    (name: string, mime: string, data: string) => {
      if (!providerSupportsImages) {
        toast.error(t("This model cannot read images. Switch to Claude, DeepSeek or a local vision model."));
        return;
      }
      if (!useAi.getState().attachImage(id, { name, mime, data })) {
        toast.error(t("That image is too large, or too many are attached."));
      }
    },
    [id, providerSupportsImages, t],
  );

  const pickImage = useCallback(async () => {
    const picked = await bridge.openFile();
    if (!picked) return;
    if (!/\.(png|jpe?g|webp|gif)$/i.test(picked.name)) {
      toast.error(t("Pick a PNG, JPEG, WebP or GIF image."));
      return;
    }
    const reply = await bridge.readBinary(picked.path);
    if (!reply.ok || !reply.base64) {
      toast.error(t(reply.error ?? "That image could not be read."));
      return;
    }
    const ext = picked.name.split(".").pop()?.toLowerCase() ?? "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    addImage(picked.name, mime, reply.base64);
  }, [addImage, t]);

  const onPasteImages = useCallback(
    (event: React.ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (files.length === 0) return;
      event.preventDefault();
      for (const file of files) {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? "");
          const comma = result.indexOf(",");
          if (comma < 0) return;
          addImage(file.name || t("Pasted image"), file.type, result.slice(comma + 1));
        };
        reader.readAsDataURL(file);
      }
    },
    [addImage, t],
  );

  const [mentionFiles, setMentionFiles] = useState<{ path: string; relativePath: string }[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  useEffect(() => {
    if (!root) {
      setMentionFiles([]);
      return;
    }
    void bridge.listProjectFiles(root).then((reply) => setMentionFiles(reply.files ?? []));
  }, [root]);
  const mentionQuery = useMemo(() => {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(draft);
    return match ? match[1] : null;
  }, [draft]);
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionFiles.filter((file) => !q || file.relativePath.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, mentionFiles]);
  const mentionOpen = mentionMatches.length > 0;
  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);
  const pickMention = (file: { path: string }) => {
    useAi.getState().attach(id, file.path);
    setDraft((current) => current.replace(/(^|\s)@([^\s@]*)$/, "$1").replace(/\s+$/, (m) => (m.includes("\n") ? m : " ")));
    composer.current?.focus();
  };

  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const frame = useRef(0);

  const loaded = chat?.loaded ?? false;

  const contextTokens = useMemo(() => {
    const turns = chat?.turns ?? [];
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const usage = turns[i].usage;
      if (usage && usage.total > 0) return usage.input + usage.output;
    }
    return 0;
  }, [chat?.turns]);

  useEffect(() => {
    void useAi.getState().openChat(id);
  }, [id]);

  useEffect(() => {
    store.draft = draft;
  }, [draft, store]);

  useEffect(() => {
    if (!pendingDraft || pendingDraft.session !== id) return;
    const addition = pendingDraft.text;
    useAi.setState({ pendingDraft: null });
    setDraft((current) => (current.trim() ? `${current.replace(/\s+$/, "")}\n\n${addition}` : addition));
    composer.current?.focus();
  }, [pendingDraft, id]);

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
        if (event.key === "Escape" && active && !stopping) {
          event.preventDefault();
          void useAi.getState().stop(id);
          return;
        }
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
                  last={turn.role === "assistant" && index === chat.turns.length - 1 && !active}
                  onFailure={report}
                  onRegenerate={() => void useAi.getState().regenerate(id)}
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
        <div className="relative mx-auto w-full max-w-[760px]">
          {mentionOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-[min(380px,90%)] overflow-auto rounded-md border border-line bg-panel py-1 shadow-xl">
              {mentionMatches.map((file, index) => (
                <button
                  key={file.path}
                  type="button"
                  ref={index === mentionIndex ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                  onMouseEnter={() => setMentionIndex(index)}
                  onClick={() => pickMention(file)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors duration-100",
                    index === mentionIndex ? "bg-hover" : "hover:bg-hover",
                  )}
                  title={file.relativePath}
                >
                  <AtSign className="size-3 shrink-0 text-fg-faint" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg-dim">{file.relativePath}</span>
                </button>
              ))}
            </div>
          )}
          {slashOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-[min(380px,90%)] overflow-auto rounded-md border border-line bg-panel py-1 shadow-xl">
              {slashMatches.map((command, index) => (
                <button
                  key={command.name}
                  type="button"
                  ref={index === slashIndex ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                  onMouseEnter={() => setSlashIndex(index)}
                  onClick={() => pickSlash(command)}
                  className={cn(
                    "flex w-full items-baseline gap-2 px-2 py-1.5 text-left transition-colors duration-100",
                    index === slashIndex ? "bg-hover" : "hover:bg-hover",
                  )}
                >
                  <span className="shrink-0 font-mono text-[11px] text-accent">/{command.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg-dim">{t(command.label)}</span>
                </button>
              ))}
            </div>
          )}
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
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-1.5">
              {images.map((image) => (
                <span key={image.id} className="group/img relative block" title={image.name}>
                  <img
                    src={`data:${image.mime};base64,${image.data}`}
                    alt={image.name}
                    className="block size-12 rounded-sm border border-line object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => useAi.getState().detachImage(id, image.id)}
                    aria-label={t("Remove")}
                    className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-line bg-panel text-fg-faint opacity-0 transition-opacity duration-100 hover:text-fg group-hover/img:opacity-100"
                  >
                    <X className="size-2.5" strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={composer}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={onPasteImages}
            onKeyDown={(event) => {
              if (mentionOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setMentionIndex((index) => (index + 1) % mentionMatches.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setMentionIndex((index) => (index - 1 + mentionMatches.length) % mentionMatches.length);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft((current) => current.replace(/(^|\s)@([^\s@]*)$/, "$1"));
                  return;
                }
                if ((event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === "Tab") {
                  event.preventDefault();
                  pickMention(mentionMatches[mentionIndex]);
                  return;
                }
              }
              if (slashOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSlashIndex((index) => (index + 1) % slashMatches.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSlashIndex((index) => (index - 1 + slashMatches.length) % slashMatches.length);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSlashHidden(true);
                  return;
                }
                if ((event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === "Tab") {
                  event.preventDefault();
                  pickSlash(slashMatches[slashIndex]);
                  return;
                }
              }
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
            <button
              type="button"
              onClick={() => void pickImage()}
              title={t("Attach an image")}
              aria-label={t("Attach an image")}
              className={cn(
                "flex size-6 items-center justify-center rounded-md border border-line transition-colors duration-100 hover:bg-hover",
                "text-fg-faint hover:text-fg",
              )}
            >
              <ImagePlus className="size-3.5" strokeWidth={1.75} />
            </button>
            <ModelPicker />
            {contextTokens > 0 && (
              <span
                className={cn("shrink-0 text-[10px] tabular-nums", contextTokens > 120000 ? "text-amber-400" : "text-fg-faint")}
                title={t("Tokens in the current context window")}
              >
                {t("{count} ctx", { count: tokens(contextTokens) })}
              </span>
            )}
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
