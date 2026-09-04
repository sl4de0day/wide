import { create } from "zustand";

import { bridge } from "@/lib/bridge";
import { useEditor } from "./editor";

export interface PendingEdit {
  id: string;
  path: string;
  root: string;

  content: string;

  oldContent: string;
}

export function applyAiEdit(path: string, root: string, content: string): void {
  const open = useEditor.getState().tabs.some((tab) => tab.path === path);
  if (open) useEditor.getState().replaceContent(path, content);
  else void bridge.aiCommitFile(root, path, content);
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
  accept(id: string): void;
  reject(id: string): void;
  acceptAll(): void;
  rejectAll(): void;
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

  queue: async (edit) => {
    const tab = useEditor.getState().tabs.find((t) => t.path === edit.path);
    let oldContent = "";
    if (tab && tab.kind === "file") oldContent = tab.content;
    else {
      const file = await bridge.readFile(edit.path);
      oldContent = file?.content ?? "";
    }
    set((state) => ({
      pending: [...state.pending, { id: crypto.randomUUID(), oldContent, ...edit }],
    }));
  },

  accept: (id) => {
    const edit = get().pending.find((e) => e.id === id);
    if (edit) applyAiEdit(edit.path, edit.root, edit.content);
    set((state) => ({ pending: state.pending.filter((e) => e.id !== id) }));
  },

  reject: (id) => set((state) => ({ pending: state.pending.filter((e) => e.id !== id) })),

  acceptAll: () => {
    for (const edit of get().pending) applyAiEdit(edit.path, edit.root, edit.content);
    set({ pending: [] });
  },

  rejectAll: () => set({ pending: [] }),
}));
