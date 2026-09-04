import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { bridge } from "@/lib/bridge";
import { useCodeberg } from "@/stores/codeberg";
import { useEditor } from "@/stores/editor";

type Change = "add" | "mod" | "del";

const DECOR: Record<Change, Decoration> = {
  add: Decoration.line({ attributes: { class: "cm-git-add" } }),
  mod: Decoration.line({ attributes: { class: "cm-git-mod" } }),
  del: Decoration.line({ attributes: { class: "cm-git-del" } }),
};

function changedLines(diff: string): Map<number, Change> {
  const out = new Map<number, Change>();
  const lines = diff.split("\n");
  let i = 0;
  let newLine = 0;
  while (i < lines.length) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[i]);
    if (!header) {
      i += 1;
      continue;
    }
    newLine = parseInt(header[1], 10);
    i += 1;
    while (i < lines.length && !lines[i].startsWith("@@")) {
      const line = lines[i];
      if (line.startsWith(" ")) {
        newLine += 1;
        i += 1;
      } else if (line.startsWith("+") || line.startsWith("-")) {

        let dels = 0;
        while (i < lines.length && lines[i].startsWith("-")) {
          dels += 1;
          i += 1;
        }
        let adds = 0;
        while (i < lines.length && lines[i].startsWith("+")) {
          out.set(newLine, adds < dels ? "mod" : "add");
          newLine += 1;
          adds += 1;
          i += 1;
        }
        if (dels > adds) out.set(Math.max(1, newLine), "del");
      } else {

        i += 1;
      }
    }
  }
  return out;
}

function repoRelative(filePath: string, root: string): string | null {
  const norm = (value: string) => value.replace(/\\/g, "/");
  const base = norm(root).replace(/\/+$/, "");
  const file = norm(filePath);
  if (!base) return null;
  if (file.toLowerCase().startsWith(base.toLowerCase() + "/")) return file.slice(base.length + 1);
  return null;
}

export function gitGutter(filePath: string, root: string | null): Extension {
  const relative = root ? repoRelative(filePath, root) : null;
  if (!root || !relative) return [];

  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet = Decoration.none;
        changes: Map<number, Change> = new Map();
        lastSaved: string | null = null;
        stopGit: () => void;
        stopEditor: () => void;
        alive = true;

        constructor(readonly view: EditorView) {
          void this.fetch();

          this.stopGit = useCodeberg.subscribe(() => this.fetch());

          this.stopEditor = useEditor.subscribe((state) => {
            const tab = state.tabs.find((item) => item.path === filePath);
            const saved = tab && tab.kind === "file" ? tab.savedContent : null;
            if (saved !== this.lastSaved) {
              this.lastSaved = saved;
              void this.fetch();
            }
          });
        }

        async fetch() {
          const reply = await bridge.codebergDiff(root as string, relative as string, false);
          if (!this.alive) return;
          const next = reply.ok && reply.diff ? changedLines(reply.diff) : new Map<number, Change>();
          this.changes = next;
          this.build();
          this.view.dispatch({});
        }

        build() {
          const builder = new RangeSetBuilder<Decoration>();
          const total = this.view.state.doc.lines;
          for (const line of [...this.changes.keys()].sort((a, b) => a - b)) {
            if (line < 1 || line > total) continue;
            const from = this.view.state.doc.line(line).from;
            builder.add(from, from, DECOR[this.changes.get(line)!]);
          }
          this.decorations = builder.finish();
        }

        update(update: ViewUpdate) {

          if (update.docChanged) this.build();
        }

        destroy() {
          this.alive = false;
          this.stopGit();
          this.stopEditor();
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    EditorView.baseTheme({
      ".cm-git-add": { boxShadow: "inset 2px 0 0 var(--status-ok)" },
      ".cm-git-mod": { boxShadow: "inset 2px 0 0 var(--status-warn)" },
      ".cm-git-del": { boxShadow: "inset 2px 0 0 var(--status-error)" },
    }),
  ];
}
