import { useBrowser } from "@/stores/browser";
import { useEditor } from "@/stores/editor";

export function openInBrowser(url: string): void {
  if (!url) return;
  useEditor.getState().openBrowser();
  useBrowser.getState().openUrl(url);
}
