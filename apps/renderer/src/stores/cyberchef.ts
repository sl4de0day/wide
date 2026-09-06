import { create } from "zustand";

import { useEditor } from "./editor";

interface CyberchefState {
  input: string;
  seq: number;
  send(value: string): void;
}

export const useCyberchef = create<CyberchefState>((set) => ({
  input: "",
  seq: 0,
  send: (value) => {
    set((state) => ({ input: value, seq: state.seq + 1 }));
    useEditor.getState().openCyberchef();
  },
}));
