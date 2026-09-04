import { create } from "zustand";

import { basename } from "@/lib/utils";
import type { CodeLocation } from "@/lib/bridge";
import { useEditor } from "./editor";

export interface ReferenceGroup {
  file: string;
  name: string;
  locations: CodeLocation[];
}

interface ReferencesState {

  query: string;
  groups: ReferenceGroup[];
  total: number;
  open: boolean;

  show(fromFile: string, locations: CodeLocation[]): void;
  go(location: CodeLocation): void;
  close(): void;
}

export const useReferences = create<ReferencesState>((set) => ({
  query: "",
  groups: [],
  total: 0,
  open: false,

  show: (fromFile, locations) => {
    const byFile = new Map<string, CodeLocation[]>();
    for (const location of locations) {
      const list = byFile.get(location.file);
      if (list) list.push(location);
      else byFile.set(location.file, [location]);
    }

    const groups: ReferenceGroup[] = [...byFile.entries()]
      .map(([file, locs]) => ({ file, name: basename(file), locations: locs }))
      .sort((a, b) => {
        if (a.file === fromFile) return -1;
        if (b.file === fromFile) return 1;
        return a.name.localeCompare(b.name);
      });
    set({ query: basename(fromFile), groups, total: locations.length, open: locations.length > 0 });
  },

  go: (location) => void useEditor.getState().revealOffset(location.file, location.start),

  close: () => set({ open: false }),
}));
