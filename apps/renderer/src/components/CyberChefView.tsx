import { LoaderCircle, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { useCyberchef } from "@/stores/cyberchef";

function toBase64(text: string): string {
  try {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch {
    return "";
  }
}

export function CyberChefView() {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const input = useCyberchef((state) => state.input);
  const seq = useCyberchef((state) => state.seq);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void bridge.webtoolsCyberchef().then((reply) => {
      if (!alive) return;
      setLoading(false);
      if (reply.ok && reply.url) setUrl(reply.url);
      else setError(reply.error || t("CyberChef is not ready yet."));
    });
    return () => {
      alive = false;
    };
  }, [t]);

  useEffect(() => load(), [load]);

  const src = useMemo(() => {
    if (!url) return "";
    if (seq > 0 && input) return `${url}?w=${seq}#input=${toBase64(input)}`;
    return url;
  }, [url, input, seq]);

  if (src) {
    return <iframe title="CyberChef" src={src} className="h-full w-full border-0 bg-canvas" />;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-canvas text-center">
      {loading ? (
        <>
          <LoaderCircle className="size-5 animate-spin text-fg-dim" strokeWidth={1.75} />
          <span className="text-[12px] text-fg-dim">{t("Loading CyberChef…")}</span>
        </>
      ) : (
        <>
          <span className="max-w-sm text-[12px] text-fg-dim">
            {error || t("CyberChef could not be opened.")}
          </span>
          <span className="max-w-sm text-[11px] text-fg-faint">
            {t("Install the CyberChef extension, then open it again.")}
          </span>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1 text-[12px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <RotateCw className="size-3.5" strokeWidth={1.75} />
            {t("Try again")}
          </button>
        </>
      )}
    </div>
  );
}
