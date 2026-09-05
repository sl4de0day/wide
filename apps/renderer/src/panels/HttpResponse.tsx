import { useMemo } from "react";

import { useT } from "@/lib/i18n";
import { prettyBody } from "@/lib/prettyBody";
import { cn, formatBytes } from "@/lib/utils";
import { useCatcher } from "@/stores/catcher";
import { useHttp } from "@/stores/http";

function statusTone(status: number): string {
  if (status >= 500) return "text-status-error";
  if (status >= 400) return "text-status-warn";
  return "text-fg-bright";
}

export function HttpResponse() {
  const t = useT();
  const request = useHttp((state) => state.request);
  const response = useHttp((state) => state.response);
  const sending = useHttp((state) => state.sending);

  const contentType = useMemo(() => {
    if (!response?.ok) return null;
    const found = response.headers.find(([name]) => name.toLowerCase() === "content-type");
    return found?.[1] ?? null;
  }, [response]);

  const body = useMemo(
    () => (response?.ok ? prettyBody(response.body, contentType) : ""),
    [response, contentType],
  );

  if (!request) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas px-8 text-center">
        <p className="text-[12px] italic text-fg-dim">
          {t("Open a .http file and run a request to see its response here.")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto bg-canvas">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 break-all font-mono text-[12px] text-fg-muted">
            <span className="text-fg-bright">{request.method}</span> {request.url}
          </p>
          {}
          <button
            type="button"
            onClick={() =>
              useCatcher.getState().addRepeater({
                method: request.method,
                url: request.url,
                headers: request.headers,
                body: request.body ?? "",
              })
            }
            title={t("Send to Repeater")}
            aria-label={t("Send to Repeater")}
            className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            {t("Repeater")}
          </button>
        </div>

        {sending && <p className="pt-2 text-[12px] italic text-fg-dim">{t("Sending…")}</p>}

        {response && !response.ok && (
          <p className="pt-2 text-[12px] text-status-error">{t(response.error)}</p>
        )}

        {response?.ok && (
          <p className="flex flex-wrap items-center gap-3 pt-2 text-[12px] text-fg-dim">
            <span className={cn("font-mono", statusTone(response.status))}>
              {response.status} {response.statusText}
            </span>
            <span>{response.ms} ms</span>
            <span>{formatBytes(response.bytes)}</span>
            {response.truncated && (
              <span className="text-status-warn">{t("truncated — the body was larger than 8 MB")}</span>
            )}
            {response.url !== request.url && (
              <span className="font-mono text-fg-faint">→ {response.url}</span>
            )}
          </p>
        )}
      </div>

      {response?.ok && (
        <>
          <div className="shrink-0 border-b border-line px-4 py-2">
            <table className="w-full font-mono text-[11px]">
              <tbody>
                {response.headers.map(([name, value]) => (
                  <tr key={name}>
                    <td className="w-48 py-0.5 pr-3 align-top text-fg-dim">{name}</td>
                    <td className="py-0.5 break-all align-top text-fg-muted">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[12px] text-fg">
            {body}
          </pre>
        </>
      )}
    </div>
  );
}
