import { create } from "zustand";

import { bridge, type ProjectScanFinding } from "@/lib/bridge";
import { useEditor } from "@/stores/editor";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";

interface ProjectScanState {
  findings: ProjectScanFinding[];
  scanning: boolean;
  lastRoot: string | null;
  ran: boolean;
  error: string | null;

  run(): Promise<void>;

  runFile(file: string, content: string): Promise<void>;
}

function applyMerged(
  set: (partial: Partial<ProjectScanState>) => void,
  project: { findings?: ProjectScanFinding[] } | undefined,
  crossFile: { findings?: ProjectScanFinding[] } | undefined,
): void {
  const merged: ProjectScanFinding[] = [];
  const seen = new Set<string>();
  for (const finding of [...(crossFile?.findings ?? []), ...(project?.findings ?? [])]) {
    const key = `${finding.file}:${finding.line}:${finding.ruleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(finding);
  }
  merged.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  set({ scanning: false, findings: merged });
}

export const useProjectScan = create<ProjectScanState>((set) => ({
  findings: [],
  scanning: false,
  lastRoot: null,
  ran: false,
  error: null,

  run: async () => {
    const root = useWorkspace.getState().root;
    if (!root || !useSettings.getState().securityLint) {
      set({ findings: [], lastRoot: root });
      return;
    }
    set({ scanning: true, error: null, lastRoot: root, ran: true });
    try {
      const [project, crossFile] = await Promise.all([
        bridge.securityScanProject(root),
        bridge.tsSecurityScan(root),
      ]);
      applyMerged(set, project, crossFile);
    } catch (error) {
      set({ scanning: false, error: String((error as Error)?.message ?? error) });
    }
  },

  runFile: async (file, content) => {
    const root = useWorkspace.getState().root;
    if (!root || !useSettings.getState().securityLint) return;
    set({ scanning: true, error: null, lastRoot: root, ran: true });
    try {

      const [project, crossFile] = await Promise.all([
        bridge.securityRescanFile(root, file, content),
        bridge.tsSecurityScan(root),
      ]);
      applyMerged(set, project, crossFile);
    } catch (error) {
      set({ scanning: false, error: String((error as Error)?.message ?? error) });
    }
  },
}));

let scanTimer: ReturnType<typeof setTimeout> | null = null;
function schedule(action: () => void, delay: number): void {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    action();
  }, delay);
}
export function scheduleProjectScan(delay = 1400): void {
  schedule(() => void useProjectScan.getState().run(), delay);
}
function scheduleFileRescan(file: string, content: string, delay = 700): void {
  schedule(() => void useProjectScan.getState().runFile(file, content), delay);
}

function fileSignature(tabs: ReadonlyArray<{ kind: string; path: string }>): string {
  return tabs.filter((t) => t.kind === "file").map((t) => t.path).join("|");
}

export function subscribeProjectScan(): () => void {
  const offEditor = useEditor.subscribe((state, prev) => {
    if (state.tabs === prev.tabs) return;
    if (fileSignature(state.tabs) !== fileSignature(prev.tabs)) {
      scheduleProjectScan();
      return;
    }
    const active = state.tabs.find((t) => t.path === state.activePath && t.kind === "file");
    if (active && active.kind === "file") scheduleFileRescan(active.path, active.content);
  });
  const offRoot = useWorkspace.subscribe((state, prev) => {
    if (state.root !== prev.root) {
      useProjectScan.setState({ findings: [], lastRoot: null, ran: false });
      if (state.root) scheduleProjectScan(600);
    }
  });
  if (useWorkspace.getState().root) scheduleProjectScan(800);
  return () => {
    offEditor();
    offRoot();
    if (scanTimer) clearTimeout(scanTimer);
  };
}
