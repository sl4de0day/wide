import type { Extension } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";
import { base64ToBytes, normaliseBase64Url } from "@/lib/codec";
import { copyText } from "@/lib/utils";
import { useDecoder } from "@/stores/decoder";
import { toast } from "@/stores/toast";

const utf8 = new TextDecoder();

interface DecodedJwtInfo {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  rawToken: string;
}

function parseJwt(token: string): DecodedJwtInfo | null {
  const parts = token.trim().split(".");
  if (parts.length < 2) return null;
  try {
    const headerStr = utf8.decode(base64ToBytes(normaliseBase64Url(parts[0])));
    const payloadStr = utf8.decode(base64ToBytes(normaliseBase64Url(parts[1])));
    const header = JSON.parse(headerStr);
    const payload = JSON.parse(payloadStr);
    if (typeof header !== "object" || header === null || typeof payload !== "object" || payload === null) {
      return null;
    }
    return { header, payload, rawToken: token };
  } catch {
    return null;
  }
}

export function jwtHover(): Extension {
  const hover = hoverTooltip((view, pos) => {
    try {
      const line = view.state.doc.lineAt(pos);
      const lineText = line.text;
      const col = pos - line.from;

      const regex = /(?:^|[^A-Za-z0-9_-])(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?)/g;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(lineText)) !== null) {
        const fullToken = match[1];
        const tokenStart = match.index + (match[0].length - fullToken.length);
        const tokenEnd = tokenStart + fullToken.length;

        if (col >= tokenStart && col <= tokenEnd) {
          const decoded = parseJwt(fullToken);
          if (!decoded) return null;

          return {
            pos: line.from + tokenStart,
            end: line.from + tokenEnd,
            above: true,
            create: () => {
              const dom = document.createElement("div");
              dom.className = "cm-jwt-tooltip";

              const head = document.createElement("div");
              head.className = "cm-jwt-head";

              const title = document.createElement("span");
              title.className = "cm-jwt-title";
              title.textContent = "JWT Token";
              head.appendChild(title);

              const alg = String(decoded.header.alg ?? "Unknown");
              const algPill = document.createElement("span");
              algPill.className =
                alg.toLowerCase() === "none"
                  ? "cm-jwt-pill cm-jwt-pill-danger"
                  : "cm-jwt-pill cm-jwt-pill-alg";
              algPill.textContent = `alg: ${alg}`;
              head.appendChild(algPill);

              const exp = decoded.payload.exp;
              if (typeof exp === "number") {
                const nowSec = Math.floor(Date.now() / 1000);
                const expired = nowSec > exp;
                const dateStr = new Date(exp * 1000).toLocaleString();
                const expPill = document.createElement("span");
                expPill.className = expired
                  ? "cm-jwt-pill cm-jwt-pill-danger"
                  : "cm-jwt-pill cm-jwt-pill-success";
                expPill.textContent = expired ? `Expired: ${dateStr}` : `Exp: ${dateStr}`;
                head.appendChild(expPill);
              }

              dom.appendChild(head);

              const body = document.createElement("div");
              body.className = "cm-jwt-body";

              const headerSection = document.createElement("div");
              headerSection.className = "cm-jwt-section";
              headerSection.innerHTML = `<div class="cm-jwt-section-label">Header</div><pre class="cm-jwt-code">${JSON.stringify(decoded.header, null, 2)}</pre>`;
              body.appendChild(headerSection);

              const payloadSection = document.createElement("div");
              payloadSection.className = "cm-jwt-section";
              payloadSection.innerHTML = `<div class="cm-jwt-section-label">Payload</div><pre class="cm-jwt-code">${JSON.stringify(decoded.payload, null, 2)}</pre>`;
              body.appendChild(payloadSection);

              dom.appendChild(body);

              const footer = document.createElement("div");
              footer.className = "cm-jwt-footer";

              const copyBtn = document.createElement("button");
              copyBtn.type = "button";
              copyBtn.className = "cm-jwt-btn";
              copyBtn.textContent = "Copy Payload";
              copyBtn.onclick = (e) => {
                e.stopPropagation();
                void copyText(JSON.stringify(decoded.payload, null, 2)).then((ok) => {
                  if (ok) toast.success("JWT Payload copied to clipboard");
                });
              };
              footer.appendChild(copyBtn);

              const decoderBtn = document.createElement("button");
              decoderBtn.type = "button";
              decoderBtn.className = "cm-jwt-btn cm-jwt-btn-accent";
              decoderBtn.textContent = "Open in Decoder ↗";
              decoderBtn.onclick = (e) => {
                e.stopPropagation();
                useDecoder.getState().openDecoder(decoded.rawToken);
              };
              footer.appendChild(decoderBtn);

              dom.appendChild(footer);

              return { dom };
            },
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  });

  const baseTheme = EditorView.baseTheme({
    ".cm-jwt-tooltip": {
      display: "flex",
      flexDirection: "column",
      maxWidth: "420px",
      maxHeight: "360px",
      fontSize: "11px",
      backgroundColor: "var(--panel)",
      color: "var(--fg)",
      border: "1px solid var(--line)",
      borderRadius: "6px",
      boxShadow: "0 10px 25px -5px rgba(0,0,0,0.4)",
      overflow: "hidden",
      fontFamily: "var(--font-sans, system-ui)",
    },
    ".cm-jwt-head": {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 10px",
      backgroundColor: "var(--chrome)",
      borderBottom: "1px solid var(--line)",
    },
    ".cm-jwt-title": {
      fontWeight: "600",
      color: "var(--fg-bright)",
    },
    ".cm-jwt-pill": {
      fontSize: "10px",
      padding: "1px 6px",
      borderRadius: "4px",
      fontFamily: "var(--font-mono, monospace)",
    },
    ".cm-jwt-pill-alg": {
      backgroundColor: "var(--selected)",
      color: "var(--fg)",
    },
    ".cm-jwt-pill-danger": {
      backgroundColor: "rgba(239, 68, 68, 0.2)",
      color: "#ef4444",
      fontWeight: "600",
    },
    ".cm-jwt-pill-success": {
      backgroundColor: "rgba(34, 197, 94, 0.15)",
      color: "#22c55e",
    },
    ".cm-jwt-body": {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      padding: "8px 10px",
      overflowY: "auto",
      maxHeight: "240px",
    },
    ".cm-jwt-section-label": {
      fontSize: "10px",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      color: "var(--fg-faint)",
      marginBottom: "2px",
    },
    ".cm-jwt-code": {
      margin: "0",
      padding: "6px",
      backgroundColor: "var(--canvas)",
      borderRadius: "4px",
      fontFamily: "var(--font-mono, monospace)",
      fontSize: "11px",
      lineHeight: "1.4",
      color: "var(--fg)",
      overflowX: "auto",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    },
    ".cm-jwt-footer": {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "6px",
      padding: "6px 10px",
      backgroundColor: "var(--chrome)",
      borderTop: "1px solid var(--line)",
    },
    ".cm-jwt-btn": {
      padding: "2px 8px",
      borderRadius: "4px",
      border: "1px solid var(--line)",
      backgroundColor: "var(--canvas)",
      color: "var(--fg-dim)",
      cursor: "pointer",
      fontSize: "11px",
      transition: "all 0.15s ease",
    },
    ".cm-jwt-btn:hover": {
      backgroundColor: "var(--hover)",
      color: "var(--fg)",
    },
    ".cm-jwt-btn-accent": {
      borderColor: "var(--accent)",
      color: "var(--accent)",
    },
    ".cm-jwt-btn-accent:hover": {
      backgroundColor: "var(--accent)",
      color: "var(--bg)",
    },
  });

  return [hover, baseTheme];
}
