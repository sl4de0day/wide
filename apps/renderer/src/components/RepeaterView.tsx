import { CornerDownRight, Crosshair, FileWarning, Hash, ListTree, Radar, Redo2, Send, Terminal } from "lucide-react";
import { useMemo, useState } from "react";

import { bridge } from "@/lib/bridge";
import { parseCurl } from "@/lib/curl";
import { hasHeader, parseHttpMessage, serializeHttpMessage, setHeader } from "@/lib/httpMessage";
import { csrfPocFromRequest } from "@/lib/poc/generate";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCatcher } from "@/stores/catcher";
import { useComparer } from "@/stores/comparer";
import { useDecoder } from "@/stores/decoder";
import { repeaterSeeds } from "@/stores/editor";
import { useIntruder } from "@/stores/intruder";
import { useScanner } from "@/stores/scanner";

import { HttpBodyView } from "./http/HttpBodyView";
import { HttpMessageEditor } from "./http/HttpMessageEditor";
import { Inspector } from "./http/Inspector";

interface Reply {
  status: number;
  statusText?: string;
  headers: [string, string][];
  body: string;
  ms: number;
  bytes?: number;
  truncated?: boolean;
  url?: string;
  redirects?: { status: number; url: string; location: string }[];
}

function statusTone(status: number): string {
  if (status >= 500 || status === 0) return "text-status-error";
  if (status >= 400) return "text-amber-400";
  if (status >= 300) return "text-fg-faint";
  return "text-emerald-400";
}

function withContentLength(message: ReturnType<typeof parseHttpMessage>): ReturnType<typeof parseHttpMessage> {
  if (!message) return message;
  if (!message.body && !hasHeader(message.headers, "content-length")) return message;
  const len = new TextEncoder().encode(message.body).length;
  return { ...message, headers: setHeader(message.headers, "Content-Length", String(len)) };
}

