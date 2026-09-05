import { useEffect, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";

interface Flow {
  sink: string;
  value: string;
  source: string;
  at: number;
}

const HOOK = `(function(){
  if (window.__wideDomInvaderInstalled) return;
  var log = [];
  try { window.__wideDomInvader = log; } catch(e){ return; }
  if (window.__wideDomInvader !== log) return;
  function tainted(v){
    try {
      v = String(v);
      var parts = (location.search + location.hash).replace(/[?#&=]/g, " ").split(/\\s+/).filter(function(x){ return x.length >= 4; });
      for (var i = 0; i < parts.length; i++){ if (v.indexOf(parts[i]) !== -1) return parts[i]; }
      return null;
    } catch(e){ return null; }
  }
  function record(sink, value){
    try {
      if (log.length > 200) return;
      var t = tainted(value); if (!t) return;
      log.push({ sink: sink, value: String(value).slice(0, 300), source: t, at: Date.now() });
    } catch(e){}
  }
  ["innerHTML","outerHTML"].forEach(function(prop){
    try {
      var d = Object.getOwnPropertyDescriptor(Element.prototype, prop);
      if (d && d.set){ Object.defineProperty(Element.prototype, prop, { set: function(v){ record(prop, v); return d.set.call(this, v); }, get: d.get, configurable: true }); }
    } catch(e){}
  });
  try { var dw = document.write; document.write = function(v){ record("document.write", v); return dw.apply(document, arguments); }; } catch(e){}
  ["setTimeout","setInterval"].forEach(function(fn){ try { var o = window[fn]; window[fn] = function(h){ if (typeof h === "string") record(fn + "(string)", h); return o.apply(window, arguments); }; } catch(e){} });
  try { var sa = Element.prototype.setAttribute; Element.prototype.setAttribute = function(n, v){ if (/^(src|href)$/i.test(n)) record("setAttribute(" + n + ")", v); return sa.apply(this, arguments); }; } catch(e){}
  window.__wideDomInvaderInstalled = true;
})();`;

const READ = `JSON.stringify({ armed: window.__wideDomInvaderInstalled === true && Array.isArray(window.__wideDomInvader), flows: window.__wideDomInvader || [] })`;

interface Snapshot {
  armed: boolean;
  flows: Flow[];
}

export function DomInvaderPanel({ tabId }: { tabId: string }) {
  const t = useT();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    let alive = true;
    let busy = false;
    let scriptId = "";

    setFlows([]);
    setArmed(false);

    const drop = async () => {
      const identifier = scriptId;
      scriptId = "";
      if (identifier) await bridge.browserCdp(tabId, "Page.removeScriptToEvaluateOnNewDocument", { identifier });
    };

    const arm = async () => {
      await drop();
      const added = await bridge.browserCdp(tabId, "Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
      const identifier = added.ok ? (added.result as { identifier?: string } | undefined)?.identifier : undefined;
      if (typeof identifier === "string") scriptId = identifier;
      if (!alive) {
        void drop();
        return;
      }
      await bridge.browserCdp(tabId, "Runtime.evaluate", { expression: HOOK });
    };

    const read = async (): Promise<Snapshot | null> => {
      const reply = await bridge.browserCdp(tabId, "Runtime.evaluate", { expression: READ, returnByValue: true });
      if (!reply.ok) return null;
      const raw = (reply.result as { result?: { value?: string } } | undefined)?.result?.value;
      if (typeof raw !== "string") return null;
      try {
        const parsed = JSON.parse(raw) as Partial<Snapshot>;
        const raws: unknown[] = Array.isArray(parsed.flows) ? parsed.flows : [];
        const flows = raws.slice(0, 200).map((item) => {
          const row = (item ?? {}) as Record<string, unknown>;
          return {
            sink: typeof row.sink === "string" ? row.sink.slice(0, 200) : "?",
            value: typeof row.value === "string" ? row.value.slice(0, 300) : "",
            source: typeof row.source === "string" ? row.source.slice(0, 200) : "",
            at: typeof row.at === "number" && Number.isFinite(row.at) ? row.at : 0,
          };
        });
        return { armed: parsed.armed === true, flows };
      } catch {
        return null;
      }
    };

    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        let snapshot = await read();
        if (alive && snapshot && (!snapshot.armed || !scriptId)) {
          await arm();
          snapshot = await read();
        }
        if (!alive || !snapshot) return;
        const next = snapshot.armed ? snapshot.flows : [];
        setArmed(snapshot.armed);
        setFlows((prev) =>
          prev.length === next.length && prev.every((row, i) => row.at === next[i].at && row.sink === next[i].sink)
            ? prev
            : next,
        );
      } finally {
        busy = false;
      }
    };

    const id = setInterval(() => void poll(), 1500);
    void poll();
    return () => {
      alive = false;
      clearInterval(id);
      void drop();
    };
  }, [tabId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-fg-faint">{t("DOM Invader")}</span>
        <span className={armed ? "text-[10px] text-emerald-400" : "text-[10px] text-fg-faint"}>{armed ? t("hooks armed") : ""}</span>
        <span className="flex-1" />
        <span className="text-[10px] tabular-nums text-fg-faint">{flows.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {flows.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-fg-faint">
            {t("No source→sink flows yet. Put your marker in a URL parameter and reload — e.g. ?q=wivDOMxss.")}
          </p>
        ) : (
          <table className="w-full border-collapse text-left text-[11px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-[10px] uppercase tracking-wide text-fg-faint">
                <th className="border-b border-line px-2 py-1 font-normal">{t("sink")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("source")}</th>
                <th className="border-b border-line px-2 py-1 font-normal">{t("value")}</th>
              </tr>
            </thead>
            <tbody>
              {flows.map((f, i) => (
                <tr key={i} className="border-b border-line/60 align-top">
                  <td className="px-2 py-0.5 font-mono text-amber-300">{f.sink}</td>
                  <td className="max-w-28 truncate px-2 py-0.5 font-mono text-syn-string" title={f.source}>{f.source}</td>
                  <td className="max-w-0 truncate px-2 py-0.5 font-mono text-fg-dim" title={f.value}>{f.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
