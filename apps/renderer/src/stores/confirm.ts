import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmState {
  pending: Pending | null;
  answer(value: boolean): void;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  pending: null,
  answer: (value) => {
    const p = get().pending;
    if (p) {
      p.resolve(value);
      set({ pending: null });
    }
  },
}));

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {

    const existing = useConfirm.getState().pending;
    if (existing) existing.resolve(false);
    useConfirm.setState({ pending: { ...options, resolve } });
  });
}