export function RepeaterView({ id }: { id: string }) {
  const t = useT();
  const seed = useMemo(() => repeaterSeeds.get(id) ?? null, [id]);
  const [text, setText] = useState(() => (seed ? serializeHttpMessage(seed) : "GET https://\n\n"));
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [followRedirects, setFollowRedirects] = useState(false);
  const [updateCl, setUpdateCl] = useState(true);
  const [showInspector, setShowInspector] = useState(false);
  const [history, setHistory] = useState<{ text: string; reply: Reply }[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);

  const looksLikeCurl = useMemo(() => /^\s*curl\s/i.test(text), [text]);

  const importCurl = () => {
    const parsed = parseCurl(text);
    if (!parsed) {
      setError(t("That does not parse as a cURL command."));
      return;
    }
    setError("");
    setText(serializeHttpMessage(parsed));
  };

  const send = async () => {
    const parsed = parseHttpMessage(text);
    if (!parsed) {
      setError(t("The first line must be METHOD and a URL."));
      return;
    }
    const request = updateCl ? (withContentLength(parsed) ?? parsed) : parsed;

    const serialised = serializeHttpMessage(request);
    if (updateCl && serialised !== text) setText(serialised);
    setSending(true);
    setError("");
    const result = await bridge.proxyReplay(request, { followRedirects });
    setSending(false);
    if (!result.ok) {
      setError(result.error ?? t("The request could not be sent."));
      setReply(null);
      return;
    }
    const answer: Reply = {
      status: result.status ?? 0,
      statusText: result.statusText,
      headers: result.headers ?? [],
      body: result.body ?? "",
      ms: result.ms ?? 0,
      bytes: result.bytes,
      truncated: result.truncated,
      url: result.url,
      redirects: result.redirects,
    };
    setReply(answer);
    setHistory((current) => [...current, { text: serialised, reply: answer }]);
    setViewing(null);
  };

  const restore = (index: number) => {
    const entry = history[index];
    if (!entry) return;
    setText(entry.text);
    setReply(entry.reply);
    setViewing(index);
    setError("");
  };

  const sendToIntruder = () => useIntruder.getState().openIntruder(text);
  const activeScan = () => {
    useScanner.getState().scan(text);
    useCatcher.getState().show("scanner");
  };

  const toggleCls = (on: boolean) =>
    cn(
      "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors duration-100",
      on ? "border-accent bg-selected text-fg" : "border-line text-fg-dim hover:bg-hover hover:text-fg",
    );

  return (
    <div className="wide-enter-fade flex h-full min-h-0 bg-canvas">
      <div className="flex min-h-0 w-1/2 flex-col border-r border-line">
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5">
          <span className="text-[11px] uppercase tracking-wide text-fg-faint">{t("Request")}</span>
          <span className="flex-1" />
          <button type="button" onClick={() => setShowInspector((v) => !v)} title={t("Inspector")} className={toggleCls(showInspector)}>
            <ListTree className="size-3" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={() => setFollowRedirects((v) => !v)} title={t("Follow redirects")} className={toggleCls(followRedirects)}>
            <CornerDownRight className="size-3" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={() => setUpdateCl((v) => !v)} title={t("Update Content-Length")} className={toggleCls(updateCl)}>
            <Hash className="size-3" strokeWidth={1.75} />
          </button>
          {looksLikeCurl && (
            <button type="button" onClick={importCurl} title={t("Convert the cURL command to a request")} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
              <Terminal className="size-3" strokeWidth={1.75} />
              {t("From cURL")}
            </button>
          )}
          <button type="button" onClick={sendToIntruder} title={t("Send to Intruder")} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
            <Crosshair className="size-3" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={activeScan} title={t("Active scan")} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
            <Radar className="size-3" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={() => void csrfPocFromRequest(text)} title={t("Generate CSRF PoC")} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
            <FileWarning className="size-3" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            className="flex items-center gap-1.5 rounded-md border border-accent px-2.5 py-1 text-[11px] text-accent transition-colors duration-100 hover:bg-accent hover:text-bg disabled:opacity-40"
          >
            <Send className="size-3" strokeWidth={1.75} />
            {sending ? t("Sending…") : t("Send")}
          </button>
        </div>
        <HttpMessageEditor value={text} onChange={setText} className={showInspector ? "h-3/5" : "flex-1"} />
        {showInspector && (
          <div className="flex min-h-0 flex-[2] flex-col border-t border-line">
            <div className="shrink-0 bg-chrome px-2 py-1 text-[10px] uppercase tracking-wide text-fg-faint">{t("Inspector")}</div>
            <Inspector text={text} onChange={setText} className="flex-1" />
          </div>
        )}
      </div>

      <div className="flex min-h-0 w-1/2 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
          <span className="text-[11px] uppercase tracking-wide text-fg-faint">{t("Response")}</span>
          {reply && (
            <>
              <span className={cn("font-mono text-[11px] tabular-nums", statusTone(reply.status))}>
                {reply.status || "—"}
                {reply.statusText ? ` ${reply.statusText}` : ""}
              </span>
              <span className="text-[10px] tabular-nums text-fg-faint">{reply.ms} ms</span>
              {reply.bytes != null && <span className="text-[10px] tabular-nums text-fg-faint">{reply.bytes} B</span>}
              {history.length > 1 &&
                (() => {
                  const at = viewing ?? history.length - 1;
                  return (
                    <span className="flex items-center gap-0.5 text-[10px] text-fg-faint">
                      <button type="button" onClick={() => restore(at - 1)} disabled={at <= 0} className="px-0.5 hover:text-fg disabled:opacity-30">
                        ‹
                      </button>
                      <span className="tabular-nums">{at + 1}/{history.length}</span>
                      <button type="button" onClick={() => restore(at + 1)} disabled={at >= history.length - 1} className="px-0.5 hover:text-fg disabled:opacity-30">
                        ›
                      </button>
                    </span>
                  );
                })()}
              <span className="flex-1" />
              <button type="button" onClick={() => useDecoder.getState().openDecoder(reply.body)} className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
                {t("Decoder")}
              </button>
              <button type="button" onClick={() => useComparer.getState().send(reply.body)} className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
                {t("Comparer")}
              </button>
            </>
          )}
        </div>

        {reply && reply.redirects && reply.redirects.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1 text-[10px] text-fg-faint">
            <Redo2 className="size-3" strokeWidth={1.75} />
            <span className="truncate">
              {t("Followed {n} redirect(s) →", { n: reply.redirects.length })} {reply.url}
            </span>
          </div>
        )}

        {error ? (
          <p className="p-3 text-[12px] text-status-error">{error}</p>
        ) : !reply ? (
          <p className="p-3 text-[12px] text-fg-faint">{t("Send the request to see the response.")}</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="max-h-28 shrink-0 overflow-auto border-b border-line px-3 py-1">
              <table className="w-full table-fixed border-collapse">
                <tbody>
                  {reply.headers.map(([name, value], index) => (
                    <tr key={`${name}-${index}`} className="align-top">
                      <td className="w-2/5 truncate py-0.5 pr-2 font-mono text-[10px] text-syn-property" title={name}>
                        {name}
                      </td>
                      <td className="break-all py-0.5 font-mono text-[10px] text-fg-dim">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <HttpBodyView body={reply.body} headers={reply.headers} truncated={reply.truncated} className="flex-1" />
          </div>
        )}
      </div>
    </div>
  );
}
