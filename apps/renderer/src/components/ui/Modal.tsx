import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { useT } from "@/lib/i18n";

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    if (!(panel && panel.contains(document.activeElement) && document.activeElement !== panel)) {
      const focusables = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];

      const target = focusables.find((el) => el.dataset.modalClose !== "true") ?? focusables[0] ?? panel;
      target?.focus();
    }
    return () => {

      returnFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {

        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={
          "wide-enter-fade fixed left-1/2 top-12 z-50 flex max-h-[84vh] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl outline-none " +
          (wide ? "w-[min(900px,94vw)]" : "w-[min(620px,94vw)]")
        }
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <span className="flex-1 text-[12px] font-medium text-fg">{title}</span>
          <button type="button" onClick={onClose} data-modal-close="true" aria-label={t("Close")} className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
      </div>
    </>
  );
}
