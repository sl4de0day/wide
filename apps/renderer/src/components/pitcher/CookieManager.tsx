import { Trash2 } from "lucide-react";

import { useT } from "@/lib/i18n";
import { usePitcherCookies } from "@/stores/pitcherCookies";

import { Modal } from "./Modal";

export function CookieManager({ onClose }: { onClose: () => void }) {
  const t = useT();
  const cookies = usePitcherCookies((s) => s.cookies);
  const enabled = usePitcherCookies((s) => s.enabled);

  return (
    <Modal title={t("Cookies")} onClose={onClose} wide>
      <div className="mb-2 flex items-center gap-3 text-[11px]">
        <label className="flex items-center gap-1.5 text-fg-dim">
          <input type="checkbox" checked={enabled} onChange={(e) => usePitcherCookies.getState().setEnabled(e.target.checked)} />
          {t("Send and store cookies automatically")}
        </label>
        <button type="button" onClick={() => usePitcherCookies.getState().clear()} className="ml-auto text-fg-faint hover:text-status-error">
          {t("Clear all")}
        </button>
      </div>
      {cookies.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-fg-faint">{t("The jar is empty.")}</p>
      ) : (
        <table className="w-full text-left text-[11px]">
          <thead className="text-fg-faint">
            <tr className="border-b border-line">
              <th className="py-1 pr-2 font-normal">{t("Name")}</th>
              <th className="py-1 pr-2 font-normal">{t("Value")}</th>
              <th className="py-1 pr-2 font-normal">{t("Domain")}</th>
              <th className="py-1 pr-2 font-normal">{t("Path")}</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {cookies.map((c, i) => (
              <tr key={i} className="border-b border-line/40">
                <td className="py-1 pr-2 text-syn-property">{c.name}</td>
                <td className="max-w-40 truncate py-1 pr-2 text-syn-string" title={c.value}>{c.value}</td>
                <td className="py-1 pr-2 text-fg-dim">{c.domain}</td>
                <td className="py-1 pr-2 text-fg-dim">{c.path}</td>
                <td className="py-1">
                  <button type="button" onClick={() => usePitcherCookies.getState().remove(c.name, c.domain, c.path)} className="text-fg-faint hover:text-status-error">
                    <Trash2 className="size-3" strokeWidth={2} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
