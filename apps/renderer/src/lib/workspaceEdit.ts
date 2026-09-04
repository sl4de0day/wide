import { bridge } from "@/lib/bridge";
import { useEditor } from "@/stores/editor";

export interface RangeEdit {
  start: number;
  length: number;
  newText: string;
}

export interface FileEdits {
  file: string;
  edits: RangeEdit[];
}

export function applyRanges(text: string, edits: RangeEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const edit of ordered) {
    out = out.slice(0, edit.start) + edit.newText + out.slice(edit.start + edit.length);
  }
  return out;
}

export interface ApplyResult {
  ok: boolean;
  files: number;
  edits: number;
  error?: string;
}

export async function applyWorkspaceEdit(changes: FileEdits[]): Promise<ApplyResult> {
  const affected = changes.filter((change) => change.edits.length > 0);
  if (affected.length === 0) return { ok: true, files: 0, edits: 0 };

  const editor = useEditor.getState();
  const openPaths = new Set(editor.tabs.filter((tab) => tab.kind === "file").map((tab) => tab.path));

  const results: { file: string; text: string }[] = [];
  let editCount = 0;
  for (const change of affected) {
    const openTab = editor.tabs.find((tab) => tab.path === change.file && tab.kind === "file");
    let base: string;
    if (openTab && openTab.kind === "file") {
      base = openTab.content;
    } else {
      const read = await bridge.readFile(change.file);
      if (read.error || read.tooLarge) {
        return { ok: false, files: 0, edits: 0, error: `Could not read ${change.file}.` };
      }
      base = read.content;
    }
    results.push({ file: change.file, text: applyRanges(base, change.edits) });
    editCount += change.edits.length;
  }

  for (const result of results) {
    const written = await bridge.writeFile(result.file, result.text);
    if (written.error) {
      return { ok: false, files: 0, edits: 0, error: written.error };
    }
  }

  const activePath = editor.activePath;
  for (const result of results) {
    if (!openPaths.has(result.file)) continue;
    await editor.reloadFromDisk(result.file);
    if (result.file === activePath) editor.replaceContent(result.file, result.text);
  }

  return { ok: true, files: results.length, edits: editCount };
}
