import { create } from "zustand";

import {
  bridge,
  type AiCloudProviderTelemetry,
  type AiConfig,
  type AiEvent,
  type AiHardware,
  type AiMessage,
  type AiModelFile,
  type AiRunningLocalModel,
  type AiSearchResult,
  type AiSessionMeta,
  type AiSystemResources,
  type Ok,
} from "@/lib/bridge";
import { t } from "@/lib/i18n";
import { basename } from "@/lib/utils";
import { AI_CHAT_PATH, useEditor } from "./editor";
import { useCatcher, type CatcherTool } from "./catcher";
import { applyAiEdit, useAiEdits } from "./aiEdits";
import { useWorkspace } from "./workspace";
import { useSettings } from "./settings";
import { toast } from "./toast";

export interface AiToolStep {
  kind: "tool";
  name: string;
  input: unknown;
  result: string;
  done: boolean;
  startedAt?: number;
  endedAt?: number;
  filePath?: string;
  oldContent?: string;
  newContent?: string;
  existed?: boolean;
  added?: number;
  removed?: number;
}

export interface AiTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  steps: AiToolStep[];
  error: string;
  usage: { input: number; output: number; total: number } | null;
  streaming: boolean;
  startedAt?: number;
  endedAt?: number;
}

export interface AiChat {
  id: string;
  root: string;
  turns: AiTurn[];
  history: AiMessage[];

  activeTurn: string | null;
  stopping: boolean;
  error: string;

  loaded: boolean;
}

export interface AiImage {
  id: string;
  name: string;
  mime: string;

  data: string;
}

export const AI_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const AI_IMAGE_MAX_COUNT = 4;

export const AI_IMAGE_PROVIDERS = new Set(["claude", "deepseek", "local"]);

export interface AiPullState {
  reference: string;
  status: string;
  total: number;
  completed: number;
  error: string;
}

const emptyChat = (id: string, root: string): AiChat => ({
  id,
  root,
  turns: [],
  history: [],
  activeTurn: null,
  stopping: false,
  error: "",
  loaded: false,
});

export type AiEffort = "fast" | "thinking";

interface AiState {
  config: AiConfig | null;
  keys: Record<string, boolean>;
  hardware: AiHardware | null;

  sessions: AiSessionMeta[];

  chats: Record<string, AiChat>;

  effort: AiEffort;
  setEffort(effort: AiEffort): void;

  query: string;
  results: AiSearchResult[];
  searching: boolean;
  files: Record<string, AiModelFile[]>;
  expanded: string | null;
  recommended: { label: string; vendor: string; query: string; found: boolean; id?: string }[];
  installed: {
    name: string;
    size: number;
    quantization: string;
    parameters: string;
    family?: string;
    fit?: "gpu" | "cpu" | "no" | "unknown";
    neededBytes?: number;
    fitRatio?: number;
  }[];
  runningModels: AiRunningLocalModel[];
  systemResources: AiSystemResources | null;
  cloudTelemetry: Record<string, AiCloudProviderTelemetry>;
  ollama: { running: boolean; installed: boolean };
  pulls: Record<string, AiPullState>;

  error: string;
  busy: boolean;

  revealTurn: { session: string; index: number } | null;

  pendingDraft: { session: string; text: string } | null;
  setPendingDraft(session: string, text: string): void;

  attachments: Record<string, string[]>;
  attach(sessionId: string, path: string): void;
  detach(sessionId: string, path: string): void;

  images: Record<string, AiImage[]>;
  attachImage(sessionId: string, image: Omit<AiImage, "id">): boolean;
  detachImage(sessionId: string, id: string): void;

  load(): Promise<void>;
  listSessions(): Promise<void>;
  newSession(): Promise<string>;
  openChat(id: string): Promise<void>;
  closeChat(id: string): void;
  deleteSession(id: string): Promise<void>;

  setConfig(patch: Partial<AiConfig>): Promise<void>;
  setKey(provider: string, key: string): Promise<boolean>;

