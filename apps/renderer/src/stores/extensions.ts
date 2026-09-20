import { create } from "zustand";

import { preloadGrammar } from "@/editor/languages";
import { bridge, type ServerRecord } from "@/lib/bridge";

const DEBUGGER_FOR_LANGUAGE: Record<string, string> = {
  python: "python-debugger",
  go: "go-debugger",
  ruby: "ruby-debugger",
};
const LANGUAGE_FOR_DEBUGGER: Record<string, string> = {
  "python-debugger": "python",
  "go-debugger": "go",
  "ruby-debugger": "ruby",
};
const LANGUAGE_NAME: Record<string, string> = { python: "Python", go: "Go", ruby: "Ruby" };

export type ExtensionStage = "preparing" | "installing" | "removing" | "cancelling";

export interface ExtensionOperation {
  stage: ExtensionStage;
  startedAt: number;
}

const DEADLINE_MS = 10000;

export function withDeadline<T>(work: Promise<T>, onTimeout: () => T, deadlineMs = DEADLINE_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, deadlineMs);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface ExtensionsState {
  installed: Set<string>;

  loading: boolean;

  busy: Set<string>;
  operations: Record<string, ExtensionOperation>;

  servers: Record<string, ServerRecord | null>;
  error: string | null;

  refresh(): Promise<void>;
  install(id: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;

  retryServer(id: string): Promise<void>;

  cancel(id: string): Promise<void>;
}

type Setter = (
  partial:
    | Partial<ExtensionsState>
    | ((state: ExtensionsState) => Partial<ExtensionsState>),
) => void;

const INSTALL_FLOOR_MS = 1200;

const atLeast = async <T,>(work: Promise<T>, ms: number): Promise<T> => {
  const [value] = await Promise.all([work, new Promise((done) => setTimeout(done, ms))]);
  return value;
};

async function change(set: Setter, verb: "install" | "remove", id: string) {
  if (!id) return false;

  if (verb === "install") {
    const requiredLang = LANGUAGE_FOR_DEBUGGER[id];
    if (requiredLang && !useExtensions.getState().installed.has(requiredLang)) {
      set({ error: `Install the ${LANGUAGE_NAME[requiredLang] ?? requiredLang} extension first — its debugger installs with it.` });
      return false;
    }
  }

  const initialStage: ExtensionStage = verb === "install" ? "preparing" : "removing";

  set((state) => {
    const busy = new Set(state.busy);
    busy.add(id);
    return {
      busy,
      operations: {
        ...state.operations,
        [id]: { stage: initialStage, startedAt: Date.now() },
      },
      error: null,
    };
  });

  try {
    if (verb === "install") {
      await preloadGrammar(id);

      if (useExtensions.getState().operations[id]?.stage === "cancelling") {
        return false;
      }

      const prepared = await bridge.extensionPrepare(id);
      if (prepared.cancelled) {
        return false;
      }

      if (useExtensions.getState().operations[id]?.stage === "cancelling") {
        return false;
      }

      if (prepared.ok) {
        set((state) => ({ servers: { ...state.servers, [id]: prepared.server ?? null } }));
      }

      set((state) => ({
        operations: {
          ...state.operations,
          [id]: { stage: "installing", startedAt: Date.now() },
        },
      }));
    }

    if (useExtensions.getState().operations[id]?.stage === "cancelling") {
      return false;
    }

    const installWork = withDeadline(
      verb === "install" ? bridge.extensionInstall(id) : bridge.extensionRemove(id),
      () => ({ ok: false, error: "The host did not answer.", installed: [] as string[] }),
    );

    const reply = verb === "install" ? await atLeast(installWork, INSTALL_FLOOR_MS) : await installWork;

    if (reply.ok) set({ installed: new Set(reply.installed ?? []) });
    if (reply.error) set({ error: reply.error });

    if (reply.ok && verb === "install") {
      const companion = DEBUGGER_FOR_LANGUAGE[id];
      if (companion && !useExtensions.getState().installed.has(companion)) {
        void change(set, "install", companion);
      }
    }
    return Boolean(reply.ok);
  } catch (error) {
    set({ error: String((error as Error)?.message ?? error) });
    return false;
  } finally {
    set((state) => {
      const busy = new Set(state.busy);
      busy.delete(id);
      const operations = { ...state.operations };
      delete operations[id];
      return { busy, operations };
    });
  }
}

export const useExtensions = create<ExtensionsState>((set) => ({
  installed: new Set<string>(),
  loading: true,
  busy: new Set<string>(),
  operations: {},
  servers: {},
  error: null,

  refresh: async () => {
    try {
      const [reply, found] = await Promise.all([
        bridge.extensionsList(),
        bridge.extensionServers(),
      ]);
      set({
        installed: new Set(reply.installed ?? []),
        servers: found.ok ? (found.servers ?? {}) : {},
        loading: false,
        error: null,
      });
    } catch (error) {
      set({ loading: false, error: String((error as Error)?.message ?? error) });
    }
  },

  install: async (id) => change(set, "install", id),
  remove: async (id) => change(set, "remove", id),

  cancel: async (id) => {
    if (!id) return;
    set((state) => {
      if (!state.busy.has(id)) return state;
      return {
        operations: {
          ...state.operations,
          [id]: { stage: "cancelling", startedAt: Date.now() },
        },
      };
    });
    try {
      await bridge.extensionCancelPrepare(id);
    } catch {
    }
  },

  retryServer: async (id) => {
    if (!id) return;
    set((state) => {
      const busy = new Set(state.busy);
      busy.add(id);
      return {
        busy,
        operations: {
          ...state.operations,
          [id]: { stage: "preparing", startedAt: Date.now() },
        },
        error: null,
      };
    });
    try {
      const prepared = await bridge.extensionPrepare(id);

      if (prepared.ok && !prepared.cancelled) {
        set((state) => ({ servers: { ...state.servers, [id]: prepared.server ?? null } }));
      }
    } catch (error) {
      set({ error: String((error as Error)?.message ?? error) });
    } finally {
      set((state) => {
        const busy = new Set(state.busy);
        busy.delete(id);
        const operations = { ...state.operations };
        delete operations[id];
        return { busy, operations };
      });
    }
  },
}));

export const useInstalled = (id: string, removable: boolean): boolean =>
  useExtensions((state) => !removable || state.installed.has(id));

export const useExtensionOperation = (id: string) =>
  useExtensions((state) => state.operations[id]);
