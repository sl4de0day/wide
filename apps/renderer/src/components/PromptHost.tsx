import { useEffect, useState } from "react";

import { usePrompt } from "@/stores/prompt";
import { useT } from "@/lib/i18n";

import { Modal } from "./ui/Modal";

export function PromptHost() {
  const t = useT();
  const pending = usePrompt((s) => s.pending);
  const answer = usePrompt((s) => s.answer);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (pending) setValue(pending.initial ?? "");
  }, [pending]);

  if (!pending) return null;

  const submit = () => {
    const trimmed = value.trim();
    answer(trimmed ? trimmed : null);
  };

  return (
    <Modal title={pending.title} onClose={() => answer(null)}>
      <div className="flex flex-col gap-3">
        {pending.label && <label className="text-[11px] text-fg-dim">{pending.label}</label>}
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={pending.placeholder}
          spellCheck={false}
          className="w-full rounded-sm border border-line bg-canvas px-2 py-1.5 text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => answer(null)} className="rounded-sm border border-line px-3 py-1 text-[12px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
            {t("Cancel")}
          </button>
          <button type="button" onClick={submit} className="rounded-sm border border-accent px-3 py-1 text-[12px] text-accent transition-colors duration-100 hover:bg-hover hover:text-fg">
            {pending.confirmLabel ?? t("OK")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
