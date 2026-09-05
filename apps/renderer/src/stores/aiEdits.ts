import { create } from "zustand";

import { bridge } from "@/lib/bridge";
import { t } from "@/lib/i18n";
import { repointPath, useEditor } from "./editor";
import { toast } from "./toast";

export interface PendingEdit {
  id: string;
  path: string;
  root: string;

  content: string;

  oldContent: string;

  existed: boolean;
}

type EditOutcome = "applied" | "gone" | "failed" | "busy";

function openBuffer(path: string): string | null {
  const tab = useEditor.getState().tabs.find((item) => item.path === path);
  return tab && tab.kind === "file" && !tab.tooLarge ? tab.content : null;
}

type DiskRead = { kind: "content"; content: string } | { kind: "missing" } | { kind: "unreadable" };

const MISSING = /ENOENT|no such file|cannot find/i;

async function diskRead(path: string): Promise<DiskRead> {
  try {
    const file = await bridge.readFile(path);
    if (!file) return { kind: "unreadable" };
    if (file.error) return MISSING.test(file.error) ? { kind: "missing" } : { kind: "unreadable" };
    return { kind: "content", content: file.tooLarge ? "" : file.content };
  } catch (error) {
    return MISSING.test(String((error as Error)?.message ?? error)) ? { kind: "missing" } : { kind: "unreadable" };
  }
}

async function diskContent(path: string): Promise<string | null> {
  const read = await diskRead(path);
  return read.kind === "content" ? read.content : null;
}

async function writeAiEdit(path: string, root: string, content: string, mustExist: boolean): Promise<EditOutcome> {
  if (openBuffer(path) !== null) {
    useEditor.getState().updateContent(path, content);
    return "applied";
  }
  if (mustExist) {
    const read = await diskRead(path);
    if (read.kind === "missing") {
      console.error(`The assistant's edit targets a file that is no longer there: ${path}`);
      return "gone";
    }
    if (read.kind === "unreadable") {
      console.error(`The assistant's edit could not be checked against disk: ${path}`);
      return "failed";
    }
  }
  try {
    const reply = await bridge.aiCommitFile(root, path, content);
    if (reply?.ok) return "applied";
    console.error(`The assistant's edit was refused: ${path}`, reply?.error);
  } catch (error) {
    console.error(`The assistant's edit could not be written: ${path}`, error);
  }
  return "failed";
}

export function applyAiEdit(path: string, root: string, content: string, mustExist = false): void {
  void writeAiEdit(path, root, content, mustExist)
    .then((outcome) => {
      if (outcome !== "applied") toast.error(t("The edits could not be applied."));
    })
    .catch(() => toast.error(t("The edits could not be applied.")));
}

const KEY = "wide.reviewAiEdits";
const loadReview = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
};

interface AiEditsState {
  reviewEnabled: boolean;
  pending: PendingEdit[];
  setReview(on: boolean): void;
  queue(edit: { path: string; root: string; content: string }): Promise<void>;
  accept(id: string): Promise<void>;
  reject(id: string): void;
  acceptAll(): Promise<void>;
  rejectAll(): void;
  relocate(oldPath: string, newPath: string): void;
}

let queued: Promise<void> = Promise.resolve();
const applying = new Set<string>();

async function applyPending(id: string): Promise<EditOutcome> {
  const edit = useAiEdits.getState().pending.find((item) => item.id === id);
  if (!edit || applying.has(id)) return "busy";
  applying.add(id);
  let outcome: EditOutcome;
  try {
    outcome = await writeAiEdit(edit.path, edit.root, edit.content, edit.existed);
  } catch {
    outcome = "failed";
  } finally {
    applying.delete(id);
  }
  if (outcome !== "failed") {
    useAiEdits.setState((state) => ({ pending: state.pending.filter((item) => item.id !== id) }));
  }
  return outcome;
}

export const useAiEdits = create<AiEditsState>((set, get) => ({
  reviewEnabled: loadReview(),
  pending: [],

  setReview: (on) => {
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {

    }
    set({ reviewEnabled: on });
  },

  queue: (edit) => {
    const done = queued.then(async () => {
      try {
        const previous = [...get().pending].reverse().find((item) => item.path === edit.path);
        const buffer = openBuffer(edit.path);
        const known = previous?.content ?? buffer;
        const disk = known === null ? await diskContent(edit.path) : null;
        set((state) => ({
          pending: [
            ...state.pending,
            {
              id: crypto.randomUUID(),
              ...edit,
              oldContent: known ?? disk ?? "",
              existed: previous ? previous.existed : buffer !== null || disk !== null,
            },
          ],
        }));
      } catch (error) {
        console.error(`The assistant's edit could not be queued: ${edit.path}`, error);
      }
    });
    queued = done;
    return done;
  },

  accept: async (id) => {
    const outcome = await applyPending(id);
    if (outcome === "failed" || outcome === "gone") toast.error(t("The edits could not be applied."));
  },

  reject: (id) => set((state) => ({ pending: state.pending.filter((e) => e.id !== id) })),

  acceptAll: async () => {
    let refused = false;
    for (const edit of get().pending) {
      const outcome = await applyPending(edit.id);
      if (outcome === "failed" || outcome === "gone") refused = true;
    }
    if (refused) toast.error(t("The edits could not be applied."));
  },

  rejectAll: () => set({ pending: [] }),

  relocate: (oldPath, newPath) =>
    set((state) => ({
      pending: state.pending.map((edit) => {
        const path = repointPath(edit.path, oldPath, newPath);
        return path === edit.path ? edit : { ...edit, path };
      }),
    })),
}));
