import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { useT } from "@/lib/i18n";
import { useToast, type ToastKind } from "@/stores/toast";
import { cn } from "@/lib/utils";

const ICON: Record<ToastKind, typeof Info> = { info: Info, success: CheckCircle2, error: AlertTriangle };
const TONE: Record<ToastKind, string> = {
  info: "text-fg-dim",
  success: "text-status-ok",
  error: "text-status-error",
};

export function Toasts() {
  const t = useT();
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  const polite = toasts.filter((t) => t.kind !== "error");
  const assertive = toasts.filter((t) => t.kind === "error");

  const row = (kind: ToastKind, id: number, message: string) => {
    const Icon = ICON[kind];
    return (
      <div key={id} className="wide-enter-side pointer-events-auto flex items-start gap-2 rounded-md border border-line bg-raised px-3 py-2 shadow-lg">
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", TONE[kind])} strokeWidth={2} />
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[11px] text-fg">{message}</span>
        <button type="button" onClick={() => dismiss(id)} aria-label={t("Dismiss")} className="shrink-0 rounded-sm p-0.5 text-fg-faint hover:bg-hover hover:text-fg">
          <X className="size-3" strokeWidth={2} />
        </button>
      </div>
    );
  };

  return (
    <div className="pointer-events-none fixed bottom-8 right-3 z-[60] flex w-[min(360px,90vw)] flex-col gap-2">
      <div aria-live="polite" role="status" className="flex flex-col gap-2">
        {polite.map((t) => row(t.kind, t.id, t.message))}
      </div>
      <div aria-live="assertive" role="alert" className="flex flex-col gap-2">
        {assertive.map((t) => row(t.kind, t.id, t.message))}
      </div>
    </div>
  );
}
