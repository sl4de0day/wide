import { create } from "zustand";

import {
  bridge,
  type AiConfig,
  type AiEvent,
  type AiHardware,
  type AiMessage,
  type AiModelFile,
  type AiSearchResult,
  type AiSessionMeta,
} from "@/lib/bridge";
import { AI_CHAT_PATH, useEditor } from "./editor";
import { applyAiEdit, useAiEdits } from "./aiEdits";
import { useWorkspace } from "./workspace";

export interface AiToolStep {
  kind: "tool";
  name: string;
  input: unknown;
  result: string;
  done: boolean;
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
}

export interface AiChat {
  id: string;
  root: string;
  turns: AiTurn[];
  history: AiMessage[];

  activeTurn: string | null;
  error: string;

  loaded: boolean;
}

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
  error: "",
  loaded: false,
});

interface AiState {
  config: AiConfig | null;
  keys: Record<string, boolean>;
  hardware: AiHardware | null;

  sessions: AiSessionMeta[];

  chats: Record<string, AiChat>;

  query: string;
  results: AiSearchResult[];
  searching: boolean;
  files: Record<string, AiModelFile[]>;
  expanded: string | null;
  recommended: { label: string; vendor: string; query: string; found: boolean; id?: string }[];
  installed: { name: string; size: number; quantization: string; parameters: string }[];
  ollama: { running: boolean; installed: boolean };
  pulls: Record<string, AiPullState>;

  error: string;
  busy: boolean;

  revealTurn: { session: string; index: number } | null;

  attachments: string[];
  attach(path: string): void;
  detach(path: string): void;

  load(): Promise<void>;
  listSessions(): Promise<void>;
  newSession(): Promise<string>;
  openChat(id: string): Promise<void>;
  closeChat(id: string): void;
  deleteSession(id: string): Promise<void>;

  setConfig(patch: Partial<AiConfig>): Promise<void>;
  setKey(provider: string, key: string): Promise<boolean>;

  ask(sessionId: string, text: string): Promise<void>;
  stop(sessionId: string): Promise<void>;

  setQuery(query: string): void;
  search(): Promise<void>;
  expand(id: string, source: string): Promise<void>;
  pull(reference: string): Promise<void>;
  refreshLocal(): Promise<void>;
  setupOllama(): Promise<void>;
}

const root = () => useWorkspace.getState().root ?? "";

function systemPrompt(): string {
  const workspace = useWorkspace.getState();

  const open = useEditor.getState().lastFilePath ?? "";
  return [
    "You are the assistant inside Wide, a code editor.",
    workspace.root ? `The open project is at ${workspace.root}.` : "No project is open.",
    open ? `The file the person is looking at is ${open}.` : "",
    "Use the tools to look at the project rather than guessing or asking the person to paste code.",
    "When you change a file, read it first: write_file replaces the whole file.",
    "Be brief. Answer the question that was asked.",
  ]
    .filter(Boolean)
    .join("\n");
}

let turnCounter = 0;
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

