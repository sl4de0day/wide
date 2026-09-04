import { create } from "zustand";

import { bridge, type CodeAction } from "@/lib/bridge";
import { applyWorkspaceEdit } from "@/lib/workspaceEdit";

interface ActionContext {
  engine: "ts" | "lsp";
  root: string;
  file: string;
  start: number;
  end: number;
}

interface CodeActionState {
  active: boolean;
  x: number;
  y: number;
  actions: CodeAction[];
  busy: boolean;
  error: string;
  context: ActionContext | null;

  open(context: ActionContext, actions: CodeAction[], x: number, y: number): void;
  run(index: number): Promise<void>;
  cancel(): void;
}

export const useCodeAction = create<CodeActionState>((set, get) => ({
  active: false,
  x: 0,
  y: 0,
  actions: [],
  busy: false,
  error: "",
  context: null,

  open: (context, actions, x, y) => set({ active: true, context, actions, x, y, error: "", busy: false }),

  run: async (index) => {
    const { actions, context } = get();
    const action = actions[index];
    if (!action || !context) return;
    set({ busy: true, error: "" });

    let files = action.files;

    if (!files && action.refactor && action.action && context.engine === "ts") {
      const result = await bridge.tsRefactorEdits(
        context.root,
        context.file,
        context.start,
        context.end,
        action.refactor,
        action.action,
      );
      if (result.error || !result.files.length) {
        set({ busy: false, error: result.error ?? "That refactor produced no change." });
        return;
      }
      files = result.files;
    }
    if (!files) {
      set({ busy: false, error: "That action has nothing to apply." });
      return;
    }

    const applied = await applyWorkspaceEdit(files);
    if (!applied.ok) {
      set({ busy: false, error: applied.error ?? "The edits could not be applied." });
      return;
    }
    set({ active: false, actions: [], context: null, busy: false });
  },

  cancel: () => set({ active: false, actions: [], context: null, error: "" }),
}));
