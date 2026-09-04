

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildClickjackingPoc(url: string): string {
  const u = esc(url);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Clickjacking PoC — ${u}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; }
      .bar { padding: 8px 12px; background: #111; color: #eee; font-size: 13px; }
      .stage { position: relative; }
      .decoy { position: absolute; z-index: 1; inset: 0; pointer-events: none; }
      .decoy button { position: absolute; left: 120px; top: 220px; padding: 10px 18px; font-size: 15px; background:#e11;color:#fff;border:0;border-radius:6px; }
      iframe { position: relative; z-index: 2; width: 100vw; height: 90vh; border: 0; }
    </style>
  </head>
  <body>
    <div class="bar">
      Clickjacking test for <b>${u}</b> — opacity
      <input type="range" min="0" max="100" value="60" oninput="frame.style.opacity=this.value/100">
      <span>(if the frame stays blank, the site blocks framing = safe)</span>
    </div>
    <div class="stage">
      <div class="decoy"><button>Click me to win!</button></div>
      <iframe id="frame" src="${u}" style="opacity:.6"></iframe>
    </div>
  </body>
</html>`;
}
