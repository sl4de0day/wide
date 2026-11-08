import { useConfirm } from "@/stores/confirm";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { Modal } from "./ui/Modal";

export function ConfirmHost() {
  const t = useT();
  const pending = useConfirm((s) => s.pending);
  const answer = useConfirm((s) => s.answer);
  if (!pending) return null;

  return (
    <Modal title={pending.title} onClose={() => answer(false)}>
      <div className="flex flex-col gap-4">
        {pending.message && <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg-dim">{pending.message}</p>}
        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => answer(false)}
            className="rounded-md border border-line px-3.5 py-1.5 text-[12px] font-medium text-fg-dim transition-colors duration-150 hover:bg-hover hover:text-fg"
          >
            {pending.cancelLabel ?? t("Cancel")}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => answer(true)}
            className={cn(
              "rounded-md border px-3.5 py-1.5 text-[12px] font-medium transition-colors duration-150",
              pending.danger
                ? "border-status-error bg-status-error/10 text-status-error hover:bg-status-error hover:text-fg-bright"
                : "border-accent bg-accent/10 text-accent hover:bg-accent hover:text-fg-bright",
            )}
          >
            {pending.confirmLabel ?? t("OK")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
