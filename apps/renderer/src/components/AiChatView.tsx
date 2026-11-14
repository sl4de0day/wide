import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FolderOpen,
  Globe,
  ImagePlus,
  Mic,
  MicOff,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Shield,
  Square,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { highlightCode } from "@lezer/highlight";

import { ModelPicker, useModelLabel } from "@/components/ai/ModelPicker";
import { codeHighlight, editorTheme } from "@/editor/theme";
import { languageFor } from "@/editor/languages";
import { bridge } from "@/lib/bridge";
import { splitChatSegments, renderProse } from "@/lib/chatMarkdown";
import { exportConversation } from "@/lib/chatExport";
import { useT } from "@/lib/i18n";
import { diffCounts, lineDiff } from "@/lib/lineDiff";
import { plainText } from "@/lib/plainText";
import { basename, cn, copyText } from "@/lib/utils";
import { toast } from "@/stores/toast";
import { AI_IMAGE_PROVIDERS, openWideToolTab, useAi, type AiImage, type AiToolStep, type AiTurn } from "@/stores/ai";
import { useAiBrowser } from "@/stores/aiBrowser";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { useRun } from "@/stores/run";
import { useCommandPalette } from "@/stores/commands";
import { confirm } from "@/stores/confirm";
import wideLogo from "@/assets/wide-logo.png";

const kept: Record<string, { draft: string; scroll: number; pinned: boolean }> = {};
const keptFor = (id: string) => (kept[id] ??= { draft: "", scroll: 0, pinned: true });

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
  { name: "git", label: "Analyze git history", prompt: "Analyze the recent git log and diff for this project. Summarize what changed, why, and flag anything suspicious." },
  { name: "deps", label: "Audit dependencies", prompt: "Read the package.json (or equivalent) in this project and audit all dependencies: check for outdated packages, known vulnerabilities, and unnecessary bloat." },
  { name: "diagram", label: "Generate a diagram", prompt: "Generate a Mermaid diagram that visualizes the architecture or data flow of the current file or project. Read relevant files first." },
  { name: "translate", label: "Translate code to another language", prompt: "Translate the code in the current file to: ", open: true },
  { name: "perf", label: "Profile and optimize", prompt: "Analyze the current file for performance bottlenecks. Identify the top issues and propose concrete optimizations. Read it first." },
  { name: "commit", label: "Commit with AI message", prompt: "Inspect the current git diff/status, write a concise conventional commit message, and show it to me for approval before committing." },
  { name: "compact", label: "Summarize and compact history", prompt: "Summarize our conversation so far, highlighting the key decisions, tasks completed, and next steps." },
  { name: "todo", label: "Task breakdown checklist", prompt: "Break down the implementation into a structured checklist with '- [ ]' tasks for: ", open: true },
  { name: "pr", label: "PR / Code Review", prompt: "Perform a thorough Pull Request review of the current changes. Check for bugs, edge cases, performance, security, and maintainability. Inspect the diff first." },
  { name: "compare", label: "Compare architectures / models", prompt: "Compare alternative architectural approaches, tradeoffs, pros and cons for: ", open: true },
];

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
  const input = step.input as {
    path?: string;
    file?: string;
    query?: string;
    command?: string;
    tab?: string;
    operation?: string;
    url?: string;
    method?: string;
    manifest?: string;
    action?: string;
    ref?: string;
    selector?: string;
    text?: string;
    key?: string;
    id?: string;
    toolId?: string;
  } | null;
  if (step.name.startsWith("browser_")) {
    const labelMap: Record<string, string> = {
      browser_open: "Browser: Open",
      browser_navigate: "Browser: Navigate",
      browser_snapshot: "Browser: Snapshot",
      browser_click: "Browser: Click",
      browser_type: "Browser: Type",
      browser_press: "Browser: Press",
      browser_hover: "Browser: Hover",
      browser_select: "Browser: Select",
      browser_scroll: "Browser: Scroll",
      browser_wait: "Browser: Wait",
      browser_extract: "Browser: Extract",
      browser_console: "Browser: Console",
      browser_cookies: "Browser: Cookies",
      browser_eval: "Browser: Eval JS",
      browser_screenshot: "Browser: Screenshot",
      browser_close: "Browser: Close",
    };
    const head = labelMap[step.name] || step.name;
    const detail = input?.url || input?.ref || input?.selector || input?.key || input?.text || "";
    return detail ? `${head} (${String(detail).slice(0, 60)})` : head;
  }
  if (input?.url) {
    const m = String(input.method || "GET").toUpperCase();
    return `${m} ${input.url}`;
  }
  if (step.name === "run_security_scan" && !input?.path) {
    return "Project Security";
  }
  if (step.name === "check_dependencies" && !input?.manifest && !input?.path) {
    return "Project Dependencies";
  }
  if (step.name === "get_open_tabs" || step.name === "ui_state_get") {
    return step.name === "ui_state_get" ? "IDE Live State" : "Open Tabs";
  }
  if (step.name === "manage_catcher" || step.name === "catcher_control") {
    const cin = step.input as { action?: string; limit?: number; intercept?: boolean } | null;
    const act = String(cin?.action || "status").toLowerCase();
    if (act === "start") return "Catcher: Start Proxy";
    if (act === "stop") return "Catcher: Stop Proxy";
    if (act === "get_traffic" || act === "traffic") return "Catcher: Inspect Traffic";
    if (act === "set_intercept") return `Catcher: Intercept ${cin?.intercept ? "ON" : "OFF"}`;
    return `Catcher: ${act}`;
  }
  if (input?.action && (step.name.endsWith("_control") || step.name.includes("pitcher_") || step.name.includes("findings_") || step.name.includes("lsp_") || step.name.includes("terminal_session") || step.name.includes("wide_custom") || step.name === "run_tests")) {
    const suffix = input.path || input.file || input.key || input.toolId || input.id || "";
    return suffix ? `${step.name}: ${input.action} (${suffix})` : `${step.name}: ${input.action}`;
  }
  return String(input?.manifest ?? input?.path ?? input?.file ?? input?.tab ?? input?.operation ?? input?.query ?? input?.command ?? "");
}

const OPENS_A_FILE = new Set(["read_file", "open_file", "write_file", "edit_file"]);

function normalizeLangToExt(lang: string): string {
  const l = (lang || "").trim().toLowerCase();
  switch (l) {
    case "javascript":
    case "js":
      return "js";
    case "typescript":
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "jsx":
      return "jsx";
    case "html":
      return "html";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "json":
    case "jsonc":
      return "json";
    case "python":
    case "py":
      return "py";
    case "rust":
    case "rs":
      return "rs";
    case "go":
    case "golang":
      return "go";
    case "sql":
      return "sql";
    case "bash":
    case "sh":
    case "shell":
    case "zsh":
      return "sh";
    case "powershell":
    case "ps1":
    case "pwsh":
      return "ps1";
    case "yaml":
    case "yml":
      return "yaml";
    case "toml":
      return "toml";
    case "markdown":
    case "md":
      return "md";
    case "dockerfile":
    case "docker":
      return "dockerfile";
    case "c":
    case "cpp":
    case "c++":
      return "c";
    case "java":
      return "java";
    case "php":
      return "php";
    case "ruby":
    case "rb":
      return "rb";
    default:
      return l || "txt";
  }
}

