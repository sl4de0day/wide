import { create } from "zustand";

import { bridge } from "@/lib/bridge";
import { applyWorkspaceEdit, type FileEdits } from "@/lib/workspaceEdit";

interface RenamePayload {

  engine: "ts" | "lsp";
  root: string;
  file: string;

  position: number;
  line: number;
  character: number;
  oldName: string;

  x: number;
  y: number;
}

interface RenameState {
  active: boolean;
  oldName: string;
  x: number;
  y: number;
  busy: boolean;
  error: string;
  payload: RenamePayload | null;

  open(payload: RenamePayload): void;
  cancel(): void;
  submit(newName: string): Promise<void>;
}

export const useRename = create<RenameState>((set, get) => ({
  active: false,
  oldName: "",
  x: 0,
  y: 0,
  busy: false,
  error: "",
  payload: null,

  open: (payload) =>
    set({ active: true, payload, oldName: payload.oldName, x: payload.x, y: payload.y, error: "", busy: false }),

  cancel: () => set({ active: false, payload: null, error: "", busy: false }),

  submit: async (newName) => {
    const payload = get().payload;
    const name = newName.trim();
    if (!payload || !name || name === payload.oldName) {
      set({ active: false, payload: null });
      return;
    }
    set({ busy: true, error: "" });

    let changes: FileEdits[] = [];
    if (payload.engine === "ts") {
      const result = await bridge.tsRename(payload.root, payload.file, payload.position);
      if (!result.canRename || !result.locations) {
        set({ busy: false, error: result.error ?? "This cannot be renamed." });
        return;
      }

      const byFile = new Map<string, FileEdits>();
      for (const loc of result.locations) {
        const group = byFile.get(loc.file) ?? { file: loc.file, edits: [] };
        group.edits.push({
          start: loc.start,
          length: loc.length,
          newText: `${loc.prefix ?? ""}${name}${loc.suffix ?? ""}`,
        });
        byFile.set(loc.file, group);
      }
      changes = [...byFile.values()];
    } else {
      const result = await bridge.lspRename(payload.file, payload.line, payload.character, name);
      if (!result.ok || !result.files) {
        set({ busy: false, error: result.error ?? "The rename was refused." });
        return;
      }
      changes = result.files;
    }

    const applied = await applyWorkspaceEdit(changes);
    if (!applied.ok) {
      set({ busy: false, error: applied.error ?? "The edits could not be applied." });
      return;
    }
    set({ active: false, payload: null, busy: false, error: "" });
  },
}));
