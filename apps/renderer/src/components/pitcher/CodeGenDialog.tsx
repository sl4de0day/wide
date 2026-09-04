import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { useT } from "@/lib/i18n";
import { CODE_LANGS, generateCode, type CodeLang } from "@/lib/pitcher/codegen";
import { copyText } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { PitcherRequest } from "@/stores/pitcher";

import { Modal } from "./Modal";

export function CodeGenDialog({ req, vars, onClose }: { req: PitcherRequest; vars: Record<string, string>; onClose: () => void }) {
  const t = useT();
  const [lang, setLang] = useState<CodeLang>("curl");
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => generateCode(req, vars, lang), [req, vars, lang]);

  const copy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <Modal title={t("Generate code")} onClose={onClose} wide>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {CODE_LANGS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLang(l.id)}
              className={cn("rounded-sm border px-2 py-0.5 text-[11px]", lang === l.id ? "border-accent bg-selected text-fg" : "border-line text-fg-faint hover:bg-hover hover:text-fg")}
            >
              {l.label}
            </button>
          ))}
          <button type="button" onClick={copy} className="ml-auto flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-[11px] text-fg-dim hover:bg-hover hover:text-fg">
            {copied ? <Check className="size-3 text-emerald-400" strokeWidth={2} /> : <Copy className="size-3" strokeWidth={2} />}
            {copied ? t("Copied") : t("Copy")}
          </button>
        </div>
        <pre className="max-h-[52vh] overflow-auto rounded-sm border border-line bg-canvas p-2 font-mono text-[11px] text-fg">{code}</pre>
      </div>
    </Modal>
  );
}
