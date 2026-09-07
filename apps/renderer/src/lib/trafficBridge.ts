import { t } from "@/lib/i18n";
import { buildRouteIndex, matchRoute } from "@/lib/routeIndex";
import { useCatcher } from "@/stores/catcher";
import { useDevServers } from "@/stores/devServers";
import { useEditor } from "@/stores/editor";
import { usePitcher } from "@/stores/pitcher";
import { toast } from "@/stores/toast";
import { useWorkspace } from "@/stores/workspace";

export interface RouteRequestSeed {
  method: string;
  path: string;
  query: string[];
  body: string[];
}

function baseOrigin(): string {
  return useDevServers.getState().origins[0] || "http://localhost:3000";
}

function concretePath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (segment.startsWith(":")) return "1";
      if (segment.startsWith("{") && segment.endsWith("}")) return "1";
      if (segment.startsWith("<") && segment.endsWith(">")) return "1";
      if (segment.startsWith("*")) return "1";
      return segment;
    })
    .join("/");
}

function buildParts(seed: RouteRequestSeed) {
  const url = new URL(concretePath(seed.path) || "/", baseOrigin());
  for (const name of seed.query) url.searchParams.set(name, "");

  const headers: [string, string][] = [];
  let body = "";
  if (seed.body.length > 0) {
    const shape: Record<string, string> = {};
    for (const name of seed.body) shape[name] = "";
    body = JSON.stringify(shape, null, 2);
    headers.push(["Content-Type", "application/json"]);
  }
  return { method: seed.method, url: url.toString(), headers, body };
}

export function sendRouteToRepeater(seed: RouteRequestSeed): void {
  const parts = buildParts(seed);
  useCatcher.getState().addRepeater(parts);
  toast.success(t("Sent to Repeater"));
}

export function sendRouteToPitcher(seed: RouteRequestSeed): void {
  const parts = buildParts(seed);
  usePitcher.getState().captureRequest(parts);
  useEditor.getState().openPitcher();
  toast.success(t("Saved to Pitcher"));
}

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
