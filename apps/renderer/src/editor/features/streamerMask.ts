import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { useSettings } from "@/stores/settings";

const maskMark = Decoration.mark({ class: "cm-streamer-mask" });

// Patterns for sensitive data
const PATTERNS = [
  // Key = Value assignments in .env, JSON, YAML, code
  /(?:API[_-]?KEY|SECRET|PASSWORD|PASSWD|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET)\s*[:=]\s*(['"][^'"\r\n]{4,}['"]|[^\s\r\n"']{4,})/gi,
  // Bearer tokens
  /Bearer\s+([A-Za-z0-9-_.+/=]{16,})/gi,
  // AWS Access Key
  /\b(AKIA[0-9A-Z]{16})\b/g,
  // GitHub Personal Access Token
  /\b(gh[pousr]_[A-Za-z0-9_]{30,})\b/g,
  // Stripe Live Key
  /\b(sk_live_[0-9a-zA-Z]{20,})\b/g,
  // Google API Key
  /\b(AIza[0-9A-Za-z-_]{35})\b/g,
  // Slack Tokens
  /\b(xox[baprs]-[0-9A-Za-z-_]{16,})\b/g,
  // Standard JWT
  /\b(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
];

function buildMaskDecorations(view: EditorView): DecorationSet {
  if (!useSettings.getState().streamerMode) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const ranges: { from: number; to: number }[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to);

    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        // If there's a capture group (e.g. the value in key=value), mask that group
        const targetText = match[1] ?? match[0];
        const offsetInMatch = match[1] ? match[0].indexOf(match[1]) : 0;
        const start = from + match.index + offsetInMatch;
        const end = start + targetText.length;

        if (start < end && end <= doc.length) {
          ranges.push({ from: start, to: end });
        }
      }
    }
  }

  // Sort and deduplicate / merge ranges
  ranges.sort((a, b) => a.from - b.from);
  let lastEnd = -1;
  for (const r of ranges) {
    if (r.from >= lastEnd) {
      builder.add(r.from, r.to, maskMark);
      lastEnd = r.to;
    }
  }

  return builder.finish();
}

export function streamerMask(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      unsub: () => void;

      constructor(readonly view: EditorView) {
        this.decorations = buildMaskDecorations(view);
        this.unsub = useSettings.subscribe((state, prev) => {
          if (state.streamerMode !== prev.streamerMode) {
            this.decorations = buildMaskDecorations(this.view);
            this.view.dispatch({});
          }
        });
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildMaskDecorations(this.view);
        }
      }

      destroy() {
        this.unsub();
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );

  const theme = EditorView.baseTheme({
    ".cm-streamer-mask": {
      filter: "blur(5px)",
      userSelect: "none",
      backgroundColor: "rgba(168, 85, 247, 0.25)",
      borderRadius: "3px",
      cursor: "pointer",
      transition: "filter 0.15s ease, background-color 0.15s ease",
    },
    ".cm-streamer-mask:hover": {
      filter: "none",
      backgroundColor: "rgba(168, 85, 247, 0.1)",
    },
  });

  return [plugin, theme];
}