const codeBlockTheme = EditorView.theme({
  "&": {
    fontSize: "12px",
    fontFamily: "var(--font-mono)",
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
    overflow: "auto",
    maxHeight: "440px",
  },
  ".cm-content": {
    padding: "8px 0",
  },
  ".cm-line": {
    padding: "0 12px 0 8px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--line)",
    color: "var(--fg-faint)",
    userSelect: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "28px",
    paddingRight: "8px",
    textAlign: "right",
    color: "var(--fg-faint)",
    fontSize: "11px",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  "::selection": {
    backgroundColor: "var(--mono-600)",
    color: "var(--mono-50)",
  },
});

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const isShell = useMemo(() => /^(bash|sh|shell|zsh|powershell|ps1|pwsh|cmd|bat)$/i.test(lang), [lang]);

  const copy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const runInTerminal = () => {
    useCommandPalette.getState().runById("view.terminal");
    useRun.getState().send(code.trim());
    toast.success(t("Running in terminal."));
  };

  useEffect(() => {
    let active = true;
    const mount = async () => {
      if (!containerRef.current) return;
      const ext = normalizeLangToExt(lang);
      const grammar = await languageFor(`snippet.${ext}`);
      if (!active || !containerRef.current) return;

      const extensions = [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        codeBlockTheme,
        syntaxHighlighting(codeHighlight),
      ];
      if (grammar) extensions.push(grammar);

      const state = EditorState.create({
        doc: code,
        extensions,
      });

      if (viewRef.current) {
        viewRef.current.setState(state);
      } else {
        viewRef.current = new EditorView({
          state,
          parent: containerRef.current,
        });
      }
    };

    void mount();
    return () => {
      active = false;
    };
  }, [lang]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== code) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: code },
      });
    }
  }, [code]);

  useEffect(() => {
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  const iconBtn = "flex items-center gap-1 rounded-md px-1.5 py-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg text-[11px]";
  const lineCount = code.split("\n").length;

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-canvas shadow-sm">
      <div className="flex items-center justify-between border-b border-line bg-panel/80 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="rounded bg-canvas/80 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-accent border border-line/60">
            {lang || t("Code")}
          </span>
          <span className="text-[11px] text-fg-faint">
            {t("{count} lines", { count: lineCount })}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {isShell && (
            <button
              type="button"
              onClick={runInTerminal}
              title={t("Run in terminal")}
              aria-label={t("Run in terminal")}
              className={iconBtn}
            >
              <Terminal className="size-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">{t("Run")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            title={copied ? t("Copied") : t("Copy")}
            aria-label={t("Copy")}
            className={iconBtn}
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-400" strokeWidth={2} />
                <span className="text-emerald-400 text-[11px]">{t("Copied")}</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" strokeWidth={1.75} />
                <span className="hidden sm:inline">{t("Copy")}</span>
              </>
            )}
          </button>
        </div>
      </div>
      <div ref={containerRef} className="overflow-hidden bg-canvas" />
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

interface InspectorTarget {
  key: string;
  path: string;
  relativePath: string;
  action: "edited" | "created" | "analyzed";
  oldContent: string;
  newContent: string;
  targetLine?: number;
}

interface NumberedDiffRow {
  index: number;
  type: "same" | "add" | "del";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

function ReactAtomIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-11.5 -10.23174 23 20.46348" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="0" cy="0" r="2.05" fill="var(--accent)" />
      <g stroke="var(--accent)" strokeWidth="1" fill="none">
        <ellipse rx="11" ry="4.2" />
        <ellipse rx="11" ry="4.2" transform="rotate(60)" />
        <ellipse rx="11" ry="4.2" transform="rotate(120)" />
      </g>
    </svg>
  );
}

function FileTypeBadge({ fileName, isCommand, isHttp, isSecurity, isBrowser }: { fileName: string; isCommand?: boolean; isHttp?: boolean; isSecurity?: boolean; isBrowser?: boolean }) {
  if (isBrowser) {
    return <Globe className="size-3 text-accent shrink-0" strokeWidth={2} />;
  }
  if (isSecurity) {
    return <Shield className="size-3 text-fg-dim shrink-0" strokeWidth={2} />;
  }
  if (isHttp) {
    return <Globe className="size-3 text-fg-dim shrink-0" strokeWidth={2} />;
  }
  if (isCommand) {
    return <Terminal className="size-3 text-fg-dim shrink-0" strokeWidth={2} />;
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) {
    return <ReactAtomIcon className="size-3.5 shrink-0" />;
  }
  let label = "CODE";
  if (lower.endsWith(".ts")) label = "TS";
  else if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) label = "JS";
  else if (lower.endsWith(".py")) label = "PY";
  else if (lower.endsWith(".json")) label = "{}";
  else if (lower.endsWith(".css") || lower.endsWith(".scss")) label = "CSS";
  else if (lower.endsWith(".html")) label = "HTML";
  else if (lower.endsWith(".md") || lower.endsWith(".markdown")) label = "MD";
  else return <FileCode className="size-3.5 text-fg-dim shrink-0" strokeWidth={1.75} />;

  return (
    <span className="px-1 py-0.5 rounded text-[9px] font-bold font-mono text-fg-dim bg-canvas border border-line/60 leading-none select-none shrink-0">
      {label}
    </span>
  );
}

const codeViewerTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--canvas)",
    color: "var(--fg)",
    fontSize: "var(--editor-font-size, 13px)",
    fontFamily: "var(--font-mono)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.65",
    overflow: "auto",
    height: "100%",
  },
  ".cm-content": {
    padding: "8px 0",
  },
  ".cm-line": {
    padding: "0 14px 0 8px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--line)",
    color: "var(--fg-faint)",
    userSelect: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "36px",
    paddingRight: "10px",
    textAlign: "right",
    color: "var(--fg-faint)",
    fontSize: "10.5px",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  "::selection": {
    backgroundColor: "var(--mono-600)",
    color: "var(--mono-50)",
  },
});

