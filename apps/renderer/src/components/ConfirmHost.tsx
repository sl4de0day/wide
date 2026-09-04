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
        {pending.message && <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-fg-dim">{pending.message}</p>}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => answer(false)}
            className="rounded-sm border border-line px-3 py-1 text-[12px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            {pending.cancelLabel ?? t("Cancel")}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => answer(true)}
            className={cn(
              "rounded-sm border px-3 py-1 text-[12px] transition-colors duration-100",
              pending.danger
                ? "border-status-error text-status-error hover:bg-status-error hover:text-fg-bright"
                : "border-accent text-accent hover:bg-hover hover:text-fg",
            )}
          >
            {pending.confirmLabel ?? t("OK")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
