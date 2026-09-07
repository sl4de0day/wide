import { t } from "@/lib/i18n";
import { buildRouteIndex, matchRoute } from "@/lib/routeIndex";
import { useEditor } from "@/stores/editor";
import { toast } from "@/stores/toast";
import { useWorkspace } from "@/stores/workspace";

export async function goToRouteInCode(method: string, url: string): Promise<void> {
  const root = useWorkspace.getState().root;
  if (!root) {
    toast.error(t("Open a folder first."));
    return;
  }
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {

  }
  const index = await buildRouteIndex(root);
  if (index.length === 0) {
    toast.error(t("No routes were found in this project."));
    return;
  }
  const hit = matchRoute(index, method || "GET", path);
  if (!hit) {
    toast.error(t("No matching route was found in the code."));
    return;
  }
  await useEditor.getState().revealAt(hit.file, hit.line, hit.column || 1);
  toast.success(t("Opened {name}", { name: `${hit.relativePath}:${hit.line}` }));
}
