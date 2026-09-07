import { bridge } from "@/lib/bridge";
import { t } from "@/lib/i18n";
import { detectRoutesInText, type RouteHit } from "@/lib/routeIndex";
import { useCatcher } from "@/stores/catcher";
import { useDevServers } from "@/stores/devServers";
import { useFindings } from "@/stores/findings";
import { useScanner } from "@/stores/scanner";
import { toast } from "@/stores/toast";

export function parseFileLocation(location: string): { file: string; line: number } | null {
  const raw = String(location || "").trim();

  if (!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;
  const match = /^(.*?):(\d+)$/.exec(raw);
  if (!match || !match[1]) return null;
  return { file: match[1], line: Number(match[2]) };
}

export function canVerifyLive(location: string): boolean {
  return parseFileLocation(location) !== null;
}

function cweOf(text: string): string {
  const match = /CWE-(\d+)/i.exec(String(text || ""));
  return match ? `CWE-${match[1]}` : "";
}

function enclosingRoute(hits: RouteHit[], line: number): RouteHit | null {
  let best: RouteHit | null = null;
  for (const hit of hits) {
    if (hit.line <= line && (!best || hit.line > best.line)) best = hit;
  }
  return best ?? hits[0] ?? null;
}

function concretePath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (segment.startsWith(":") || segment.startsWith("*")) return "1";
      if (segment.startsWith("{") && segment.endsWith("}")) return "1";
      if (segment.startsWith("<") && segment.endsWith(">")) return "1";
      return segment;
    })
    .join("/");
}

function requestTextFor(hit: RouteHit): string {
  const origin = useDevServers.getState().origins[0] || "http://localhost:3000";
  const url = new URL(concretePath(hit.path) || "/", origin);
  const method = hit.method || "GET";
  const lines = [`${method} ${url.toString()}`, `Host: ${url.host}`];
  let body = "";
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    body = "{}";
    lines.push("Content-Type: application/json");
  }
  return `${lines.join("\n")}\n\n${body}`;
}

export async function verifyFindingLive(findingId: string): Promise<void> {
  const finding = useFindings.getState().findings.find((item) => item.id === findingId);
  if (!finding) return;

  const where = parseFileLocation(finding.location);
  if (!where) {
    toast.error(t("This finding is not tied to a source line, so it cannot be tested live."));
    return;
  }

  const file = await bridge.readFile(where.file);
  if (!file || file.error || file.tooLarge || file.content == null) {
    toast.error(t("The file behind this finding could not be read."));
    return;
  }

  const hits = detectRoutesInText(String(file.content), where.file);
  if (hits.length === 0) {
    toast.error(t("No route was found in this file, so there is nothing to send a request to."));
    return;
  }

  const hit = enclosingRoute(hits, where.line);
  if (!hit) {
    toast.error(t("No route was found in this file, so there is nothing to send a request to."));
    return;
  }

  const requestText = requestTextFor(hit);
  const wanted = cweOf(finding.detail) || cweOf(finding.title);

  toast.info(t("Testing {method} {path} live…", { method: hit.method || "GET", path: hit.path }));
  useCatcher.getState().show("scanner");

  useScanner.getState().scan(requestText, (issues) => {
    const hitIssues = wanted ? issues.filter((issue) => cweOf(issue.cwe ?? "") === wanted) : issues;
    const stamp = new Date().toISOString();

    if (hitIssues.length > 0) {
      const evidence = hitIssues
        .map((issue) => `${issue.name} — ${issue.point}: ${issue.evidence}`)
        .join("\n");
      useFindings.getState().update(findingId, {
        status: "confirmed",
        detail: `${finding.detail}\n\n--- Confirmed live ${stamp} ---\n${hit.method} ${hit.path}\n${evidence}`,
      });
      toast.success(t("Confirmed live — the finding is reproducible."));
    } else {
      useFindings.getState().update(findingId, {
        detail: `${finding.detail}\n\n--- Not reproduced ${stamp} ---\nTried ${hit.method} ${hit.path}; the active scan raised no matching issue.`,
      });
      toast.info(t("Not reproduced — the scan raised no matching issue. The finding was left open."));
    }
  });
}
