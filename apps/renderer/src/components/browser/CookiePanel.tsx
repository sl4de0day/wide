import { RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export function CookiePanel({ tabId }: { tabId: string }) {
  const t = useT();
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const reply = await bridge.browserCdp(tabId, "Network.getAllCookies");
    if (!reply.ok) {
      setError(reply.error ?? t("Could not read cookies."));
      return;
    }
    const list = (reply.result as { cookies?: Cookie[] } | undefined)?.cookies ?? [];
    setCookies([...list].sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name)));
    setError("");
  }, [tabId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setValue = async (c: Cookie, value: string) => {
    setCookies((prev) => prev.map((x) => (x === c ? { ...x, value } : x)));
    await bridge.browserCdp(tabId, "Network.setCookie", {
      name: c.name,
      value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
      ...(c.sameSite ? { sameSite: c.sameSite } : {}),
    });
  };

  const remove = async (c: Cookie) => {
    setCookies((prev) => prev.filter((x) => x !== c));
    await bridge.browserCdp(tabId, "Network.deleteCookies", { name: c.name, domain: c.domain, path: c.path });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-fg-faint">{t("Cookies")}</span>
        <span className="text-[10px] tabular-nums text-fg-faint">{cookies.length}</span>
        <span className="flex-1" />
        <button type="button" onClick={() => void refresh()} title={t("Refresh")} className="rounded-sm p-1 text-fg-faint hover:bg-hover hover:text-fg">
          <RotateCw className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="px-3 py-3 text-[11px] text-status-error">{error}</p>
        ) : cookies.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-fg-faint">{t("No cookies for this page.")}</p>
        ) : (
          <table className="w-full border-collapse text-left text-[11px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-[10px] uppercase tracking-wide text-fg-faint">
                <th className="border-b border-line px-2 py-1 font-normal">{t("name")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("value")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("domain")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("flags")}</th>
                <th className="border-b border-line px-1 py-1" />
              </tr>
            </thead>
            <tbody>
              {cookies.map((c, i) => (
                <tr key={`${c.domain}${c.path}${c.name}${i}`} className="border-b border-line/60 align-top">
                  <td className="max-w-32 truncate px-2 py-0.5 font-mono text-syn-property" title={c.name}>{c.name}</td>
                  <td className="px-2 py-0.5">
                    <input
                      value={c.value}
                      onChange={(e) => setCookies((prev) => prev.map((x) => (x === c ? { ...x, value: e.target.value } : x)))}
                      onBlur={(e) => void setValue(c, e.target.value)}
                      className="w-full min-w-0 bg-transparent font-mono text-syn-string outline-none focus:bg-canvas"
                    />
                  </td>
                  <td className="max-w-28 truncate px-2 py-0.5 font-mono text-fg-dim" title={c.domain}>{c.domain}</td>
                  <td className="px-2 py-0.5 font-mono text-[10px] text-fg-faint">
                    {[c.httpOnly ? "HttpOnly" : "", c.secure ? "Secure" : "", c.sameSite ? c.sameSite : ""].filter(Boolean).join(" ")}
                  </td>
                  <td className="px-1 py-0.5">
                    <button type="button" onClick={() => void remove(c)} title={t("Delete")} className={cn("rounded-sm p-0.5 text-fg-faint hover:text-status-error")}>
                      <Trash2 className="size-3" strokeWidth={2} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
