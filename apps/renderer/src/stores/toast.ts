import { create } from "zustand";

export type ToastKind = "info" | "error" | "success";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastItem extends Toast {
  timestamp: number;
}

interface ToastState {
  toasts: Toast[];
  history: ToastItem[];
  push(kind: ToastKind, message: string, ttlMs?: number): number;
  dismiss(id: number): void;
  clearHistory(): void;
}

let seq = 0;

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  history: [],
  push: (kind, message, ttlMs = kind === "error" ? 7000 : 4000) => {
    const id = (seq += 1);
    const item: ToastItem = { id, kind, message, timestamp: Date.now() };
    set((s) => ({
      toasts: [...s.toasts, { id, kind, message }],
      history: [item, ...s.history].slice(0, 50),
    }));
    if (ttlMs > 0) {
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttlMs);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearHistory: () => set({ history: [] }),
}));

export const toast = {
  info: (m: string) => useToast.getState().push("info", m),
  error: (m: string) => useToast.getState().push("error", m),
  success: (m: string) => useToast.getState().push("success", m),
};
