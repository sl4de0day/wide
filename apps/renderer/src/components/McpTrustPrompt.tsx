import { useCallback, useEffect, useState } from "react";

import { bridge, type McpServerOffer } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { Modal } from "./ui/Modal";

export function McpTrustPrompt() {
  const t = useT();
  const [offers, setOffers] = useState<McpServerOffer[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void bridge.mcpPending().then((reply) => {
      if (alive && reply.ok && Array.isArray(reply.servers)) setOffers(reply.servers);
    });
    const stop = bridge.onMcpPending((event) => {
      setOffers(Array.isArray(event.servers) ? event.servers : []);
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const shown = offers.filter((offer) => !dismissed.includes(offer.signature));
  const offer = shown[0];

  const answer = useCallback(
    (signature: string, allow: boolean) => {
      setDismissed((held) => [...held, signature]);
      void bridge.mcpTrust(signature, allow);
    },
    [],
  );

  if (!offer) return null;

  const line = [offer.command, ...offer.args].join(" ");

  return (
    <Modal title={t("Run an MCP server?")} onClose={() => answer(offer.signature, false)}>
      <div className="flex flex-col gap-3">
        <p className="text-[12px] leading-relaxed text-fg-dim">
          {t(
            "This project asks Wide to start {name} so the assistant can use its tools. It runs on your machine with your permissions, and Wide cannot limit what it does.",
            { name: offer.name },
          )}
        </p>
        <p className="text-[12px] leading-relaxed text-fg-dim">
          {t("Start it only if you trust this project. Wide remembers the answer for this exact command.")}
        </p>
        <pre className="overflow-x-auto rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg">
          {line}
        </pre>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => answer(offer.signature, false)}
            className="rounded-md border border-line px-3 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            {t("Do not run it")}
          </button>
          <button
            type="button"
            onClick={() => answer(offer.signature, true)}
            className="rounded-md border border-line bg-hover px-3 py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-active"
          >
            {t("Run it")}
          </button>
        </div>
        {shown.length > 1 && (
          <p className="text-[11px] text-fg-faint">
            {t("Waiting to be answered: {count}", { count: String(shown.length - 1) })}
          </p>
        )}
      </div>
    </Modal>
  );
}
