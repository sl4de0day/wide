import { ArrowUpRight, Braces, Crosshair, Download, FileDown, FileUp, FileWarning, Flag, FlaskConical, Globe, Hand, KeyRound, Network, Play, Plus, Radar, Replace, Reply, ScanSearch, Send, ShieldCheck, Square, Trash2, Upload, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import { bridge, type InterceptedRequest, type InterceptedResponse, type MatchReplaceRule, type ProxyEntry } from "@/lib/bridge";
import { fromHar, toHar } from "@/lib/har";
import { toast } from "@/stores/toast";
import { exportCatcherSession, importCatcherSession } from "@/lib/catcherSession";
import { csrfPocFromRequest } from "@/lib/poc/generate";
import { useWorkspace } from "@/stores/workspace";
import { useT } from "@/lib/i18n";
import { cn, copyText } from "@/lib/utils";
import { useCyberchef } from "@/stores/cyberchef";
import { useDecoder } from "@/stores/decoder";
import { useExtensions } from "@/stores/extensions";
import { useCatcher } from "@/stores/catcher";
import { useEditor } from "@/stores/editor";
import { useFindings } from "@/stores/findings";
import { useIntruder } from "@/stores/intruder";
import { usePitcher } from "@/stores/pitcher";
import { useScanner } from "@/stores/scanner";
import { openInBrowser } from "@/lib/browserActions";
import { useMacros } from "@/stores/macros";
import { useProxy } from "@/stores/proxy";




function statusTone(status: number): string {
  if (status >= 500 || status === 0) return "text-status-error";
  if (status >= 400) return "text-amber-400";
  if (status >= 300) return "text-fg-faint";
  return "text-emerald-400";
}



const summariseCache = new WeakMap<ProxyEntry, { host: string; path: string }>();
function summarise(entry: ProxyEntry): { host: string; path: string } {
  const hit = summariseCache.get(entry);
  if (hit) return hit;
  let value: { host: string; path: string };
  try {
    const url = new URL(entry.url);
    value = { host: url.host, path: url.pathname + url.search };
  } catch {
    value = { host: entry.host, path: entry.url };
  }
  summariseCache.set(entry, value);
  return value;
}

function HeaderTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full table-fixed border-collapse">
      <tbody>
        {rows.map(([name, value], index) => (
          <tr key={`${name}-${index}`} className="align-top">
            <td className="w-2/5 truncate py-0.5 pr-2 font-mono text-[10px] text-fg-faint" title={name}>
              {name}
            </td>
            <td className="break-all py-0.5 font-mono text-[10px] text-fg-dim">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}



function WsComposer({ id, seed }: { id: number; seed?: { text: string; direction: "up" | "down" } | null }) {
  const t = useT();
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    setDirection(seed.direction);
  }, [seed]);

  const send = async () => {
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const result = await bridge.proxyWsSend(id, direction, text);
    setBusy(false);
    if (result.ok) setText("");
    else setError(result.error ?? t("Could not send that frame."));
  };

  return (
    <div className="shrink-0 border-t border-line px-2 py-2">
      <div className="mb-1 flex items-center gap-1">
        {(["up", "down"] as const).map((dir) => (
          <button
            key={dir}
            type="button"
            onClick={() => setDirection(dir)}
            className={cn(
              "rounded-sm px-2 py-0.5 font-mono text-[10px] transition-colors duration-100",
              direction === dir ? "bg-accent/15 text-accent" : "text-fg-dim hover:bg-hover hover:text-fg",
            )}
            title={dir === "up" ? t("Send to the server") : t("Send to the browser")}
          >
            {dir === "up" ? `▲ ${t("To server")}` : `▼ ${t("To browser")}`}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void send();
          }
        }}
        rows={2}
        placeholder={t("A text frame to inject…")}
        className="w-full resize-none rounded-sm border border-line bg-bg px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent"
      />
      {error && <p className="mt-1 text-[10px] text-status-error">{t(error)}</p>}
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          onClick={() => void send()}
          disabled={!text || busy}
          className="rounded-sm bg-accent/15 px-2 py-0.5 text-[11px] text-accent transition-colors duration-100 hover:bg-accent/25 disabled:opacity-40"
        >
          {t("Send frame")}
        </button>
      </div>
    </div>
  );
}

function Detail({ entry, onClose }: { entry: ProxyEntry; onClose: () => void }) {
  const hasCyberchef = useExtensions((state) => state.installed.has("cyberchef"));
  const t = useT();
  const [tab, setTab] = useState<"request" | "response">("request");
  const [wsSeed, setWsSeed] = useState<{ text: string; direction: "up" | "down" } | null>(null);
  const [wsFilter, setWsFilter] = useState("");

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
        <span className={cn("shrink-0 font-mono text-[11px] tabular-nums", statusTone(entry.status))}>
          {entry.status || "—"}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-fg-dim">{entry.method}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg" title={entry.url}>
          {entry.url}
        </span>
        {}
        <button
          type="button"
          onClick={() => openInBrowser(entry.url)}
          title={t("Open in browser")}
          aria-label={t("Open in browser")}
          className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <Globe className="size-3.5" strokeWidth={2} />
        </button>
        {
}
        {!entry.websocket && (
          <button
            type="button"
            onClick={() =>
              useCatcher.getState().addRepeater({
                method: entry.method,
                url: entry.url,
                headers: entry.reqHeaders,
                body: entry.reqBody,
              })
            }
            title={t("Send to Repeater")}
            aria-label={t("Send to Repeater")}
            className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <ArrowUpRight className="size-3.5" strokeWidth={2} />
          </button>
        )}
        {}
        {!entry.websocket && (
          <button
            type="button"
            onClick={() => {
              usePitcher.getState().captureRequest({ method: entry.method, url: entry.url, headers: entry.reqHeaders, body: entry.reqBody });
              useEditor.getState().openPitcher();
            }}
            title={t("Save to Pitcher")}
            aria-label={t("Save to Pitcher")}
            className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <Send className="size-3.5" strokeWidth={2} />
          </button>
        )}
        {}
        {!entry.websocket && (
          <button
            type="button"
            onClick={() =>
              useIntruder.getState().openIntruder(
                `${entry.method} ${entry.url}\n` +
                  entry.reqHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") +
                  `\n\n${entry.reqBody}`,
              )
            }
            title={t("Send to Intruder")}
            aria-label={t("Send to Intruder")}
            className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <Crosshair className="size-3.5" strokeWidth={2} />
          </button>
        )}
        {
}
        {!entry.websocket && (
          <button
            type="button"
            onClick={() => {
              const raw = `${entry.method} ${entry.url}\n` + entry.reqHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") + `\n\n${entry.reqBody}`;
              useScanner.getState().scan(raw);
              useCatcher.getState().show("scanner");
            }}
            title={t("Active scan")}
            aria-label={t("Active scan")}
            className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <Radar className="size-3.5" strokeWidth={2} />
          </button>
        )}
        {}
        {!entry.websocket && (
          <button
            type="button"
            onClick={() =>
              void csrfPocFromRequest(
                `${entry.method} ${entry.url}\n` + entry.reqHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") + `\n\n${entry.reqBody}`,
              )
            }
            title={t("Generate CSRF PoC")}
            aria-label={t("Generate CSRF PoC")}
            className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <FileWarning className="size-3.5" strokeWidth={2} />
          </button>
        )}
        {
}
        {!entry.websocket && (
          <button
            type="button"
            onClick={() =>
              useMacros.getState().seedStep(
                `${entry.method} ${entry.url}\n` +
                  entry.reqHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") +
                  `\n\n${entry.reqBody}`,
              )
            }
            title={t("Send to session macro")}
            aria-label={t("Send to session macro")}
            className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <KeyRound className="size-3.5" strokeWidth={2} />
          </button>
        )}
        {
}
        <button
          type="button"
          onClick={() =>
            useDecoder.getState().openDecoder(tab === "response" ? entry.resBody : entry.reqBody)
          }
          title={t("Send to Decoder")}
          aria-label={t("Send to Decoder")}
          className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <Braces className="size-3.5" strokeWidth={2} />
        </button>
        {hasCyberchef && (
          <button
            type="button"
            onClick={() => useCyberchef.getState().send(tab === "response" ? entry.resBody : entry.reqBody)}
            title={t("Send to CyberChef")}
            aria-label={t("Send to CyberChef")}
            className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <FlaskConical className="size-3.5" strokeWidth={2} />
          </button>
        )}
        {}
        <button
          type="button"
          onClick={() =>
            useFindings.getState().add({
              title: `${entry.method} ${entry.host}`,
              severity: "info",
              location: entry.url,
              detail:
                `Request:\n${entry.method} ${entry.url}\n` +
                entry.reqHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") +
                (entry.reqBody ? `\n\n${entry.reqBody}` : "") +
                `\n\nResponse: ${entry.status}\n` +
                entry.resHeaders.map(([n, v]) => `${n}: ${v}`).join("\n") +
                (entry.resBody ? `\n\n${entry.resBody}` : ""),
            })
          }
          title={t("Send to findings")}
          aria-label={t("Send to findings")}
          className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <Flag className="size-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t("Close")}
          aria-label={t("Close")}
          className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      {}
      {entry.websocket ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-line px-2 py-1">
            <input
              value={wsFilter}
              onChange={(event) => setWsFilter(event.target.value)}
              placeholder={t("Filter frames…")}
              className="w-full rounded-sm border border-line bg-canvas px-2 py-0.5 font-mono text-[10px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
            {(entry.frames ?? []).length === 0 ? (
              <p className="text-[11px] text-fg-faint">{t("No frames yet.")}</p>
            ) : (
              (entry.frames ?? [])
                .filter((frame) => !wsFilter || (frame.kind === "text" && (frame.text ?? "").toLowerCase().includes(wsFilter.toLowerCase())))
                .map((frame, index) => (
                <div key={index} className="flex items-start gap-2 border-b border-line py-1">
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px]",
                      frame.direction === "up" ? "text-accent" : "text-emerald-400",
                    )}
                    title={frame.direction === "up" ? t("Sent") : t("Received")}
                  >
                    {frame.direction === "up" ? "▲" : "▼"}
                  </span>
                  {frame.kind === "text" ? (
                    <button
                      type="button"
                      title={t("Load this frame into the composer")}
                      onClick={() => setWsSeed({ text: frame.text ?? "", direction: frame.direction })}
                      className="min-w-0 flex-1 break-all text-left font-mono text-[11px] text-fg transition-colors duration-100 hover:text-fg-bright"
                    >
                      {frame.text}
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-fg-faint">
                      {frame.kind === "binary" ? t("{bytes} bytes (binary)", { bytes: frame.bytes ?? 0 }) : t("close")}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
          <WsComposer id={entry.id} seed={wsSeed} />
        </div>
      ) : (
      <>
      <div className="flex shrink-0 border-b border-line">
        {(["request", "response"] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={cn(
              "flex-1 py-1.5 text-[11px] transition-colors duration-100",
              tab === name ? "border-b border-accent text-fg-bright" : "text-fg-dim hover:bg-hover hover:text-fg",
            )}
          >
            {name === "request" ? t("Request") : t("Response")}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {tab === "request" ? (
          <>
            <HeaderTable rows={entry.reqHeaders} />
            {entry.reqBody && (
              <pre className="mt-2 whitespace-pre-wrap border-t border-line pt-2 font-mono text-[11px] text-fg">
                {entry.reqBody}
                {entry.reqTruncated && <span className="text-fg-faint"> …{t("(truncated)")}</span>}
              </pre>
            )}
          </>
        ) : entry.error ? (
          <p className="text-[11px] text-status-error">{t(entry.error)}</p>
        ) : (
          <>
            <HeaderTable rows={entry.resHeaders} />
            {entry.resBody && (
              <pre className="mt-2 whitespace-pre-wrap border-t border-line pt-2 font-mono text-[11px] text-fg">
                {entry.resBody}
                {entry.resTruncated && <span className="text-fg-faint"> …{t("(truncated)")}</span>}
              </pre>
            )}
          </>
        )}
      </div>
      </>
      )}
    </div>
  );
}


function Scope() {
  const t = useT();
  const scope = useProxy((state) => state.scope);
  const [draft, setDraft] = useState("");
  const [caCopied, setCaCopied] = useState(false);

  const revealCa = async () => {
    const reply = await bridge.proxyCaCertPath();
    if (reply.ok && reply.path) void bridge.reveal(reply.path);
  };
  const copyCa = async () => {
    const reply = await bridge.proxyCaCert();
    if (reply.ok && reply.pem && (await copyText(reply.pem))) {
      setCaCopied(true);
      setTimeout(() => setCaCopied(false), 1500);
    }
  };

  const add = () => {
    const host = draft.trim().toLowerCase();
    if (!host || scope.includes(host)) {
      setDraft("");
      return;
    }
    void useProxy.getState().setScope([...scope, host]);
    setDraft("");
  };

  return (
    <div className="shrink-0 border-b border-line px-2 py-2">
      <p className="pb-1.5 text-[10px] uppercase tracking-wide text-fg-faint">{t("In scope")}</p>
      {scope.length === 0 ? (
        <p className="pb-1.5 text-[11px] leading-snug text-fg-faint">
          {t("Nothing is intercepted until you add a host. Everything else is tunnelled untouched.")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1 pb-1.5">
          {scope.map((host) => (
            <span
              key={host}
              className="flex items-center gap-1 rounded-sm bg-panel px-1.5 py-0.5 text-[11px] text-fg-dim"
            >
              <span className="font-mono">{host}</span>
              <button
                type="button"
                onClick={() => void useProxy.getState().setScope(scope.filter((h) => h !== host))}
                title={t("Remove from scope")}
                aria-label={t("Remove from scope")}
                className="text-fg-faint hover:text-fg"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 rounded-md border border-line bg-panel px-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={t("example.com or *.example.com")}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-1 text-[12px] text-fg outline-none placeholder:text-fg-faint"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          title={t("Add to scope")}
          aria-label={t("Add to scope")}
          className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-30"
        >
          <Plus className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      {
}
      <div className="mt-2 flex items-center gap-1.5 border-t border-line pt-2">
        <ShieldCheck className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[10px] text-fg-faint">{t("CA certificate")}</span>
        <button
          type="button"
          onClick={() => void revealCa()}
          className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          {t("Reveal")}
        </button>
        <button
          type="button"
          onClick={() => void copyCa()}
          className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          {caCopied ? t("Copied") : t("Copy PEM")}
        </button>
      </div>
    </div>
  );
}



function composeRequest(request: InterceptedRequest): string {
  let path = request.url;
  try {
    const url = new URL(request.url);
    path = url.pathname + url.search;
  } catch {

  }


  const lines = [`${request.method} ${path}`, ...request.headers.map(([name, value]) => `${name}: ${value}`)];
  return `${lines.join("\n")}\n\n${request.body}`;
}



function InterceptEditor({ request, count }: { request: InterceptedRequest; count: number }) {
  const t = useT();
  const held = useProxy((state) => state.held);
  const [draft, setDraft] = useState(() => composeRequest(request));

  const forward = () => {
    const split = draft.indexOf("\n\n");
    const head = split === -1 ? draft : draft.slice(0, split);
    const body = split === -1 ? "" : draft.slice(split + 2);
    const lines = head.split("\n");
    const method = (lines[0] ?? "").trim().split(/\s+/)[0] || request.method;
    const headers: [string, string][] = [];
    for (const line of lines.slice(1)) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
    }
    void useProxy.getState().decide(request.id, "forward", { method, headers, body });
  };

  return (
    <div className="wide-enter-fade shrink-0 border-b-2 border-amber-500/50 bg-amber-500/5">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Hand className="size-3.5 shrink-0 text-amber-400" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-fg" title={request.url}>
          {t("Held")}: {request.method} {request.host}
        </span>
        {count > 1 && <span className="shrink-0 text-[10px] text-fg-faint">{count} {t("held")}</span>}
      </div>
      {held.length > 1 && (
        <div className="flex flex-wrap gap-1 px-3 pb-1">
          {held.map((item, index) => (
            <span
              key={item.id}
              className={cn(
                "rounded-sm border px-1.5 py-0.5 text-[9px]",
                item.id === request.id ? "border-amber-500/50 text-amber-300" : "border-line text-fg-faint",
              )}
              title={`${item.method} ${item.url}`}
            >
              {index + 1}. {item.method} {item.host}
            </span>
          ))}
        </div>
      )}
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        rows={8}
        className="w-full resize-y border-y border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg outline-none"
      />
      <div className="flex gap-1 px-3 py-1.5">
        <button
          type="button"
          onClick={forward}
          className="flex-1 rounded-sm border border-line bg-emerald-500/10 py-1 text-[11px] text-emerald-300 transition-colors duration-100 hover:bg-emerald-500/20"
        >
          {t("Forward")}
        </button>
        <button
          type="button"
          onClick={() => void useProxy.getState().decide(request.id, "drop")}
          className="flex-1 rounded-sm border border-line bg-rose-500/10 py-1 text-[11px] text-rose-300 transition-colors duration-100 hover:bg-rose-500/20"
        >
          {t("Drop")}
        </button>
        {held.length > 1 && (
          <button
            type="button"
            onClick={() => void useProxy.getState().decideAll("forward")}
            className="shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
            title={t("Forward every held request")}
          >
            {t("Forward all")}
          </button>
        )}
      </div>
    </div>
  );
}


function composeResponse(response: InterceptedResponse): string {
  const lines = [`HTTP/1.1 ${response.status} ${response.statusText}`.trim(), ...response.headers.map(([n, v]) => `${n}: ${v}`)];
  return `${lines.join("\n")}\n\n${response.body}`;
}

function ResponseInterceptEditor({ response, count }: { response: InterceptedResponse; count: number }) {
  const t = useT();
  const heldResponses = useProxy((state) => state.heldResponses);
  const [draft, setDraft] = useState(() => composeResponse(response));

  const forward = () => {
    const split = draft.indexOf("\n\n");
    const head = split === -1 ? draft : draft.slice(0, split);
    const body = split === -1 ? "" : draft.slice(split + 2);
    const lines = head.split("\n");
    const statusMatch = (lines[0] ?? "").match(/\s(\d{3})(?:\s|$)/);
    const status = statusMatch ? Number(statusMatch[1]) : response.status;
    const headers: [string, string][] = [];
    for (const line of lines.slice(1)) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
    }
    void useProxy.getState().decideResponse(response.id, "forward", { status, headers, body });
  };

  return (
    <div className="wide-enter-fade shrink-0 border-b-2 border-sky-500/50 bg-sky-500/5">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Reply className="size-3.5 shrink-0 text-sky-400" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-fg" title={response.url}>
          {t("Held response")}: {response.status} {response.host}
        </span>
        {count > 1 && <span className="shrink-0 text-[10px] text-fg-faint">+{count - 1}</span>}
      </div>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        rows={8}
        className="w-full resize-y border-y border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg outline-none"
      />
      <div className="flex gap-1 px-3 py-1.5">
        <button type="button" onClick={forward} className="flex-1 rounded-sm border border-line bg-emerald-500/10 py-1 text-[11px] text-emerald-300 transition-colors duration-100 hover:bg-emerald-500/20">
          {t("Forward")}
        </button>
        <button type="button" onClick={() => void useProxy.getState().decideResponse(response.id, "drop")} className="flex-1 rounded-sm border border-line bg-rose-500/10 py-1 text-[11px] text-rose-300 transition-colors duration-100 hover:bg-rose-500/20">
          {t("Drop")}
        </button>
        {heldResponses.length > 1 && (
          <button
            type="button"
            onClick={() => void useProxy.getState().decideAllResponses("forward")}
            className="shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
            title={t("Forward every held response")}
          >
            {t("Forward all")}
          </button>
        )}
      </div>
    </div>
  );
}

const RULE_TARGETS: { id: MatchReplaceRule["target"]; label: string }[] = [
  { id: "req-header", label: "Request header" },
  { id: "req-body", label: "Request body" },
  { id: "res-header", label: "Response header" },
  { id: "res-body", label: "Response body" },
];


function MatchReplace() {
  const t = useT();
  const rules = useProxy((state) => state.rules);
  const [shown, setShown] = useState(false);

  const update = (next: MatchReplaceRule[]) => void useProxy.getState().setRules(next);
  const patch = (id: string, change: Partial<MatchReplaceRule>) =>
    update(rules.map((rule) => (rule.id === id ? { ...rule, ...change } : rule)));

  return (
    <div className="shrink-0 border-b border-line px-2 py-1.5">
      <button
        type="button"
        onClick={() => setShown((open) => !open)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        <Replace className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
        <span className="flex-1 text-[10px] uppercase tracking-wide text-fg-faint">
          {t("Match & replace")}
        </span>
        {rules.length > 0 && <span className="text-[10px] text-fg-faint">{rules.length}</span>}
      </button>

      {shown && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-sm border border-line p-1.5">
              <div className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => patch(rule.id, { enabled: event.target.checked })}
                  className="size-3"
                  title={t("Enabled")}
                />
                <select
                  value={rule.target}
                  onChange={(event) => patch(rule.id, { target: event.target.value as MatchReplaceRule["target"] })}
                  className="min-w-0 flex-1 rounded-sm border border-line bg-panel px-1 py-0.5 text-[10px] text-fg outline-none"
                >
                  {RULE_TARGETS.map((target) => (
                    <option key={target.id} value={target.id}>
                      {t(target.label)}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-0.5 text-[10px] text-fg-faint" title={t("Regular expression")}>
                  <input
                    type="checkbox"
                    checked={rule.regex}
                    onChange={(event) => patch(rule.id, { regex: event.target.checked })}
                    className="size-3"
                  />
                  .*
                </label>
                <button
                  type="button"
                  onClick={() => update(rules.filter((other) => other.id !== rule.id))}
                  title={t("Remove")}
                  className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-rose-300"
                >
                  <Trash2 className="size-3" strokeWidth={1.75} />
                </button>
              </div>
              <input
                value={rule.match}
                onChange={(event) => patch(rule.id, { match: event.target.value })}
                placeholder={t("match")}
                spellCheck={false}
                className="mt-1 w-full rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px] text-fg outline-none placeholder:text-fg-faint"
              />
              <input
                value={rule.replace}
                onChange={(event) => patch(rule.id, { replace: event.target.value })}
                placeholder={t("replace with (empty to delete)")}
                spellCheck={false}
                className="mt-1 w-full rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px] text-fg outline-none placeholder:text-fg-faint"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              update([
                ...rules,
                { id: crypto.randomUUID(), enabled: true, target: "req-header", match: "", replace: "", regex: false },
              ])
            }
            className="flex items-center justify-center gap-1 rounded-sm border border-dashed border-line py-1 text-[10px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <Plus className="size-3" strokeWidth={1.75} />
            {t("Add rule")}
          </button>
        </div>
      )}
    </div>
  );
}




const TrafficRow = memo(function TrafficRow({ entry, selected }: { entry: ProxyEntry; selected: boolean }) {
  const { host, path } = summarise(entry);
  return (
    <button
      type="button"
      onClick={() => useProxy.getState().select(selected ? null : entry.id)}
      className={cn(
        "flex w-full items-baseline gap-2 border-b border-line px-3 py-1.5 text-left transition-colors duration-100",
        selected ? "bg-selected" : "hover:bg-hover",
      )}
    >
      <span className={cn("w-8 shrink-0 font-mono text-[10px] tabular-nums", statusTone(entry.status))}>
        {entry.status || "—"}
      </span>
      <span className="w-10 shrink-0 font-mono text-[10px] text-fg-dim">{entry.method}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-fg" title={entry.url}>
        <span className="text-fg-dim">{host}</span>
        {path}
      </span>
    </button>
  );
});


function groupByHost(entries: ProxyEntry[]): [string, ProxyEntry[]][] {
  const groups = new Map<string, ProxyEntry[]>();
  for (const entry of entries) {
    const host = summarise(entry).host || entry.host || "—";
    const list = groups.get(host);
    if (list) list.push(entry);
    else groups.set(host, [entry]);
  }
  return [...groups.entries()];
}

export function ProxyPanel() {
  const t = useT();
  const running = useProxy((state) => state.running);
  const entries = useProxy((state) => state.entries);
  const selected = useProxy((state) => state.selected);
  const busy = useProxy((state) => state.busy);
  const error = useProxy((state) => state.error);
  const intercepting = useProxy((state) => state.intercepting);
  const interceptingResponses = useProxy((state) => state.interceptingResponses);
  const scanning = useProxy((state) => state.scanning);
  const held = useProxy((state) => state.held);
  const heldResponses = useProxy((state) => state.heldResponses);
  const [byHost, setByHost] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void useProxy.getState().refresh();
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? entries.filter(
          (e) =>
            e.url.toLowerCase().includes(q) ||
            e.host.toLowerCase().includes(q) ||
            e.method.toLowerCase().includes(q) ||
            String(e.status).includes(q),
        )
      : entries;
    return [...list].reverse();
  }, [entries, filter]);
  const grouped = useMemo(() => (byHost ? groupByHost(shown) : []), [byHost, shown]);
  const chosen = useMemo(() => entries.find((entry) => entry.id === selected) ?? null, [entries, selected]);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Proxy")}>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => useProxy.getState().toggleScan()}
          title={scanning ? t("Passive scan is on") : t("Passive scan (into findings)")}
          aria-label={t("Passive scan (into findings)")}
          aria-pressed={scanning}
          className={cn(
            "rounded-sm p-1 transition-colors duration-100 hover:bg-hover",
            scanning ? "bg-selected text-emerald-400" : "text-fg-faint hover:text-fg",
          )}
        >
          <ScanSearch className="size-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => void useProxy.getState().setIntercept(!intercepting)}
          title={intercepting ? t("Interception is on — requests are held") : t("Intercept requests")}
          aria-label={t("Intercept requests")}
          aria-pressed={intercepting}
          className={cn(
            "rounded-sm p-1 transition-colors duration-100 hover:bg-hover",
            intercepting ? "bg-selected text-amber-400" : "text-fg-faint hover:text-fg",
          )}
        >
          <Hand className="size-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => void useProxy.getState().setInterceptResponse(!interceptingResponses)}
          title={interceptingResponses ? t("Response interception is on — responses are held") : t("Intercept responses")}
          aria-label={t("Intercept responses")}
          aria-pressed={interceptingResponses}
          className={cn(
            "rounded-sm p-1 transition-colors duration-100 hover:bg-hover",
            interceptingResponses ? "bg-selected text-sky-400" : "text-fg-faint hover:text-fg",
          )}
        >
          <Reply className="size-3.5" strokeWidth={1.75} />
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => setByHost((v) => !v)}
            title={byHost ? t("Flat list") : t("Group by host")}
            aria-label={t("Group by host")}
            aria-pressed={byHost}
            className={cn(
              "rounded-sm p-1 transition-colors duration-100 hover:bg-hover",
              byHost ? "bg-selected text-fg-bright" : "text-fg-faint hover:text-fg",
            )}
          >
            <Network className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const root = useWorkspace.getState().root;
            if (!root) return;
            void bridge.writeFile(`${root}/.wide/catcher-session.json`, exportCatcherSession());
          }}
          title={t("Save the Catcher session (scope, rules, traffic, issues, repeaters)")}
          aria-label={t("Save session")}
          className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <Download className="size-3.5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => {
            const root = useWorkspace.getState().root;
            if (!root) return;
            void bridge.readFile(`${root}/.wide/catcher-session.json`).then((file) => {
              if (file?.content) importCatcherSession(file.content);
            });
          }}
          title={t("Load a saved Catcher session from .wide/catcher-session.json")}
          aria-label={t("Load session")}
          className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <Upload className="size-3.5" strokeWidth={1.5} />
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const root = useWorkspace.getState().root;
              if (!root) {
                toast.error(t("Open a project first."));
                return;
              }
              void bridge.writeFile(`${root}/wide-traffic.har`, toHar(entries)).then((reply) => {
                if (reply.error) toast.error(t(reply.error));
                else toast.success(t("Traffic exported to wide-traffic.har."));
              });
            }}
            title={t("Export traffic as HAR")}
            aria-label={t("Export traffic as HAR")}
            className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <FileDown className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void bridge.openFile().then((picked) => {
              if (!picked) return;
              void bridge.readFile(picked.path).then((file) => {
                if (file.error) {
                  toast.error(t(file.error));
                  return;
                }
                const imported = fromHar(file.content);
                if (!imported.length) {
                  toast.error(t("No requests found in that HAR file."));
                  return;
                }
                useProxy.getState().importEntries(imported);
                toast.success(t("Imported requests from HAR: {count}", { count: imported.length }));
              });
            });
          }}
          title={t("Import a HAR file")}
          aria-label={t("Import a HAR file")}
          className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <FileUp className="size-3.5" strokeWidth={1.5} />
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => void useProxy.getState().clear()}
            title={t("Clear captured traffic")}
            aria-label={t("Clear captured traffic")}
            className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        <button
          type="button"
          onClick={() => void (running ? useProxy.getState().stop() : useProxy.getState().start())}
          disabled={busy}
          title={running ? t("Stop the proxy") : t("Start the proxy")}
          aria-label={running ? t("Stop the proxy") : t("Start the proxy")}
          className={cn(
            "rounded-sm p-1 transition-colors duration-100 hover:bg-hover disabled:opacity-40",
            running ? "text-status-error" : "text-emerald-400",
          )}
        >
          {running ? (
            <Square className="size-3.5" strokeWidth={2} fill="currentColor" />
          ) : (
            <Play className="size-3.5" strokeWidth={2} fill="currentColor" />
          )}
        </button>
      </PanelHeader>

      {error && (
        <button
          type="button"
          onClick={() => useProxy.setState({ error: "" })}
          className="wide-enter-fade shrink-0 border-b border-line px-3 py-1.5 text-left text-[11px] text-status-error"
        >
          {t(error)}
        </button>
      )}

      <Scope />
      <MatchReplace />
      {held.length > 0 && <InterceptEditor key={held[0].id} request={held[0]} count={held.length} />}
      {heldResponses.length > 0 && <ResponseInterceptEditor key={heldResponses[0].id} response={heldResponses[0]} count={heldResponses.length} />}

      {entries.length > 0 && (
        <div className="shrink-0 border-b border-line px-2 py-1">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("Filter traffic (host, path, method, status)…")}
            spellCheck={false}
            className="w-full rounded-sm border border-line bg-canvas px-2 py-0.5 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-fg-faint">
            {running
              ? t("Running. Traffic to hosts in scope will appear here.")
              : t("Start the proxy, then browse a host you have put in scope.")}
          </p>
        ) : byHost ? (
          grouped.map(([host, items]) => (
            <div key={host}>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel px-3 py-1 text-[10px] uppercase tracking-wide text-fg-faint">
                <span className="min-w-0 flex-1 truncate normal-case text-fg-dim">{host}</span>
                <span className="shrink-0 tabular-nums">{items.length}</span>
              </div>
              {items.map((entry) => (
                <TrafficRow key={entry.id} entry={entry} selected={entry.id === selected} />
              ))}
            </div>
          ))
        ) : (
          shown.map((entry) => <TrafficRow key={entry.id} entry={entry} selected={entry.id === selected} />)
        )}
      </div>

      {chosen && <Detail entry={chosen} onClose={() => useProxy.getState().select(null)} />}
    </div>
  );
}