function CodeViewer({
  code,
  path,
  initialLine,
}: {
  code: string;
  path: string;
  initialLine?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    let active = true;
    const mount = async () => {
      if (!containerRef.current) return;
      const grammar = await languageFor(path);
      if (!active || !containerRef.current) return;

      const extensions = [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        editorTheme,
        codeViewerTheme,
        syntaxHighlighting(codeHighlight),
      ];
      if (grammar) extensions.push(grammar);

      const state = EditorState.create({
        doc: code,
        extensions,
      });

      if (viewRef.current) {
        viewRef.current.setState(state);
      } else {
        const view = new EditorView({
          state,
          parent: containerRef.current,
        });
        viewRef.current = view;
      }

      if (viewRef.current && initialLine && initialLine > 1) {
        const view = viewRef.current;
        const line = Math.min(initialLine, view.state.doc.lines);
        const pos = view.state.doc.line(line).from;
        view.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
      }
    };

    void mount();
    return () => {
      active = false;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [path, code, initialLine]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden bg-canvas" />;
}

function tokenizeLines(code: string, grammar: any): { text: string; classes: string }[][] | null {
  if (!code) return [];
  const parser = grammar?.language?.parser;
  if (!parser) return null;
  try {
    const tree = parser.parse(code);
    const lines: { text: string; classes: string }[][] = [];
    let cur: { text: string; classes: string }[] = [];
    highlightCode(
      code,
      tree,
      codeHighlight,
      (text, classes) => {
        cur.push({ text, classes });
      },
      () => {
        lines.push(cur);
        cur = [];
      },
    );
    lines.push(cur);
    return lines;
  } catch {
    return null;
  }
}

function DiffSlidePanel({
  target,
  onClose,
}: {
  target: InspectorTarget;
  onClose: () => void;
}) {
  const t = useT();
  const hasDiff = target.action !== "analyzed" && target.oldContent !== target.newContent;
  const [mode, setMode] = useState<"changes" | "full">(() => (hasDiff ? "changes" : "full"));
  const [grammar, setGrammar] = useState<any>(null);
  const firstChangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void languageFor(target.path).then((g) => {
      if (active) setGrammar(g);
    });
    return () => {
      active = false;
    };
  }, [target.path]);

  useEffect(() => {
    setMode(target.action !== "analyzed" && target.oldContent !== target.newContent ? "changes" : "full");
  }, [target.key, target.action, target.oldContent, target.newContent]);

  const rawRows = useMemo(
    () =>
      target.action === "analyzed"
        ? target.newContent.split("\n").map((text) => ({ type: "same" as const, text }))
        : lineDiff(target.oldContent, target.newContent),
    [target.action, target.oldContent, target.newContent],
  );

  const { added, removed } = useMemo(() => diffCounts(rawRows), [rawRows]);

  const numberedRows = useMemo<NumberedDiffRow[]>(() => {
    let oldNo = 1;
    let newNo = 1;
    return rawRows.map((row, index) => {
      if (row.type === "same") {
        const item: NumberedDiffRow = { index, type: "same", text: row.text, oldLine: oldNo, newLine: newNo };
        oldNo += 1;
        newNo += 1;
        return item;
      }
      if (row.type === "del") {
        const item: NumberedDiffRow = { index, type: "del", text: row.text, oldLine: oldNo, newLine: null };
        oldNo += 1;
        return item;
      }
      const item: NumberedDiffRow = { index, type: "add", text: row.text, oldLine: null, newLine: newNo };
      newNo += 1;
      return item;
    });
  }, [rawRows]);

  const changedRows = useMemo(() => {
    return numberedRows.filter((r) => r.type !== "same");
  }, [numberedRows]);

  const firstChangedLine = useMemo(() => {
    for (const r of numberedRows) {
      if (r.type !== "same") return r.newLine ?? r.oldLine ?? 1;
    }
    return 1;
  }, [numberedRows]);

  const targetInitialLine = useMemo(() => {
    if (target.targetLine && target.targetLine > 0) return target.targetLine;
    return firstChangedLine;
  }, [target.targetLine, firstChangedLine]);

  useEffect(() => {
    if (mode === "changes") {
      const timer = setTimeout(() => {
        firstChangeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [target.key, mode]);

  const { newTokens, oldTokens } = useMemo(() => {
    if (mode !== "changes" || !hasDiff) return { newTokens: null, oldTokens: null };
    return {
      newTokens: tokenizeLines(target.newContent, grammar),
      oldTokens: target.oldContent ? tokenizeLines(target.oldContent, grammar) : null,
    };
  }, [mode, hasDiff, grammar, target.newContent, target.oldContent]);

  return (
    <div className="wide-enter-fade flex h-full w-[min(580px,56%)] shrink-0 flex-col border-l border-line bg-panel shadow-2xl">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-canvas/70 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileTypeBadge fileName={target.path} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-[12px] font-semibold text-fg" title={target.path}>
              {basename(target.path)}
            </span>
            <span className="truncate font-mono text-[10px] text-fg-faint" title={target.path}>
              {target.relativePath || target.path}
            </span>
          </div>
          {(added > 0 || removed > 0) && (
            <div className="flex shrink-0 items-center gap-1.5 pl-1">
              {added > 0 && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-400">
                  +{added}
                </span>
              )}
              {removed > 0 && (
                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-400">
                  −{removed}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {hasDiff && (
            <div className="flex items-center rounded-lg border border-line bg-canvas p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setMode("changes")}
                className={cn(
                  "rounded-md px-2 py-0.5 transition-colors",
                  mode === "changes" ? "bg-accent text-bg font-medium" : "text-fg-faint hover:text-fg",
                )}
              >
                {t("Changes")}
              </button>
              <button
                type="button"
                onClick={() => setMode("full")}
                className={cn(
                  "rounded-md px-2 py-0.5 transition-colors",
                  mode === "full" ? "bg-accent text-bg font-medium" : "text-fg-faint hover:text-fg",
                )}
              >
                {t("Full file")}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => void useEditor.getState().revealAt(target.path, targetInitialLine, 1)}
            title={t("Open in editor")}
            aria-label={t("Open in editor")}
            className="flex items-center gap-1 rounded-lg border border-line/70 px-2 py-1 text-[11px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
          >
            <ExternalLink className="size-3" strokeWidth={1.75} />
            <span className="hidden xl:inline">{t("Open in editor")}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t("Close")}
            aria-label={t("Close")}
            className="flex size-7 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-hover hover:text-fg"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {mode === "full" || !hasDiff ? (
        <div className="min-h-0 flex-1 overflow-hidden bg-canvas">
          <CodeViewer code={target.newContent} path={target.path} initialLine={targetInitialLine} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-canvas font-mono text-[12px] leading-[1.65]">
          {changedRows.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-fg-faint text-[12px]">
              {t("No changes.")}
            </div>
          ) : (
            changedRows.map((row, idx) => {
              const prev = idx > 0 ? changedRows[idx - 1] : null;
              const hasGap =
                prev &&
                ((row.oldLine != null && prev.oldLine != null && Math.abs(row.oldLine - prev.oldLine) > 1) ||
                  (row.newLine != null && prev.newLine != null && Math.abs(row.newLine - prev.newLine) > 1));

              const lineNo = row.type === "del" ? row.oldLine : (row.newLine ?? row.oldLine);
              const tokens =
                row.type === "del"
                  ? oldTokens && row.oldLine ? oldTokens[row.oldLine - 1] : null
                  : newTokens && row.newLine ? newTokens[row.newLine - 1] : null;

              return (
                <div key={row.index} className="flex flex-col">
                  {hasGap && (
                    <div className="flex items-center justify-center gap-2 border-y border-line/40 bg-panel/70 px-3 py-1 font-mono text-[10px] text-fg-faint select-none">
                      <span>···</span>
                    </div>
                  )}
                  <div
                    ref={idx === 0 ? firstChangeRef : undefined}
                    className={cn(
                      "flex items-stretch border-l-[3px] px-2 py-0.5",
                      row.type === "add" && "border-emerald-500 bg-emerald-500/20 text-emerald-200",
                      row.type === "del" && "border-rose-500 bg-rose-500/20 text-rose-200",
                    )}
                  >
                    <span
                      className={cn(
                        "w-10 shrink-0 select-none pr-2.5 text-right font-mono text-[10.5px] tabular-nums",
                        row.type === "add" ? "text-emerald-400/80" : "text-rose-400/80",
                      )}
                    >
                      {lineNo ?? ""}
                    </span>
                    <span
                      className={cn(
                        "w-4 shrink-0 select-none text-center font-bold text-[12px]",
                        row.type === "add" ? "text-emerald-400" : "text-rose-400",
                      )}
                    >
                      {row.type === "add" ? "+" : "−"}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pl-1.5 font-mono text-[12px]">
                      {tokens && tokens.length > 0 ? (
                        tokens.map((tok, ti) => (
                          <span key={ti} className={tok.classes || undefined}>
                            {tok.text}
                          </span>
                        ))
                      ) : (
                        row.text || " "
                      )}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function extractLineRange(step: AiToolStep, rawTarget: string): string {
  const input = (step.input && typeof step.input === "object" ? step.input : {}) as Record<string, unknown>;
  const start = input.StartLine ?? input.start_line ?? input.start ?? input.fromLine ?? input.from;
  const end = input.EndLine ?? input.end_line ?? input.end ?? input.toLine ?? input.to;
  const single = input.line ?? input.Line ?? input.lineNumber;
  if (start !== undefined && end !== undefined) {
    return `#L${start}-${end}`;
  }
  if (start !== undefined) {
    return `#L${start}`;
  }
  if (single !== undefined) {
    return `#L${single}`;
  }
  const match = String(rawTarget).match(/(?:#L|:)(\d+)(?:-(\d+))?/i);
  if (match) {
    return match[2] ? `#L${match[1]}-${match[2]}` : `#L${match[1]}`;
  }
  return "";
}

function extractCommandInfo(step: AiToolStep): { commandText: string; exitCode: number | null } {
  const input = (step.input && typeof step.input === "object" ? step.input : {}) as Record<string, unknown>;
  let commandText = "";
  if (typeof input.toolSummary === "string" && input.toolSummary.trim()) {
    commandText = input.toolSummary.trim();
  } else if (typeof input.command === "string" && input.command.trim()) {
    commandText = input.command.trim();
  } else if (typeof input.CommandLine === "string" && input.CommandLine.trim()) {
    commandText = input.CommandLine.trim();
  } else if (Array.isArray(input.args)) {
    commandText = `git ${input.args.map(String).join(" ")}`;
  } else {
    commandText = stepTarget(step) || step.name;
  }

  let exitCode: number | null = null;
  const rawResult = step.result || "";
  const exitMatch = rawResult.match(/^exit\s+(\d+)/i) || rawResult.match(/exited with code\s+(\d+)/i);
  if (exitMatch) {
    exitCode = parseInt(exitMatch[1], 10);
  }

  return { commandText, exitCode };
}

function cleanCommandResult(raw: string): string {
  return raw.replace(/^exit\s+\d+\r?\n?/i, "").trim() || "(no output)";
}

interface EnrichedStep {
  key: string;
  step: AiToolStep;
  rawTarget: string;
  fullPath: string;
  fileName: string;
  actionLabel: string;
  actionKind: "edited" | "created" | "analyzed" | "command" | "other";
  added: number;
  removed: number;
  lineRange: string;
  commandText: string;
  exitCode: number | null;
  httpStatus?: number | null;
  isHttp?: boolean;
  isSecurity?: boolean;
  isBrowser?: boolean;
}

function parseHttpStatusFromResult(raw: string): number | null {
  if (!raw) return null;
  const jsonMatch = raw.match(/"status"\s*:\s*(\d{3})/);
  if (jsonMatch) return Number(jsonMatch[1]);
  const lineMatch = raw.match(/\bHTTP\/[\d.]+\s+(\d{3})\b/i);
  if (lineMatch) return Number(lineMatch[1]);
  return null;
}

function enrichSteps(steps: AiToolStep[], root: string, t: ReturnType<typeof useT>, turnId: string): EnrichedStep[] {
  return steps.map((step, index) => {
    const rawTarget = stepTarget(step);
    const fullPath = step.filePath || (OPENS_A_FILE.has(step.name) ? resolvePath(root, rawTarget) : "");
    const fileName = fullPath ? basename(fullPath) : basename(rawTarget) || rawTarget;
    let actionLabel = step.name;
    let actionKind: "edited" | "created" | "analyzed" | "command" | "other" = "other";

    if (step.name === "read_file" || step.name === "open_file") {
      actionLabel = t("Analyzed");
      actionKind = "analyzed";
    } else if (step.name === "write_file") {
      if (step.existed === false) {
        actionLabel = t("Created");
        actionKind = "created";
      } else {
        actionLabel = t("Edited");
        actionKind = "edited";
      }
    } else if (step.name === "edit_file") {
      actionLabel = t("Edited");
      actionKind = "edited";
    } else if (
      step.name === "run_command" ||
      step.name === "git" ||
      step.name === "send_http_request" ||
      step.name === "pitcher_send" ||
      step.name === "repeater_send" ||
      step.name === "intruder_attack" ||
      step.name === "manage_catcher" ||
      step.name === "catcher_control" ||
      step.name === "terminal_session" ||
      step.name === "engine_control" ||
      step.name === "debug_control" ||
      step.name === "wide_custom_tool_run" ||
      step.name === "run_tests" ||
      step.name.startsWith("browser_")
    ) {
      actionLabel = t("Ran");
      actionKind = "command";
    } else if (step.name === "search" || step.name === "find_relevant" || step.name === "lsp_navigate") {
      actionLabel = t("Searched");
    } else if (
      step.name === "list_dir" ||
      step.name === "create_dir" ||
      step.name === "open_tool_tab" ||
      step.name === "get_open_tabs" ||
      step.name === "ui_state_get" ||
      step.name === "vault_list_refs" ||
      step.name === "pitcher_env"
    ) {
      actionLabel = t("Explored");
    } else if (
      step.name === "get_diagnostics" ||
      step.name === "transform_data" ||
      step.name === "run_security_scan" ||
      step.name === "check_dependencies" ||
      step.name === "findings_query" ||
      step.name === "findings_baseline" ||
      step.name === "oast_control" ||
      step.name === "oast_poll" ||
      step.name.startsWith("catcher_")
    ) {
      actionLabel = t("Analyzed");
      actionKind = "analyzed";
    }

    let added = typeof step.added === "number" ? step.added : 0;
    let removed = typeof step.removed === "number" ? step.removed : 0;

    if (added === 0 && removed === 0 && (actionKind === "edited" || actionKind === "created")) {
      if (step.newContent !== undefined && step.oldContent !== undefined) {
        const counts = diffCounts(lineDiff(step.oldContent, step.newContent));
        added = counts.added;
        removed = counts.removed;
      } else if (step.input) {
        const input = step.input as Record<string, unknown>;
        const find = typeof input.find === "string" ? input.find : (typeof input.old_str === "string" ? input.old_str : "");
        const replace = typeof input.replace === "string" ? input.replace : (typeof input.new_str === "string" ? input.new_str : "");
        if (find || replace) {
          const counts = diffCounts(lineDiff(find, replace));
          added = counts.added;
          removed = counts.removed;
        } else if (typeof input.content === "string") {
          const lines = input.content.split("\n").length;
          added = lines;
          removed = step.existed === false ? 0 : Math.max(1, Math.round(lines * 0.5));
        }
      }
    }

    if (actionKind === "edited" && added === 0 && removed === 0) {
      added = 1;
      removed = 1;
    }

    const lineRange = actionKind === "analyzed" ? extractLineRange(step, rawTarget) : "";
    const isBrowser = step.name.startsWith("browser_");
    const isHttp = step.name === "send_http_request" || step.name === "pitcher_send" || step.name === "repeater_send" || step.name === "intruder_attack";
    const isSecurity =
      step.name === "run_security_scan" ||
      step.name === "check_dependencies" ||
      step.name === "manage_catcher" ||
      step.name.startsWith("catcher_") ||
      step.name.startsWith("findings_") ||
      step.name.startsWith("oast_") ||
      step.name === "vault_list_refs";
    const httpStatus = isHttp ? parseHttpStatusFromResult(step.result) : null;
    const { commandText, exitCode } = extractCommandInfo(step);

    return {
      key: `${turnId}-step-${index}`,
      step,
      rawTarget,
      fullPath,
      fileName,
      actionLabel,
      actionKind,
      added,
      removed,
      lineRange,
      commandText: isHttp || isBrowser ? rawTarget : commandText,
      exitCode,
      httpStatus,
      isHttp,
      isSecurity,
      isBrowser,
    };
  });
}

function AgentProcessStream({
  steps,
  streaming,
  activeInspectKey,
  onInspectFile,
  onFailure,
  turnId,
  thoughtSec = 0,
}: {
  steps: AiToolStep[];
  streaming: boolean;
  activeInspectKey: string;
  onInspectFile: (target: InspectorTarget) => void;
  onFailure: (message: string) => void;
  turnId: string;
  thoughtSec?: number;
}) {
  const t = useT();
  const root = useWorkspace((state) => state.root) ?? "";
  const liveBrowserFrame = useAiBrowser((state) => state.frame);
  const liveBrowserUrl = useAiBrowser((state) => state.url);
  const enrichedSteps = useMemo(() => enrichSteps(steps, root, t, turnId), [steps, root, t, turnId]);
  const [expandedCommands, setExpandedCommands] = useState<Record<string, boolean>>({});
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  const isExpanded = userExpanded !== null ? userExpanded : streaming;

  const totalAdded = useMemo(() => enrichedSteps.reduce((acc, s) => acc + s.added, 0), [enrichedSteps]);
  const totalRemoved = useMemo(() => enrichedSteps.reduce((acc, s) => acc + s.removed, 0), [enrichedSteps]);

  const toggleCommand = (key: string) => {
    setExpandedCommands((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStepClick = async (item: EnrichedStep) => {
    if (!item.fullPath) return;
    const startLineMatch = item.lineRange.match(/#L(\d+)/);
    const targetLine = startLineMatch ? parseInt(startLineMatch[1], 10) : undefined;

    if (item.step.newContent !== undefined && item.step.oldContent !== undefined) {
      onInspectFile({
        key: item.key,
        path: item.fullPath,
        relativePath: item.rawTarget || basename(item.fullPath),
        action: item.actionKind === "edited" || item.actionKind === "created" ? item.actionKind : "analyzed",
        oldContent: item.step.oldContent,
        newContent: item.step.newContent,
        targetLine,
      });
      return;
    }
    if (item.actionKind === "edited" && item.step.input) {
      const input = item.step.input as Record<string, unknown>;
      const find = typeof input.find === "string" ? input.find : (typeof input.old_str === "string" ? input.old_str : "");
      const replace = typeof input.replace === "string" ? input.replace : (typeof input.new_str === "string" ? input.new_str : "");
      if (find || replace) {
        onInspectFile({
          key: item.key,
          path: item.fullPath,
          relativePath: item.rawTarget || basename(item.fullPath),
          action: "edited",
          oldContent: find,
          newContent: replace,
          targetLine,
        });
        return;
      }
    }
    const read = await bridge.readFile(item.fullPath);
    if (!read || read.error || read.content == null) {
      onFailure(t("{name} could not be opened.", { name: item.fileName }));
      return;
    }
    onInspectFile({
      key: item.key,
      path: item.fullPath,
      relativePath: item.rawTarget || basename(item.fullPath),
      action: item.actionKind === "edited" || item.actionKind === "created" ? item.actionKind : "analyzed",
      oldContent: item.step.oldContent ?? "",
      newContent: item.step.newContent ?? read.content,
      targetLine,
    });
  };

  if (enrichedSteps.length === 0 && !streaming) return null;

  return (
    <div className="flex flex-col gap-1 my-1 font-sans">
      {!streaming && enrichedSteps.length > 0 && (
        <button
          type="button"
          onClick={() => setUserExpanded(!isExpanded)}
          className="flex items-center gap-2 py-1 px-2.5 rounded-lg border border-line/60 bg-panel/75 hover:bg-hover/70 transition-all text-left select-none text-[12px] group/proc w-fit shadow-sm"
        >
          <div className="flex size-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">
            <Check className="size-2.5" strokeWidth={3} />
          </div>
          <span className="font-medium text-fg">
            {t("{count} steps", { count: enrichedSteps.length })}
            {thoughtSec > 0 ? ` · ${thoughtSec}s` : ""}
          </span>
          {(totalAdded > 0 || totalRemoved > 0) && (
            <span className="flex items-center gap-1 font-mono text-[10.5px] shrink-0 select-none ml-0.5">
              {totalAdded > 0 && <span className="text-emerald-400 font-semibold">+{totalAdded}</span>}
              {totalRemoved > 0 && <span className="text-rose-400 font-semibold">−{totalRemoved}</span>}
            </span>
          )}
          <ChevronRight
            className={cn(
              "size-3 text-fg-faint group-hover/proc:text-fg transition-transform duration-150 ml-1 shrink-0",
              isExpanded && "rotate-90",
            )}
            strokeWidth={2}
          />
        </button>
      )}

      {isExpanded && (
        <div className={cn("flex flex-col gap-0.5", !streaming && "pl-2 border-l border-line/40 my-0.5 wide-enter-fade")}>
          {enrichedSteps.map((item) => {
            const isSelected = activeInspectKey === item.key;
            const isCommand = item.actionKind === "command";
            const isCommandExpanded = Boolean(expandedCommands[item.key]);

            return (
              <div key={item.key} className="flex flex-col">
                <div
                  onClick={() => {
                    if (isCommand) {
                      toggleCommand(item.key);
                    } else if (item.fullPath) {
                      void handleStepClick(item);
                    }
                  }}
                  className={cn(
                    "wide-step-item group flex items-center gap-2 py-0.5 px-1.5 -mx-1.5 rounded text-left transition-all duration-150 cursor-pointer select-none",
                    isSelected
                      ? "bg-accent/10 text-fg"
                      : "hover:bg-hover/50 text-fg-dim",
                  )}
                >
                  <span className="text-[12px] text-fg-dim/80 font-normal shrink-0">
                    {item.actionLabel}
                  </span>

                  {(item.added > 0 || item.removed > 0) && (
                    <span className="flex items-center gap-1 font-mono text-[11px] shrink-0 select-none">
                      {item.added > 0 && <span className="text-emerald-400 font-semibold">+{item.added}</span>}
                      {item.removed > 0 && <span className="text-rose-400 font-semibold">−{item.removed}</span>}
                    </span>
                  )}

                  <FileTypeBadge fileName={item.fileName} isCommand={isCommand} isHttp={item.isHttp} isSecurity={item.isSecurity} isBrowser={item.isBrowser} />

                  <span
                    className={cn(
                      "min-w-0 truncate text-[12px] transition-colors",
                      isCommand
                        ? "font-sans text-fg-dim group-hover:text-fg"
                        : "font-mono text-fg group-hover:text-fg",
                    )}
                    title={item.fullPath || item.commandText || item.fileName}
                  >
                    {isCommand ? item.commandText : item.fileName}
                  </span>

                  {item.httpStatus != null && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold shrink-0 select-none",
                        item.httpStatus >= 200 && item.httpStatus < 300 && "bg-emerald-500/15 text-emerald-400",
                        item.httpStatus >= 300 && item.httpStatus < 400 && "bg-amber-500/15 text-amber-300",
                        item.httpStatus >= 400 && "bg-rose-500/15 text-rose-400",
                      )}
                    >
                      {item.httpStatus}
                    </span>
                  )}

                  {item.isBrowser && item.step.name !== "browser_close" && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openWideToolTab("browser");
                      }}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/15 transition-colors shrink-0"
                    >
                      <ExternalLink className="size-2.5" strokeWidth={2} />
                      <span>{t("Open")}</span>
                    </button>
                  )}

                  {item.lineRange && (
                    <span className="font-mono text-[11px] text-fg-faint/70 select-none shrink-0">
                      {item.lineRange}
                    </span>
                  )}

                  {isCommand && item.exitCode !== null && item.exitCode !== 0 && (
                    <span className="text-[11px] text-rose-400 shrink-0 select-none">
                      · {t("Exited with code {code}", { code: item.exitCode })}
                    </span>
                  )}

                  {isCommand && (
                    <ChevronRight
                      className={cn(
                        "size-3 text-fg-faint/60 group-hover:text-fg transition-transform shrink-0 ml-auto",
                        isCommandExpanded && "rotate-90",
                      )}
                      strokeWidth={2}
                    />
                  )}
                </div>

                {isCommand && isCommandExpanded && (
                  <div className="my-1 ml-6 mr-1 flex flex-col gap-2">
                    {item.isBrowser && liveBrowserFrame && (
                      <button
                        type="button"
                        onClick={() => openWideToolTab("browser")}
                        className="group/thumb relative w-fit overflow-hidden rounded-lg border border-line/70 bg-canvas text-left shadow-sm"
                      >
                        <img
                          src={`data:image/jpeg;base64,${liveBrowserFrame}`}
                          alt={liveBrowserUrl || "Browser"}
                          className="block max-h-36 w-auto object-cover"
                        />
                        {liveBrowserUrl && (
                          <div className="truncate border-t border-line/60 bg-panel/90 px-2 py-0.5 font-mono text-[10px] text-fg-dim">
                            {liveBrowserUrl}
                          </div>
                        )}
                      </button>
                    )}
                    <div className="p-2 rounded-md bg-canvas/80 border border-line/60 font-mono text-[11px] text-fg-dim max-h-48 overflow-auto whitespace-pre-wrap select-text wide-enter-fade">
                      {cleanCommandResult(item.step.result)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {streaming && (
        <div className="flex items-center gap-2 pt-1 pb-0.5 select-none wide-step-item">
          <span className="wide-shimmer-text font-medium text-[12.5px] tracking-wide">
            {t("Working")}
          </span>
        </div>
      )}
    </div>
  );
}

const Turn = memo(function Turn({
  turn,
  divider,
  last,
  activeInspectKey,
  onInspectFile,
  onFailure,
  onRegenerate,
  onEdit,
  onUndoToHere,
}: {
  turn: AiTurn;
  divider: boolean;
  last: boolean;
  activeInspectKey: string;
  onInspectFile: (target: InspectorTarget) => void;
  onFailure: (message: string) => void;
  onRegenerate: () => void;
  onEdit?: (text: string) => void;
  onUndoToHere?: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const shown = turn.text;

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
        className={cn(
          "group/user relative ml-auto flex max-w-[80%] items-center justify-end gap-1.5 self-end",
          divider && "mt-2",
        )}
      >
        <button
          type="button"
          onClick={() => void copy()}
          title={copied ? t("Copied") : t("Copy")}
          aria-label={copied ? t("Copied") : t("Copy")}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-fg-faint opacity-0 transition-all duration-100 hover:bg-hover hover:text-fg group-hover/user:opacity-100"
        >
          {copied ? (
            <Check className="size-3 text-emerald-400" strokeWidth={2} />
          ) : (
            <Copy className="size-3" strokeWidth={1.75} />
          )}
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(turn.text)}
            title={t("Edit this message")}
            aria-label={t("Edit this message")}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-fg-faint opacity-0 transition-all duration-100 hover:bg-hover hover:text-fg group-hover/user:opacity-100"
          >
            <Pencil className="size-3" strokeWidth={1.75} />
          </button>
        )}
        {onUndoToHere && (
          <button
            type="button"
            onClick={onUndoToHere}
            title={t("Undo to this point")}
            aria-label={t("Undo to this point")}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-fg-faint opacity-0 transition-all duration-100 hover:bg-rose-500/15 hover:text-rose-400 group-hover/user:opacity-100"
          >
            <RotateCcw className="size-3" strokeWidth={1.75} />
          </button>
        )}
        <div className="rounded-xl border border-line/70 bg-panel/85 px-3 py-1.5 shadow-sm">
          <p className={cn("whitespace-pre-wrap text-left text-fg", BODY)}>{turn.text}</p>
        </div>
      </div>
    );
  }

  const hasThinking = Boolean(turn.thinking && turn.thinking.trim().length > 0);
  const showStream = turn.steps.length > 0 || (turn.streaming && !shown);

  const thoughtSec = useMemo(() => {
    if (!turn.startedAt || turn.streaming) return 0;
    const end = turn.endedAt ?? Date.now();
    return Math.max(1, Math.round((end - turn.startedAt) / 1000));
  }, [turn.startedAt, turn.endedAt, turn.streaming]);

  const [showReasoning, setShowReasoning] = useState(false);
  const reasoning = useMemo(
    () => (hasThinking && turn.thinking ? plainText(turn.thinking) : ""),
    [turn.thinking, hasThinking],
  );

  return (
    <div className="group/turn relative mr-auto flex w-full flex-col gap-2 self-start py-1 text-left">
      {showStream && (
        <AgentProcessStream
          steps={turn.steps}
          streaming={turn.streaming}
          activeInspectKey={activeInspectKey}
          onInspectFile={onInspectFile}
          onFailure={onFailure}
          turnId={turn.id}
          thoughtSec={thoughtSec}
        />
      )}

      {shown && (
        <div className={cn("min-w-0", BODY)}>
          <MessageBody text={shown} />
          {turn.streaming && <span className="wide-caret inline-block ml-1" aria-hidden="true" />}
        </div>
      )}

      {!turn.streaming && (shown || last || (turn.usage && turn.usage.total > 0) || thoughtSec > 0) && (
        <div className="flex items-center gap-1.5 pt-0.5">
          {shown && (
            <button
              type="button"
              onClick={() => void copy()}
              title={copied ? t("Copied") : t("Copy the answer")}
              aria-label={copied ? t("Copied") : t("Copy the answer")}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-emerald-400" strokeWidth={2} />
                  <span className="text-emerald-400">{t("Copied")}</span>
                </>
              ) : (
                <>
                  <Copy className="size-3" strokeWidth={1.75} />
                  <span className="hidden sm:inline">{t("Copy")}</span>
                </>
              )}
            </button>
          )}
          {last && (
            <button
              type="button"
              onClick={onRegenerate}
              title={t("Regenerate the answer")}
              aria-label={t("Regenerate the answer")}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              <RefreshCw className="size-3" strokeWidth={1.75} />
              <span className="hidden sm:inline">{t("Regenerate")}</span>
            </button>
          )}
          {onUndoToHere && (
            <button
              type="button"
              onClick={onUndoToHere}
              title={t("Undo to this point")}
              aria-label={t("Undo to this point")}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg-faint transition-colors duration-100 hover:bg-rose-500/15 hover:text-rose-400"
            >
              <RotateCcw className="size-3" strokeWidth={1.75} />
              <span className="hidden sm:inline">{t("Undo")}</span>
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {thoughtSec > 0 && (
              hasThinking ? (
                <button
                  type="button"
                  onClick={() => setShowReasoning((v) => !v)}
                  className="flex items-center gap-1 rounded-full bg-panel px-2.5 py-0.5 text-[10px] text-fg-faint border border-line/50 hover:text-fg hover:border-line transition-colors cursor-pointer"
                >
                  <span>{t("Thought for {sec}s", { sec: thoughtSec })}</span>
                  <ChevronDown className={cn("size-2.5 transition-transform", showReasoning && "rotate-180")} strokeWidth={2} />
                </button>
              ) : (
                <span className="rounded-full bg-panel px-2.5 py-0.5 text-[10px] text-fg-faint border border-line/50">
                  {t("Thought for {sec}s", { sec: thoughtSec })}
                </span>
              )
            )}
            {turn.usage && turn.usage.total > 0 && (
              <span className="rounded-full bg-panel px-2.5 py-0.5 text-[10px] text-fg-faint border border-line/50">
                {t("{count} tokens", { count: tokens(turn.usage.total) })}
              </span>
            )}
          </div>
        </div>
      )}

      {showReasoning && reasoning && (
        <div className="rounded-xl border border-line/50 bg-panel/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-dim whitespace-pre-wrap max-h-52 overflow-auto">
          {reasoning}
        </div>
      )}

      {turn.error && (
        <div className="flex items-center gap-2 rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-[12px] text-status-error">
          <AlertCircle className="size-4 shrink-0" />
          <span>{t(turn.error)}</span>
        </div>
      )}
    </div>
  );
});

function PlusMenu({
  session,
  onInsertMention,
  onPickImage,
  onExport,
  onOpenInstructions,
  onCompact,
}: {
  session: string;
  onInsertMention: () => void;
  onPickImage: () => void;
  onExport?: () => void;
  onOpenInstructions?: () => void;
  onCompact?: () => void;
}) {
  const t = useT();
  const root = useWorkspace((state) => state.root);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "files">("menu");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<{ path: string; relativePath: string }[]>([]);

  useEffect(() => {
    if (!open) {
      setMode("menu");
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    if (mode === "files" && root) {
      void bridge.listProjectFiles(root).then((reply) => setFiles(reply.files ?? []));
    }
  }, [mode, root]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((file) => !q || file.relativePath.toLowerCase().includes(q)).slice(0, 30);
  }, [files, query]);

  const handlePickFiles = async () => {
    const res = await bridge.openFile();
    if (res && res.path) {
      useAi.getState().attach(session, res.path);
      setOpen(false);
    }
  };

  const handlePickFolder = async () => {
    const res = await bridge.openFolder();
    if (res && res.path) {
      useAi.getState().attach(session, res.path);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("Add context")}
        aria-label={t("Add context")}
        className={cn(
          "flex size-7 items-center justify-center rounded-lg text-fg-dim transition-colors hover:bg-hover hover:text-fg",
          open && "bg-hover text-fg",
        )}
      >
        <Plus className="size-4" strokeWidth={2} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="wide-pop-up absolute bottom-full left-0 z-50 mb-2 w-52 overflow-hidden rounded-xl border border-line bg-panel p-1.5 shadow-2xl">
            {mode === "menu" ? (
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => setMode("files")}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                >
                  <FileCode className="size-4 text-fg-dim" strokeWidth={1.75} />
                  <span>{t("Files")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handlePickFolder()}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                >
                  <FolderOpen className="size-4 text-fg-dim" strokeWidth={1.75} />
                  <span>{t("Folder")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onInsertMention();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                >
                  <AtSign className="size-4 text-fg-dim" strokeWidth={1.75} />
                  <span>{t("Mention")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onPickImage();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                >
                  <ImagePlus className="size-4 text-fg-dim" strokeWidth={1.75} />
                  <span>{t("Attach image")}</span>
                </button>
                {onExport && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onExport();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                  >
                    <Download className="size-4 text-fg-dim" strokeWidth={1.75} />
                    <span>{t("Export conversation as Markdown")}</span>
                  </button>
                )}
                {onCompact && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onCompact();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                  >
                    <RefreshCw className="size-4 text-fg-dim" strokeWidth={1.75} />
                    <span>{t("Compact chat")}</span>
                  </button>
                )}
                {onOpenInstructions && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpenInstructions();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                  >
                    <Settings2 className="size-4 text-fg-dim" strokeWidth={1.75} />
                    <span>{t("Project Instructions")}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setMode("menu")}
                    className="flex size-6 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg"
                  >
                    <ChevronDown className="size-3.5 rotate-90" />
                  </button>
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("Search files…")}
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-faint"
                  />
                  <button
                    type="button"
                    onClick={() => void handlePickFiles()}
                    title={t("Browse…")}
                    className="text-[10px] text-fg-dim hover:text-fg hover:underline shrink-0"
                  >
                    {t("Browse…")}
                  </button>
                </div>
                <div className="max-h-48 overflow-auto py-1">
                  {matches.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-fg-faint">
                      {root ? t("No files match.") : t("Open a folder first.")}
                    </p>
                  ) : (
                    matches.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => {
                          useAi.getState().attach(session, file.path);
                          setOpen(false);
                        }}
                        className="block w-full truncate px-3 py-1.5 text-left text-[12px] text-fg-dim transition-colors hover:bg-hover hover:text-fg font-mono"
                        title={file.relativePath}
                      >
                        {file.relativePath}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PermissionBanner({ sessionId, activeTurn }: { sessionId: string; activeTurn: string | null }) {
  const t = useT();
  const pending = useAi((state) => state.pendingPermissions);
  const replyPermission = useAi((state) => state.replyPermission);
  const matching = pending.filter(
    (p) => !p.turnId || p.turnId === activeTurn || p.turnId.startsWith(`${sessionId}#`),
  );
  if (matching.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-amber-500/30 bg-amber-500/10 px-6 py-2.5">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-2">
        {matching.map((req) => (
          <div key={req.requestId} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-panel/95 px-3 py-2 shadow-sm">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-300">
                <Shield className="size-3.5 shrink-0" strokeWidth={2} />
                <span>{req.title || t("Confirmation required")}</span>
              </div>
              {req.detail && <div className="mt-0.5 text-[11.5px] text-fg-dim">{req.detail}</div>}
              {req.command && (
                <pre className="mt-1 max-h-24 overflow-auto rounded border border-line/60 bg-canvas px-2 py-1 font-mono text-[11px] text-fg select-text">
                  {req.command}
                </pre>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 self-center">
              <button
                type="button"
                onClick={() => void replyPermission(req.requestId, false, "Denied by user")}
                className="rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-fg-dim hover:bg-hover hover:text-fg transition-colors"
              >
                {t("Deny")}
              </button>
              <button
                type="button"
                onClick={() => void replyPermission(req.requestId, true)}
                className="rounded-md bg-amber-500/20 border border-amber-500/40 px-2.5 py-1 text-[11.5px] font-medium text-amber-200 hover:bg-amber-500/30 transition-colors"
              >
                {t("Allow")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const EFFORT_OPTIONS: { value: "fast" | "thinking"; label: string; desc: string }[] = [
  { value: "fast", label: "Fast", desc: "Quick, concise answers" },
  { value: "thinking", label: "Thinking", desc: "Deep, thorough analysis" },
];

function EffortToggle() {
  const t = useT();
  const effort = useAi((state) => state.effort);
  const setEffort = useAi((state) => state.setEffort);
  const [open, setOpen] = useState(false);

  const current = EFFORT_OPTIONS.find((o) => o.value === effort) ?? EFFORT_OPTIONS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("Response effort level")}
        aria-label={t("Response effort level")}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-fg-dim transition-colors hover:bg-hover hover:text-fg",
          open && "text-fg bg-hover",
        )}
      >
        {current.value === "fast" ? (
          <Zap className="size-3.5 text-fg-dim shrink-0" strokeWidth={2} />
        ) : (
          <Brain className="size-3.5 text-fg-dim shrink-0" strokeWidth={2} />
        )}
        <span>{t(current.label)}</span>
        <ChevronDown className={cn("size-3 shrink-0 opacity-60 transition-transform", open && "rotate-180")} strokeWidth={2} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="wide-pop-up absolute bottom-full right-0 z-50 mb-2 w-48 overflow-hidden rounded-xl border border-line bg-panel p-1 shadow-2xl">
            {EFFORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setEffort(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover",
                  effort === opt.value ? "bg-hover text-fg" : "text-fg-dim",
                )}
              >
                {opt.value === "fast" ? (
                  <Zap className="mt-0.5 size-3.5 text-fg-dim shrink-0" strokeWidth={2} />
                ) : (
                  <Brain className="mt-0.5 size-3.5 text-fg-dim shrink-0" strokeWidth={2} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium">{t(opt.label)}</div>
                  <div className="text-[10px] text-fg-faint">{t(opt.desc)}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function useSpeechInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const supported = typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const toggle = useCallback(() => {
    if (!supported) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const win = window as any;
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (event: any) => {
      const text = event.results?.[0]?.[0]?.transcript ?? "";
      if (text.trim()) onResult(text.trim());
      setListening(false);
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recognitionRef.current = r;
    r.start();
    setListening(true);
  }, [listening, onResult, supported]);

  return { listening, toggle, supported };
}

function EmptyChat() {
  const t = useT();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center py-8 text-center animate-in fade-in duration-300">
      <img
        src={wideLogo}
        alt=""
        draggable={false}
        className="mb-4 size-96 max-w-full object-contain select-none"
      />
      <h2 className="text-[17px] font-semibold text-fg tracking-tight">
        {t("How can I help you today?")}
      </h2>
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
  const [dismissedContext, setDismissedContext] = useState<string | null>(null);
  const lastKnownContext = useRef(context);

  useEffect(() => {
    if (context && context !== lastKnownContext.current) {
      setDismissedContext(null);
    }
    lastKnownContext.current = context;
  }, [context]);

  const effectiveContext = context && context !== dismissedContext ? context : null;

  const handleDismissContext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (context) {
      setDismissedContext(context);
    }
    useEditor.getState().clearLastFilePath();
  }, [context]);
  const { ready } = useModelLabel();

  const store = keptFor(id);
  const [draft, setDraft] = useState(store.draft);

  const onSpeechResult = useCallback((text: string) => {
    setDraft((current) => current ? `${current} ${text}` : text);
  }, []);
  const { listening, toggle: toggleSpeech, supported: speechSupported } = useSpeechInput(onSpeechResult);

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
    void useAi.getState().load();
  }, []);
  useEffect(() => {
    setSlashIndex(0);
    setSlashHidden(false);
  }, [draft]);
  const pickSlash = (command: { prompt: string; open?: boolean }) => {
    setDraft(command.open ? command.prompt : `${command.prompt} `);
    composer.current?.focus();
  };

  const openInstructions = useCallback(async () => {
    if (!root) {
      toast.error(t("Open a folder first."));
      return;
    }
    const sep = root.includes("\\") ? "\\" : "/";
    const targetPath = `${root.replace(/[\\/]+$/, "")}${sep}.wide${sep}ai-instructions.md`;
    try {
      const reply = await bridge.aiInstructionsGet(root);
      const filePath = reply?.ok && reply.path && reply.exists ? reply.path : targetPath;

      if (!reply?.exists) {
        const read = await bridge.readFile(filePath);
        if (read?.error) {
          await bridge.writeFile(filePath, "");
          void useWorkspace.getState().refresh();
        }
      }

      await useEditor.getState().openFile(filePath);
    } catch {
      toast.error(t("Project AI instructions could not be opened."));
    }
  }, [root, t]);

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
    void useAi.getState().ask(id, text, effectiveContext);
    composer.current?.focus();
  };

  const [inspectedFile, setInspectedFile] = useState<InspectorTarget | null>(null);

  const handleInspectFile = useCallback((target: InspectorTarget) => {
    setInspectedFile((current) => (current?.key === target.key ? null : target));
  }, []);

  const handleUndoToTurn = useCallback(
    async (turn: AiTurn) => {
      const ok = await confirm({
        title: t("Undo to this point?"),
        message: t("This will revert all file modifications and delete subsequent messages."),
        confirmLabel: t("Undo"),
        danger: true,
      });
      if (!ok) return;

      if (turn.role === "user" && turn.text) {
        setDraft(turn.text);
        composer.current?.focus();
      }

      await useAi.getState().undoToTurn(id, turn.id);
    },
    [id, t],
  );

  return (
    <div
      tabIndex={-1}
      className="wide-enter-fade flex h-full bg-canvas outline-none overflow-hidden"
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
        if (event.key === "Escape" && !active && inspectedFile) {
          event.preventDefault();
          setInspectedFile(null);
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
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <div ref={scroller} onScroll={onScroll} className="h-full overflow-auto">
            <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 py-5">
              {!chat?.loaded ? null : chat.turns.length === 0 ? (
                <EmptyChat />
              ) : (
                chat.turns.map((turn, index) => (
                  <Turn
                    key={turn.id}
                    turn={turn}
                    divider={turn.role === "user" && index > 0}
                    last={turn.role === "assistant" && index === chat.turns.length - 1 && !active}
                    activeInspectKey={inspectedFile?.key ?? ""}
                    onInspectFile={handleInspectFile}
                    onFailure={report}
                    onRegenerate={() => void useAi.getState().regenerate(id)}
                    onEdit={turn.role === "user" && !active ? (text) => { setDraft(text); composer.current?.focus(); } : undefined}
                    onUndoToHere={!active ? () => void handleUndoToTurn(turn) : undefined}
                  />
                ))
              )}
            </div>
          </div>

          {!atBottom && (
            <button
              type="button"
              onClick={toBottom}
              className="wide-enter-fade absolute bottom-4 right-8 flex items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 py-1.5 text-[11px] text-fg-dim shadow-xl transition-all duration-100 hover:bg-hover hover:text-fg hover:scale-105"
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
            className="wide-enter-fade shrink-0 border-t border-line px-6 py-2 text-left text-[12px] text-status-error bg-status-error/5 hover:bg-status-error/10 transition-colors"
          >
            {t(error)}
          </button>
        )}

        <PermissionBanner sessionId={id} activeTurn={active} />

        <div className="shrink-0 border-t border-line px-6 py-4">
          <div className="relative mx-auto w-full max-w-[760px]">
            {mentionOpen && (
              <div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-[min(380px,90%)] overflow-auto rounded-xl border border-line bg-panel py-1 shadow-2xl">
                {mentionMatches.map((file, index) => (
                  <button
                    key={file.path}
                    type="button"
                    ref={index === mentionIndex ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => pickMention(file)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-100",
                      index === mentionIndex ? "bg-hover" : "hover:bg-hover",
                    )}
                    title={file.relativePath}
                  >
                    <AtSign className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{file.relativePath}</span>
                  </button>
                ))}
              </div>
            )}
            {slashOpen && (
              <div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-[min(380px,90%)] overflow-auto rounded-xl border border-line bg-panel py-1 shadow-2xl">
                {slashMatches.map((command, index) => (
                  <button
                    key={command.name}
                    type="button"
                    ref={index === slashIndex ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                    onMouseEnter={() => setSlashIndex(index)}
                    onClick={() => pickSlash(command)}
                    className={cn(
                      "flex w-full items-baseline gap-2.5 px-3 py-2 text-left transition-colors duration-100",
                      index === slashIndex ? "bg-hover" : "hover:bg-hover",
                    )}
                  >
                    <span className="shrink-0 font-mono text-[11px] font-semibold text-accent">/{command.name}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg-dim">{t(command.label)}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="relative rounded-2xl border border-line bg-panel/95 shadow-lg backdrop-blur-sm p-2.5">
              {effectiveContext && (
                <div className="flex items-center gap-1.5 pb-2 px-1">
                  <span
                    className="group/ctx inline-flex items-center gap-1.5 rounded-md bg-canvas px-2 py-0.5 text-[11px] text-fg-dim border border-line/60 transition-colors hover:border-line"
                    title={effectiveContext}
                  >
                    <FileCode className="size-3 text-fg-dim shrink-0" strokeWidth={1.75} />
                    <span className="max-w-[200px] truncate select-none">{basename(effectiveContext)}</span>
                    <button
                      type="button"
                      onClick={handleDismissContext}
                      className="ml-0.5 flex size-3.5 items-center justify-center rounded text-fg-faint opacity-0 transition-opacity duration-150 hover:bg-hover hover:text-fg group-hover/ctx:opacity-100 focus:opacity-100"
                      aria-label={t("Remove")}
                      title={t("Remove")}
                    >
                      <X className="size-3" strokeWidth={2} />
                    </button>
                  </span>
                </div>
              )}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1 pb-2 px-1">
                  {attachments.map((path) => (
                    <span key={path} className="flex items-center gap-1 rounded-md bg-canvas px-2 py-0.5 text-[11px] text-fg-dim border border-line/60" title={path}>
                      <AtSign className="size-3 shrink-0 text-fg-dim" strokeWidth={1.75} />
                      <span className="max-w-[160px] truncate">{basename(path)}</span>
                      <button type="button" onClick={() => useAi.getState().detach(id, path)} className="text-fg-faint hover:text-fg ml-0.5" aria-label={t("Remove")}>
                        <X className="size-3" strokeWidth={2} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2 pb-2 px-1">
                  {images.map((image) => (
                    <span key={image.id} className="group/img relative block" title={image.name}>
                      <img
                        src={`data:${image.mime};base64,${image.data}`}
                        alt={image.name}
                        className="block size-14 rounded-lg border border-line object-cover shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => useAi.getState().detachImage(id, image.id)}
                        aria-label={t("Remove")}
                        className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-line bg-panel text-fg-faint opacity-0 transition-opacity duration-100 hover:text-fg group-hover/img:opacity-100 shadow"
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
                placeholder={ready ? t("Ask anything…") : t("Not set up yet")}
                rows={1}
                spellCheck={false}
                disabled={!ready || !root}
                className={cn(
                  "w-full resize-none overflow-auto bg-transparent px-2.5 py-1.5 outline-none",
                  "disabled:opacity-50 placeholder:text-fg-faint",
                  BODY,
                )}
              />

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-line/40">
                <div className="flex items-center gap-1 min-w-0">
                  <PlusMenu
                    session={id}
                    onInsertMention={() => {
                      setDraft((cur) => (cur ? cur.endsWith(" ") ? cur + "@" : cur + " @" : "@"));
                      composer.current?.focus();
                    }}
                    onPickImage={() => void pickImage()}
                    onExport={(chat?.turns?.length ?? 0) > 0 ? () => void exportConversation() : undefined}
                    onOpenInstructions={root ? () => void openInstructions() : undefined}
                    onCompact={contextTokens > 0 ? () => void useAi.getState().compactChat(id) : undefined}
                  />
                  <ModelPicker className="border-none bg-transparent hover:bg-hover text-fg-dim px-2 py-1 text-[12px]" />
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <EffortToggle />
                  {speechSupported && (
                    <button
                      type="button"
                      onClick={toggleSpeech}
                      title={listening ? t("Stop listening") : t("Speak your message")}
                      aria-label={listening ? t("Stop listening") : t("Speak your message")}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg text-fg-dim transition-colors hover:bg-hover hover:text-fg",
                        listening && "bg-accent/15 text-accent animate-pulse",
                      )}
                    >
                      {listening ? <MicOff className="size-4" strokeWidth={1.75} /> : <Mic className="size-4" strokeWidth={1.75} />}
                    </button>
                  )}
                  {active ? (
                    <button
                      type="button"
                      onClick={() => void useAi.getState().stop(id)}
                      title={t("Stop")}
                      aria-label={t("Stop")}
                      disabled={stopping}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full bg-rose-500 hover:bg-rose-600 text-white shadow-sm transition-all active:scale-95",
                        stopping && "opacity-60",
                      )}
                    >
                      <Square className="size-3.5 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={submit}
                      disabled={!draft.trim() || !ready || !root || !loaded}
                      title={t("Send")}
                      aria-label={t("Send")}
                      className="flex size-8 items-center justify-center rounded-full bg-accent hover:opacity-90 text-white shadow-sm transition-all active:scale-95 disabled:opacity-35 disabled:pointer-events-none"
                    >
                      <ArrowRight className="size-4" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {inspectedFile && (
        <DiffSlidePanel target={inspectedFile} onClose={() => setInspectedFile(null)} />
      )}
    </div>
  );
}