  ask(sessionId: string, text: string, activeFile?: string | null): Promise<void>;
  regenerate(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  compactChat(sessionId: string): Promise<void>;
  undoToTurn(sessionId: string, targetTurnId: string): Promise<void>;

  setQuery(query: string): void;
  search(): Promise<void>;
  expand(id: string, source: string): Promise<void>;
  pull(reference: string): Promise<void>;
  refreshLocal(): Promise<void>;
  refreshTelemetry(): Promise<void>;
  setupOllama(): Promise<void>;
  ollamaStatusText: string;
  ollamaError: string | null;
  clearOllamaError(): void;
}

const root = () => useWorkspace.getState().root ?? "";

const INSTRUCTION_FILES = [".wide/ai-instructions.md", ".wide/ai-instructions"];
const instructionCache = new Map<string, string>();

async function projectInstructions(projectRoot: string): Promise<string> {
  if (!projectRoot) return "";
  try {
    if (typeof bridge.aiInstructionsGet === "function") {
      const reply = await bridge.aiInstructionsGet(projectRoot);
      if (reply?.ok && typeof reply.content === "string") {
        const trimmed = reply.content.trim();
        instructionCache.set(projectRoot, trimmed);
        return trimmed;
      }
    }
  } catch {
  }
  const separator = projectRoot.includes("\\") ? "\\" : "/";
  const base = projectRoot.replace(/[\\/]+$/, "");
  let found = "";
  for (const relative of INSTRUCTION_FILES) {
    const path = `${base}${separator}${separator === "\\" ? relative.replace(/\//g, "\\") : relative}`;
    try {
      const file = await bridge.readFile(path);
      if (file && !file.error && !file.tooLarge && file.content) {
        found = String(file.content).trim();
        if (found) break;
      }
    } catch {
    }
  }
  instructionCache.set(projectRoot, found);
  return found;
}

export function forgetProjectInstructions(projectRoot?: string): void {
  if (projectRoot) instructionCache.delete(projectRoot);
  else instructionCache.clear();
}

function systemPrompt(instructions = "", effort: AiEffort = "fast", activeFile?: string | null): string {
  const workspace = useWorkspace.getState();
  const open = activeFile !== undefined ? (activeFile ?? "") : (useEditor.getState().lastFilePath ?? "");
  const language = useSettings.getState().language;

  const LANGUAGE_NAMES: Record<string, string> = {
    tr: "Turkish", es: "Spanish", de: "German", fr: "French",
    it: "Italian", ja: "Japanese", ko: "Korean",
  };
  const langLine = language !== "en" && LANGUAGE_NAMES[language]
    ? `Always respond in ${LANGUAGE_NAMES[language]}. Tüm yanıtlarda, teknik açıklamalarda ve özetlerde daima ${LANGUAGE_NAMES[language]} dilini kullan.`
    : "";

  const openTabs = useEditor.getState().tabs
    .map((tab) => (tab.path ? basename(tab.path) : tab.name))
    .filter(Boolean)
    .slice(0, 20);

  const openTabsLine = openTabs.length > 0
    ? `Currently open tabs in the editor: ${openTabs.join(", ")}.`
    : "";

  const effortLine =
    effort === "thinking"
      ? "Effort level: THINKING. Think carefully and thoroughly before acting. Enclose your reasoning in <think>...</think>, use tools to inspect the codebase, verify assumptions, write or edit project files directly, and provide a complete response."
      : "Effort level: FAST. Act directly and efficiently. Immediately use your tools (write_file, edit_file, read_file, list_dir, search, run_command) to create or modify project files as requested, and keep your chat summary brief.";

  return [
    "You are Wide Agent, an autonomous AI software engineering and security agent built directly into Wide IDE.",
    "Wide IDE is a specialized development environment unifying full-stack coding with web application security tools (Pitcher API client, Catcher web proxy, Security AST Scanner, CyberChef/Decoder, Git, and Terminal).",
    workspace.root ? `The open project workspace is at: ${workspace.root}` : "No project workspace is currently open.",
    open ? `The file currently active in the editor is: ${open}` : "",
    openTabsLine,
    "You are an action-oriented coding agent, NOT a passive chatbot.",
    "You have full programmatic control over Wide's built-in tools via native tool calls:",
    "- Pitcher: Dispatch HTTP requests with `send_http_request` and reveal the UI with `open_tool_tab({ tab: 'pitcher' })`.",
    "- Catcher: Control the intercepting proxy, check status, view captured traffic, and toggle intercept with `manage_catcher` and reveal with `open_tool_tab({ tab: 'catcher', subtool: 'proxy' })`.",
    "- Security: Trigger AST vulnerability scans with `run_security_scan` and CVE audits with `check_dependencies`.",
    "- Decoder: Encode/decode/hash data with `transform_data` and inspect errors with `get_diagnostics`.",
    "NEVER tell the user 'I cannot click Pitcher/Catcher in the UI' or 'Pitcher/Catcher'ı doğrudan UI üzerinden tıklayamam'. You DO NOT need to click UI buttons; you operate them directly via your tools!",
    "When the user asks you to write code, test an endpoint, or demonstrate Pitcher and Catcher, actively invoke your tools (send_http_request, manage_catcher, open_tool_tab, write_file, edit_file) instead of giving passive instructions.",
    "When the user asks you to write a script, create a file, implement code, fix a bug, or modify the project, DO NOT write the code in the chat window as a message. You MUST use write_file or edit_file to create or modify the actual files in the project workspace.",
    "If the user asks to write a script or code without naming a file, choose a sensible filename in the project and call write_file to create it on disk.",
    "When modifying an existing file, read it first with read_file, then apply the change with edit_file or write_file.",
    effortLine,
    langLine,
    instructions ? `\nProject instructions from .wide/ai-instructions (follow these):\n${instructions}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

let turnCounter = 0;
let imageCounter = 0;
const turnId = (sessionId: string) => `${sessionId}#${(turnCounter += 1)}`;
const sessionOf = (id: string) => id.split("#")[0];

const patchChat = (
  chats: Record<string, AiChat>,
  id: string,
  change: (chat: AiChat) => AiChat,
): Record<string, AiChat> => {
  const chat = chats[id];
  if (!chat) return chats;
  return { ...chats, [id]: change(chat) };
};

const dropAttachments = (
  attachments: Record<string, string[]>,
  sessionId: string,
): Record<string, string[]> => {
  if (!attachments[sessionId]) return attachments;
  const rest = { ...attachments };
  delete rest[sessionId];
  return rest;
};

const dropImages = (images: Record<string, AiImage[]>, sessionId: string): Record<string, AiImage[]> => {
  if (!images[sessionId]) return images;
  const rest = { ...images };
  delete rest[sessionId];
  return rest;
};

function alternating(messages: AiMessage[]): AiMessage[] {
  const merged: AiMessage[] = [];
  for (const message of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      merged[merged.length - 1] = {
        ...last,
        content: [last.content, message.content].filter(Boolean).join("\n\n"),
      };
      continue;
    }
    merged.push(message);
  }
  return merged;
}

const STOP_RETRY_MS = 300;
const STOP_RETRIES = 200;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const useAi = create<AiState>((set, get) => ({
  config: null,
  keys: {},
  hardware: null,
  sessions: [],
  chats: {},
  effort: "fast" as AiEffort,
  setEffort: (effort) => set({ effort }),
  query: "",
  results: [],
  searching: false,
  files: {},
  expanded: null,
  recommended: [],
  installed: [],
  runningModels: [],
  systemResources: null,
  cloudTelemetry: {},
  ollama: { running: false, installed: true },
  ollamaStatusText: "",
  ollamaError: null,
  pulls: {},
  error: "",
  busy: false,
  revealTurn: null,
  pendingDraft: null,
  attachments: {},

  setPendingDraft: (session, text) => set({ pendingDraft: { session, text } }),

  load: async () => {
    const [config, keys] = await Promise.all([bridge.aiConfig(), bridge.aiKeyStatus()]);
    set({
      config: config.ok ? (config.config ?? null) : null,
      keys: keys.ok ? (keys.configured ?? {}) : {},
    });
    void get().refreshLocal();
    await get().listSessions();
  },

  listSessions: async () => {
    const reply = await bridge.aiSessions(root());
    if (reply.ok) set({ sessions: reply.sessions ?? [] });
  },

  newSession: async () => {
    const reply = await bridge.aiNewSession(root());
    const id = reply.ok && reply.session ? reply.session.id : "";
    if (!id) {
      set({ error: reply.error ?? "That conversation could not be started." });
      return "";
    }
    set((state) => ({
      chats: { ...state.chats, [id]: { ...emptyChat(id, root()), loaded: true } },
    }));
    return id;
  },

  openChat: async (id) => {
    const existing = get().chats[id];
    if (existing?.loaded) return;
    set((state) => ({ chats: { ...state.chats, [id]: existing ?? emptyChat(id, root()) } }));

    const reply = await bridge.aiSession(id);
    const messages = reply.ok && reply.session ? reply.session.messages : [];
    set((state) => ({
      chats: patchChat(state.chats, id, (chat) => ({
        ...chat,
        loaded: true,
        root: reply.ok && reply.session ? reply.session.root || chat.root : chat.root,
        history: messages,

        turns: messages
          .filter((message) => message.role === "user" || (message.role === "assistant" && message.content))
          .map((message, index) => ({
            id: `${id}#saved-${index}`,
            role: message.role === "user" ? ("user" as const) : ("assistant" as const),
            text: String(message.content ?? ""),
            thinking: "",
            steps: [],
            error: "",
            usage: null,
            streaming: false,
          })),
      })),
    }));
  },

  closeChat: (id) => {
    const chat = get().chats[id];
    if (!chat) return;
    if (chat.activeTurn) {
      set((state) => ({ attachments: dropAttachments(state.attachments, id), images: dropImages(state.images, id) }));
      return;
    }
    set((state) => {
      const chats = { ...state.chats };
      delete chats[id];
      return { chats, attachments: dropAttachments(state.attachments, id), images: dropImages(state.images, id) };
    });
  },

  deleteSession: async (id) => {
    await bridge.aiDeleteSession(id);
    useEditor.getState().closeTab(`${AI_CHAT_PATH}${id}`);
    set((state) => {
      const chats = { ...state.chats };
      delete chats[id];
      return {
        chats,
        attachments: dropAttachments(state.attachments, id),
        images: dropImages(state.images, id),
        sessions: state.sessions.filter((session) => session.id !== id),
      };
    });
  },

  setConfig: async (patch) => {
    const reply = await bridge.aiConfig(patch);
    if (reply.ok) set({ config: reply.config ?? null });
  },

  setKey: async (provider, key) => {
    set({ busy: true, error: "" });

    const verified = await bridge.aiVerifyKey(provider, key);
    if (!verified.ok) {
      set({ busy: false, error: verified.error ?? "That key was refused." });
      return false;
    }
    await bridge.aiSetKey(provider, key);
    const status = await bridge.aiKeyStatus();
    set({ busy: false, keys: status.ok ? (status.configured ?? {}) : {} });
    return true;
  },

  attach: (sessionId, path) =>
    set((state) => {
      const held = state.attachments[sessionId] ?? [];
      if (held.includes(path)) return state;
      return { attachments: { ...state.attachments, [sessionId]: [...held, path] } };
    }),
  detach: (sessionId, path) =>
    set((state) => ({
      attachments: {
        ...state.attachments,
        [sessionId]: (state.attachments[sessionId] ?? []).filter((held) => held !== path),
      },
    })),

  images: {},

  attachImage: (sessionId, image) => {
    const held = get().images[sessionId] ?? [];
    if (held.length >= AI_IMAGE_MAX_COUNT) return false;

    if (Math.ceil((image.data.length * 3) / 4) > AI_IMAGE_MAX_BYTES) return false;
    imageCounter += 1;
    const entry: AiImage = { ...image, id: `img-${imageCounter}` };
    set((state) => ({ images: { ...state.images, [sessionId]: [...(state.images[sessionId] ?? []), entry] } }));
    return true;
  },

  detachImage: (sessionId, id) =>
    set((state) => ({
      images: {
        ...state.images,
        [sessionId]: (state.images[sessionId] ?? []).filter((held) => held.id !== id),
      },
    })),

  ask: async (sessionId, text, activeFile) => {
    const message = text.trim();
    const chat = get().chats[sessionId];
    if (!message || !chat || chat.activeTurn) return;
    const config = get().config;
    if (!config) return;

    const id = turnId(sessionId);
    set((state) => ({
      chats: patchChat(state.chats, sessionId, (current) => ({ ...current, activeTurn: id, stopping: false })),
    }));
    const provider = config.tab === "local" ? "local" : config.provider;
    const model = config.tab === "local" ? config.localModel : config.cloudModel[config.provider] ?? "";

    const attachments = get().attachments[sessionId] ?? [];
    const parts: string[] = [];
    const missing: string[] = [];
    for (const path of attachments) {
      try {
        const file = await bridge.readFile(path);
        if (file && !file.error && !file.tooLarge && file.content != null) {
          parts.push(`=== ${path} ===\n${file.content}`);
        } else {
          missing.push(path);
        }
      } catch {
        missing.push(path);
      }
    }
    const contextBlock = parts.length ? `Attached files for context:\n\n${parts.join("\n\n")}\n\n` : "";
    const unreadable = missing.length
      ? t("{name} could not be opened.", { name: missing.map(basename).join(", ") })
      : "";

    const projectRoot = chat.root || root();
    let cut = chat.history.length;
    while (cut > 0 && chat.history[cut - 1]?.role === "user") cut -= 1;
    const answered = chat.history.slice(0, cut);
    const images = get().images[sessionId] ?? [];
    const history: AiMessage[] = [...chat.history, { role: "user", content: message }];
    const providerMessages = alternating([...answered, { role: "user", content: contextBlock + message }]);

    if (images.length > 0) {
      const last = providerMessages[providerMessages.length - 1];
      if (last && last.role === "user") {
        providerMessages[providerMessages.length - 1] = {
          ...last,
          images: images.map((image) => ({ mime: image.mime, data: image.data })),
        };
      }
    }

    const turnStartedAt = Date.now();
    set((state) => ({
      chats: patchChat(state.chats, sessionId, (current) => ({
        ...current,
        root: projectRoot,
        history,
        activeTurn: id,
        stopping: false,
        error: unreadable,
        turns: [
          ...current.turns,
          { id: `${id}-user`, role: "user", text: message, thinking: "", steps: [], error: "", usage: null, streaming: false, startedAt: turnStartedAt },
          { id, role: "assistant", text: "", thinking: "", steps: [], error: "", usage: null, streaming: true, startedAt: turnStartedAt },
        ],
      })),
    }));

    const editorState = useEditor.getState();
    const openTabs = (editorState.tabs || []).map((t) => ({
      name: t.name,
      path: t.path,
      kind: t.kind,
      active: t.path === editorState.activePath,
    }));

    const reply = await bridge
      .aiSend({
        id,
        root: projectRoot,
        provider,
        model,
        messages: providerMessages,
        system: systemPrompt(await projectInstructions(projectRoot), get().effort, activeFile),
        effort: get().effort,
        openTabs,
      })
      .catch(
        (failure: unknown): Ok<{ answered?: boolean }> => ({
          ok: false,
          error: failure instanceof Error ? failure.message : String(failure),
        }),
      );

    if ((reply.ok || reply.error === "stopped") && attachments.length > 0) {
      set((state) => ({
        attachments: {
          ...state.attachments,
          [sessionId]: (state.attachments[sessionId] ?? []).filter((held) => !attachments.includes(held)),
        },
      }));
    }

    if ((reply.ok || reply.error === "stopped") && images.length > 0) {
      const sent = new Set(images.map((image) => image.id));
      set((state) => ({
        images: {
          ...state.images,
          [sessionId]: (state.images[sessionId] ?? []).filter((held) => !sent.has(held.id)),
        },
      }));
    }

    set((state) => ({
      chats: patchChat(state.chats, sessionId, (current) => ({
        ...current,
        activeTurn: current.activeTurn === id ? null : current.activeTurn,
        stopping: current.activeTurn === id ? false : current.stopping,
        turns: current.turns.map((turn) => (turn.id === id ? { ...turn, streaming: false, endedAt: turn.endedAt ?? Date.now() } : turn)),

        error: reply.ok || reply.error === "no-key" || reply.error === "stopped"
          ? current.error
          : (reply.error ?? current.error),
      })),
    }));

    const settled = get().chats[sessionId];
    if (!settled || settled.activeTurn) return;
    if (settled.history[settled.history.length - 1]?.role !== "user") return;

    const answer = settled.turns.find((turn) => turn.id === id)?.text ?? "";
    const next = answer
      ? [...settled.history, { role: "assistant" as const, content: answer }]
      : settled.history;
    if (answer) {
      set((state) => ({ chats: patchChat(state.chats, sessionId, (current) => ({ ...current, history: next })) }));
    }

    const saved = await bridge
      .aiSaveSession(sessionId, projectRoot, next)
      .catch((): Ok<{ session?: AiSessionMeta }> => ({ ok: false }));

    if (saved.ok && saved.session) {
      const meta = saved.session;
      useEditor.getState().setTabName(`${AI_CHAT_PATH}${sessionId}`, meta.title || "…");
      set((state) => ({
        sessions: [meta, ...state.sessions.filter((session) => session.id !== sessionId)],
      }));
    }
  },

  regenerate: async (sessionId) => {
    const chat = get().chats[sessionId];
    if (!chat || chat.activeTurn || !chat.loaded) return;

    let turnIndex = chat.turns.length - 1;
    while (turnIndex >= 0 && chat.turns[turnIndex].role !== "user") turnIndex -= 1;
    if (turnIndex < 0) return;
    const text = chat.turns[turnIndex].text;
    if (!text.trim()) return;

    const keptTurns = chat.turns.slice(0, turnIndex);
    let cut = chat.history.length;
    while (cut > 0 && chat.history[cut - 1]?.role === "assistant") cut -= 1;
    while (cut > 0 && chat.history[cut - 1]?.role === "user") cut -= 1;
    const keptHistory = chat.history.slice(0, cut);

    set((state) => ({
      chats: patchChat(state.chats, sessionId, (current) => ({
        ...current,
        turns: keptTurns,
        history: keptHistory,
        error: "",
      })),
    }));
    await get().ask(sessionId, text);
  },

  stop: async (sessionId) => {
    const chat = get().chats[sessionId];
    const id = chat?.activeTurn;
    if (!chat || !id || chat.stopping) return;
    set((state) => ({
      chats: patchChat(state.chats, sessionId, (current) =>
        current.activeTurn === id ? { ...current, stopping: true } : current,
      ),
    }));

    for (let attempt = 0; attempt < STOP_RETRIES; attempt += 1) {
      const reply = await bridge.aiStop(id).catch((): Ok<{ stopped?: boolean }> => ({ ok: false }));
      if (reply.stopped) return;
      if (get().chats[sessionId]?.activeTurn !== id) return;
      await pause(STOP_RETRY_MS);
    }

    set((state) => ({
      chats: patchChat(state.chats, sessionId, (current) =>
        current.activeTurn === id
          ? { ...current, activeTurn: null, stopping: false, error: "The assistant could not be stopped." }
          : current,
      ),
    }));
  },

  compactChat: async (sessionId) => {
    const chat = get().chats[sessionId];
    if (!chat || chat.history.length <= 4) {
      toast.info(t("Conversation is already compact."));
      return;
    }
    const recent = chat.history.slice(-4);
    const older = chat.history.slice(0, -4);
    const summarySnippet = older
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${(m.content ?? "").slice(0, 150)}...`)
      .join("\n");
    const compressed: AiMessage[] = [
      {
        role: "user",
        content: `[Previous conversation summary]\n${summarySnippet}\n\n[End of summary. Continue assisting based on the above background.]`,
      },
      {
        role: "assistant",
        content: "I have the summary of our earlier discussion and will continue from here.",
      },
      ...recent,
    ];
    set((state) => ({
      chats: patchChat(state.chats, sessionId, (c) => ({
        ...c,
        history: compressed,
      })),
    }));
    toast.success(t("Context compacted successfully."));
  },

  undoToTurn: async (sessionId: string, targetTurnId: string) => {
    const chat = get().chats[sessionId];
    if (!chat || chat.activeTurn || !chat.loaded) return;

    const targetIndex = chat.turns.findIndex((t) => t.id === targetTurnId);
    if (targetIndex < 0) return;

    const discardedTurns = chat.turns.slice(targetIndex);
    if (discardedTurns.length === 0) return;

    const projectRoot = chat.root || useWorkspace.getState().root || "";

    const fileRollbackMap = new Map<string, { path: string; root: string; existed: boolean; oldContent: string }>();

    for (const turn of discardedTurns) {
      for (const step of turn.steps) {
        let path = step.filePath;
        if (!path && typeof step.input === "object" && step.input && "path" in step.input) {
          const rawPath = String((step.input as { path?: unknown }).path || "").trim();
          if (rawPath) {
            path = rawPath.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(rawPath)
              ? rawPath
              : projectRoot
                ? `${projectRoot.replace(/[/\\]$/, "")}/${rawPath}`
                : rawPath;
          }
        }
        if (!path) continue;

        const isModifyingStep =
          step.name === "write_file" ||
          step.name === "edit_file" ||
          step.name === "delete_file" ||
          step.oldContent !== undefined ||
          step.newContent !== undefined;

        if (isModifyingStep && !fileRollbackMap.has(path)) {
          fileRollbackMap.set(path, {
            path,
            root: projectRoot,
            existed: step.existed !== false,
            oldContent: step.oldContent ?? "",
          });
        }
      }
    }

    for (const entry of fileRollbackMap.values()) {
      try {
        if (!entry.existed) {
          await bridge.trash(entry.path).catch(() => {});
          useEditor.getState().closeTab(entry.path);
        } else {
          await bridge.aiCommitFile(entry.root, entry.path, entry.oldContent).catch(async () => {
            await bridge.writeFile(entry.path, entry.oldContent).catch(() => {});
          });
          const openTab = useEditor.getState().tabs.find((t) => t.path === entry.path);
          if (openTab) {
            useEditor.getState().replaceContent(entry.path, entry.oldContent);
            void useEditor.getState().reloadFromDisk(entry.path);
          }
        }
      } catch (err) {
        console.error("Failed to rollback file:", entry.path, err);
      }
    }

    if (fileRollbackMap.size > 0) {
      void useWorkspace.getState().refresh();
    }

    const keptTurns = chat.turns.slice(0, targetIndex);
    const keptHistory = keptTurns
      .filter((t) => t.text.trim().length > 0)
      .map((t) => ({ role: t.role, content: t.text }));

    set((state) => ({
      chats: patchChat(state.chats, sessionId, (c) => ({
        ...c,
        turns: keptTurns,
        history: keptHistory,
        error: "",
      })),
    }));

    void bridge.aiSaveSession(sessionId, projectRoot, keptHistory).catch(() => {});

    toast.success(t("Rolled back changes and restored chat to this point."));
  },

  setQuery: (query) => set({ query }),

  search: async () => {
    const query = get().query.trim();
    if (query.length < 2) {
      set({ results: [], searching: false });
      return;
    }
    set({ searching: true });
    const reply = await bridge.aiSearch(query, 20);

    if (get().query.trim() !== query) return;
    set({
      searching: false,
      results: reply.ok ? (reply.results ?? []) : [],
      error: reply.ok ? "" : (reply.error ?? ""),
    });
  },

  expand: async (id, source) => {
    if (get().expanded === id) {
      set({ expanded: null });
      return;
    }
    set({ expanded: id });
    if (get().files[id]) return;
    const reply = await bridge.aiFiles(source, id);
    if (reply.ok) set((state) => ({ files: { ...state.files, [id]: reply.files ?? [] } }));
  },

  pull: async (reference) => {
    set((state) => ({
      pulls: {
        ...state.pulls,
        [reference]: { reference, status: "starting", total: 0, completed: 0, error: "" },
      },
    }));
    const reply = await bridge.aiLocalPull(reference);
    if (!reply.ok) {
      set((state) => ({
        pulls: {
          ...state.pulls,
          [reference]: { ...state.pulls[reference], status: "error", error: reply.error ?? "" },
        },
        error: reply.error ?? "",
      }));
      return;
    }
    await get().refreshLocal();
  },

  refreshLocal: async () => {
    const reply = await bridge.aiLocalStatus();
    if (!reply.ok) return;
    set({
      ollama: { running: Boolean(reply.running), installed: Boolean(reply.installed) },
      installed: reply.models ?? [],
      runningModels: reply.runningModels ?? get().runningModels,
      hardware: reply.hardware ?? null,
    });
    if (get().recommended.length === 0) {
      const suggested = await bridge.aiRecommended();
      if (suggested.ok) set({ recommended: suggested.models ?? [] });
    }
  },

  refreshTelemetry: async () => {
    try {
      const reply = await bridge.aiTelemetry();
      if (!reply.ok) return;
      set({
        systemResources: reply.system ?? get().systemResources,
        runningModels: reply.runningModels ?? get().runningModels,
        cloudTelemetry: reply.cloud ?? get().cloudTelemetry,
      });
    } catch {
    }
  },

  setupOllama: async () => {
    const isInstalled = get().ollama.installed;
    const initialStatus = isInstalled
      ? t("Starting Ollama service and waiting for connection…")
      : t("Downloading and installing Ollama (this may take a few minutes)…");
    set({ busy: true, error: "", ollamaStatusText: initialStatus, ollamaError: null });
    toast.info(initialStatus);

    try {
      const reply = await bridge.aiLocalSetup();
      if (reply && reply.ok) {
        set({ busy: false, ollamaStatusText: "", ollamaError: null });
        toast.success(t("Ollama is running and ready!"));
        await get().refreshLocal();
      } else {
        const errMsg = reply?.error || t("Ollama could not be started.");
        set({ busy: false, ollamaStatusText: "", ollamaError: errMsg });
        toast.error(errMsg);
        await get().refreshLocal();
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err || t("Ollama could not be started."));
      set({ busy: false, ollamaStatusText: "", ollamaError: errMsg });
      toast.error(errMsg);
      await get().refreshLocal();
    }
  },

  clearOllamaError: () => set({ ollamaError: null }),
}));

export function openWideToolTab(tool: string, subtool?: string): void {
  const norm = (tool || "").toLowerCase().trim();
  if (norm === "pitcher") {
    useEditor.getState().openPitcher();
  } else if (norm === "browser") {
    useEditor.getState().openBrowser();
  } else if (norm === "cyberchef" || norm === "decoder") {
    useEditor.getState().openCyberchef();
  } else if (norm === "scratchpad") {
    useEditor.getState().openScratchpad();
  } else if (norm === "settings") {
    useEditor.getState().openSettings();
  } else if (
    norm === "catcher" ||
    norm === "scanner" ||
    norm === "proxy" ||
    norm === "repeater" ||
    norm === "intruder" ||
    norm === "target" ||
    norm === "sequencer" ||
    norm === "collaborator" ||
    norm === "vault" ||
    norm === "miner"
  ) {
    const catcherSub = (subtool || (norm !== "catcher" ? norm : "proxy")) as CatcherTool;
    useCatcher.getState().show(catcherSub);
  } else {
    window.dispatchEvent(new CustomEvent("wide:open-panel", { detail: norm }));
  }
}

export function subscribeAiEvents(): () => void {
  return bridge.onAiEvent((event: AiEvent) => {
    if (event.type === "open_tool") {
      openWideToolTab(event.tool, event.subtool);
      return;
    }
    if (event.type === "open") {
      void useEditor.getState().revealAt(event.path, event.line, 1);
      return;
    }
    if (event.type === "edit") {
      if (useAiEdits.getState().reviewEnabled) {
        void useAiEdits.getState().queue({ path: event.path, root: event.root ?? "", content: event.content });
      } else {
        applyAiEdit(event.path, event.root ?? "", event.content, event.existed === true);
      }
    }

    const sessionId = sessionOf(event.id);
    const settles = event.type === "done";
    const now = Date.now();
    useAi.setState((state) => ({
      chats: patchChat(state.chats, sessionId, (chat) => ({
        ...chat,
        activeTurn: settles && chat.activeTurn === event.id ? null : chat.activeTurn,
        stopping: settles && chat.activeTurn === event.id ? false : chat.stopping,
        turns: chat.turns.map((turn) => {
          if (turn.id !== event.id) return turn;
          switch (event.type) {
            case "text":
              return { ...turn, text: turn.text + event.text };
            case "thinking":
              return { ...turn, thinking: turn.thinking + event.text };
            case "tool_start":
              return {
                ...turn,
                steps: [
                  ...turn.steps,
                  { kind: "tool", name: event.name, input: event.input, result: "", done: false, startedAt: now },
                ],
              };
            case "edit": {
              const steps = [...turn.steps];
              const editAdded = typeof event.added === "number" ? event.added : undefined;
              const editRemoved = typeof event.removed === "number" ? event.removed : undefined;
              for (let index = steps.length - 1; index >= 0; index -= 1) {
                if ((steps[index].name === "write_file" || steps[index].name === "edit_file") && !steps[index].done) {
                  steps[index] = {
                    ...steps[index],
                    filePath: event.path,
                    oldContent: event.oldContent ?? "",
                    newContent: event.content,
                    existed: Boolean(event.existed),
                    added: editAdded ?? steps[index].added,
                    removed: editRemoved ?? steps[index].removed,
                  };
                  return { ...turn, steps };
                }
              }
              if (steps.length > 0) {
                const lastIdx = steps.length - 1;
                steps[lastIdx] = {
                  ...steps[lastIdx],
                  filePath: event.path,
                  oldContent: event.oldContent ?? "",
                  newContent: event.content,
                  existed: Boolean(event.existed),
                  added: editAdded ?? steps[lastIdx].added,
                  removed: editRemoved ?? steps[lastIdx].removed,
                };
              }
              return { ...turn, steps };
            }
            case "file_read": {
              const steps = [...turn.steps];
              for (let index = steps.length - 1; index >= 0; index -= 1) {
                if (steps[index].name === "read_file" && !steps[index].done) {
                  steps[index] = {
                    ...steps[index],
                    filePath: event.path,
                    newContent: event.content,
                  };
                  return { ...turn, steps };
                }
              }
              return turn;
            }
            case "tool_end": {
              const steps = [...turn.steps];
              for (let index = steps.length - 1; index >= 0; index -= 1) {
                if (steps[index].name === event.name && !steps[index].done) {
                  steps[index] = { ...steps[index], result: event.result, done: true, endedAt: now };
                  break;
                }
              }
              return { ...turn, steps };
            }
            case "usage":
              return {
                ...turn,
                usage: {
                  input: (turn.usage?.input ?? 0) + event.input,
                  output: (turn.usage?.output ?? 0) + event.output,
                  total: (turn.usage?.total ?? 0) + event.total,
                },
              };
            case "error":
              return { ...turn, error: event.message, streaming: false, endedAt: turn.endedAt ?? now };
            case "done":
              return { ...turn, streaming: false, endedAt: turn.endedAt ?? now };
            default:
              return turn;
          }
        }),
      })),
    }));
  });
}

export function subscribeAiPulls(): () => void {
  return bridge.onAiPull((event) => {
    useAi.setState((state) => ({
      pulls: {
        ...state.pulls,
        [event.reference]: {
          reference: event.reference,
          status: event.status ?? "",
          total: event.total ?? 0,
          completed: event.completed ?? 0,
          error: event.error ?? "",
        },
      },
      error: event.error || state.error,
    }));
  });
}
