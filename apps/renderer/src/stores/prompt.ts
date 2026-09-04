import { create } from "zustand";

export interface PromptOptions {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
}

interface Pending extends PromptOptions {
  resolve: (value: string | null) => void;
}

interface PromptState {
  pending: Pending | null;
  answer(value: string | null): void;
}

export const usePrompt = create<PromptState>((set, get) => ({
  pending: null,
  answer: (value) => {
    const p = get().pending;
    if (p) {
      p.resolve(value);
      set({ pending: null });
    }
  },
}));

export function promptText(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const existing = usePrompt.getState().pending;
    if (existing) existing.resolve(null);
    usePrompt.setState({ pending: { ...options, resolve } });
  });
}