export const useAi = create<AiState>((set, get) => ({
  config: null,
  keys: {},
  hardware: null,
  sessions: [],
  chats: {},
  query: "",
  results: [],
  searching: false,
  files: {},
  expanded: null,
  recommended: [],
  installed: [],
  ollama: { running: false, installed: false },
  pulls: {},
  error: "",
  busy: false,
  revealTurn: null,
  attachments: [],

  load: async () => {
    const [config, keys] = await Promise.all([bridge.aiConfig(), bridge.aiKeyStatus()]);
    set({
      config: config.ok ? (config.config ?? null) : null,
      keys: keys.ok ? (keys.configured ?? {}) : {},
    });
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
    if (!chat || chat.activeTurn) return;
    set((state) => {
      const chats = { ...state.chats };
      delete chats[id];
      return { chats };
    });
  },

  deleteSession: async (id) => {
    await bridge.aiDeleteSession(id);
    useEditor.getState().closeTab(`${AI_CHAT_PATH}${id}`);
    set((state) => {
      const chats = { ...state.chats };
      delete chats[id];
      return { chats, sessions: state.sessions.filter((session) => session.id !== id) };
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

  attach: (path) =>
    set((state) => (state.attachments.includes(path) ? state : { attachments: [...state.attachments, path] })),
  detach: (path) => set((state) => ({ attachments: state.attachments.filter((p) => p !== path) })),

  ask: async (sessionId, text) => {
    const message = text.trim();
    const chat = get().chats[sessionId];
    if (!message || !chat || chat.activeTurn) return;
    const config = get().config;
    if (!config) return;

    const id = turnId(sessionId);
    const provider = config.tab === "local" ? "local" : config.provider;
    const model = config.tab === "local" ? config.localModel : config.cloudModel[config.provider] ?? "";

    const attachments = get().attachments;
    let contextBlock = "";
    if (attachments.length > 0) {
      const parts: string[] = [];
      for (const path of attachments) {
        const file = await bridge.readFile(path);
        if (file && file.content != null) parts.push(`=== ${path} ===\n${file.content}`);
      }
      if (parts.length) contextBlock = `Attached files for context:\n\n${parts.join("\n\n")}\n\n`;
      set({ attachments: [] });
    }

    const projectRoot = chat.root || root();
    const history: AiMessage[] = [...chat.history, { role: "user", content: message }];
    const providerMessages: AiMessage[] = [...chat.history, { role: "user", content: contextBlock + message }];

    set((state) => ({
      chats: patchChat(state.chats, sessionId, (current) => ({
        ...current,
        root: projectRoot,
        history,
        activeTurn: id,
        error: "",
        turns: [
          ...current.turns,
          { id: `${id}-user`, role: "user", text: message, thinking: "", steps: [], error: "", usage: null, streaming: false },
          { id, role: "assistant", text: "", thinking: "", steps: [], error: "", usage: null, streaming: true },
        ],
      })),
    }));

    const reply = await bridge.aiSend({
      id,
      root: projectRoot,
      provider,
      model,
      messages: providerMessages,
      system: systemPrompt(),
    });

    set((state) => ({
      chats: patchChat(state.chats, sessionId, (current) => ({
        ...current,
        activeTurn: current.activeTurn === id ? null : current.activeTurn,
        turns: current.turns.map((turn) => (turn.id === id ? { ...turn, streaming: false } : turn)),

        error: reply.ok || reply.error === "no-key" || reply.error === "stopped"
          ? current.error
          : (reply.error ?? current.error),
      })),
    }));

    const finished = get().chats[sessionId]?.turns.find((turn) => turn.id === id);
    if (!finished?.text) return;

    const next = [...(get().chats[sessionId]?.history ?? []), { role: "assistant" as const, content: finished.text }];
    set((state) => ({ chats: patchChat(state.chats, sessionId, (current) => ({ ...current, history: next })) }));

    const saved = await bridge.aiSaveSession(sessionId, projectRoot, next);

    if (saved.ok && saved.session) {
      const meta = saved.session;
      useEditor.getState().setTabName(`${AI_CHAT_PATH}${sessionId}`, meta.title || "…");
      set((state) => ({
        sessions: [meta, ...state.sessions.filter((session) => session.id !== sessionId)],
      }));
    }
  },

  stop: async (sessionId) => {
    const id = get().chats[sessionId]?.activeTurn;
    if (!id) return;
    await bridge.aiStop(id);
    set((state) => ({
      chats: patchChat(state.chats, sessionId, (current) => ({ ...current, activeTurn: null })),
    }));
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
      hardware: reply.hardware ?? null,
    });
    if (get().recommended.length === 0) {
      const suggested = await bridge.aiRecommended();
      if (suggested.ok) set({ recommended: suggested.models ?? [] });
    }
  },

  setupOllama: async () => {
    set({ busy: true, error: "" });
    const reply = await bridge.aiLocalSetup();
    set({ busy: false, error: reply.ok ? "" : (reply.error ?? "Ollama could not be started.") });
    await get().refreshLocal();
  },
}));

export function subscribeAiEvents(): () => void {
  return bridge.onAiEvent((event: AiEvent) => {
    if (event.type === "open") {
      void useEditor.getState().revealAt(event.path, event.line, 1);
      return;
    }
    if (event.type === "edit") {

      if (useAiEdits.getState().reviewEnabled) {
        void useAiEdits.getState().queue({ path: event.path, root: event.root ?? "", content: event.content });
      } else {
        applyAiEdit(event.path, event.root ?? "", event.content);
      }
      return;
    }

    const sessionId = sessionOf(event.id);
    useAi.setState((state) => ({
      chats: patchChat(state.chats, sessionId, (chat) => ({
        ...chat,
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
                steps: [...turn.steps, { kind: "tool", name: event.name, input: event.input, result: "", done: false }],
              };
            case "tool_end": {

              const steps = [...turn.steps];
              for (let index = steps.length - 1; index >= 0; index -= 1) {
                if (steps[index].name === event.name && !steps[index].done) {
                  steps[index] = { ...steps[index], result: event.result, done: true };
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
              return { ...turn, error: event.message, streaming: false };
            case "done":
              return { ...turn, streaming: false };
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
    }));
  });
}
