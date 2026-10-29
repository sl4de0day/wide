import { create } from "zustand";
import { getSelectedTextAndHandler } from "@/lib/transformSelection";
import { toast } from "@/stores/toast";

interface TransformModalState {
  isOpen: boolean;
  selectedText: string;
  applyFn: ((text: string) => void) | null;
  openModal(): void;
  closeModal(): void;
  apply(transformed: string): void;
}

export const useTransformModal = create<TransformModalState>((set, get) => ({
  isOpen: false,
  selectedText: "",
  applyFn: null,
  openModal: () => {
    const target = getSelectedTextAndHandler();
    if (!target) {
      toast.info("Select text in the editor or input field first.");
      return;
    }
    set({
      isOpen: true,
      selectedText: target.text,
      applyFn: target.apply,
    });
  },
  closeModal: () => {
    set({ isOpen: false, selectedText: "", applyFn: null });
  },
  apply: (transformed: string) => {
    const applyFn = get().applyFn;
    if (applyFn) {
      applyFn(transformed);
    }
    get().closeModal();
  },
}));
