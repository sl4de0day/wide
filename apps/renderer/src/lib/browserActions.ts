import { useBrowser } from "@/stores/browser";
import { useEditor } from "@/stores/editor";
import { useProxy } from "@/stores/proxy";

function scopeForLocalhost(url: string): void {
  try {
    const parsed = new URL(url);
    if (!/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/i.test(parsed.hostname)) return;
    const proxy = useProxy.getState();
    if (!proxy.running) return;
    if (proxy.scope.some((entry) => entry === parsed.host || entry === parsed.hostname)) return;
    void proxy.setScope([...proxy.scope, parsed.host]);
  } catch {

  }
}

export function openInBrowser(url: string): void {
  if (!url) return;
  useEditor.getState().openBrowser();
  useBrowser.getState().openUrl(url);
  scopeForLocalhost(url);
}
