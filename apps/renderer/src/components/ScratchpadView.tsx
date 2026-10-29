import { Check, Copy, Plus, Trash2, WrapText } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn, copyText } from "@/lib/utils";
import { toast } from "@/stores/toast";

export interface ScratchNote {
  id: string;
  title: string;
  content: string;
}

const STORAGE_KEY = "wide.scratchpad.notes";
const LEGACY_STORAGE_KEY = "wide.scratchpad";

function loadNotes(): ScratchNote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      return [{ id: "default", title: "Note 1", content: legacy }];
    }
  } catch {
  }
  return [{ id: "default", title: "Note 1", content: "" }];
}

function saveNotes(notes: ScratchNote[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    if (notes[0]) {
      localStorage.setItem(LEGACY_STORAGE_KEY, notes[0].content);
    }
  } catch {
  }
}

export function ScratchpadView() {
  const [notes, setNotes] = useState<ScratchNote[]>(loadNotes);
  const [activeId, setActiveId] = useState<string>(() => notes[0]?.id ?? "default");
  const [wordWrap, setWordWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editTitleText, setEditTitleText] = useState("");

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeId) ?? notes[0],
    [notes, activeId],
  );

  useEffect(() => {
    saveNotes(notes);
  }, [notes]);

  const updateContent = useCallback(
    (newContent: string) => {
      setNotes((prev) =>
        prev.map((n) => (n.id === (activeNote?.id ?? "default") ? { ...n, content: newContent } : n)),
      );
    },
    [activeNote?.id],
  );

  const addNote = useCallback(() => {
    const newId = `note-${Date.now()}`;
    const newNote: ScratchNote = {
      id: newId,
      title: `Note ${notes.length + 1}`,
      content: "",
    };
    setNotes((prev) => [...prev, newNote]);
    setActiveId(newId);
  }, [notes.length]);

  const deleteNote = useCallback(
    (idToDelete: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (notes.length <= 1) {
        updateContent("");
        return;
      }
      setNotes((prev) => {
        const next = prev.filter((n) => n.id !== idToDelete);
        if (activeId === idToDelete && next.length > 0) {
          setActiveId(next[0].id);
        }
        return next;
      });
    },
    [notes.length, activeId, updateContent],
  );

  const startRename = (note: ScratchNote) => {
    setEditingTitleId(note.id);
    setEditTitleText(note.title);
  };

  const finishRename = () => {
    if (editingTitleId && editTitleText.trim()) {
      setNotes((prev) =>
        prev.map((n) => (n.id === editingTitleId ? { ...n, title: editTitleText.trim() } : n)),
      );
    }
    setEditingTitleId(null);
  };

  const handleCopy = async () => {
    if (!activeNote?.content) return;
    await copyText(activeNote.content);
    setCopied(true);
    toast.success("Scratchpad content copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    if (!activeNote?.content) return;
    updateContent("");
    toast.info("Note cleared");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      const next = val.substring(0, start) + "  " + val.substring(end);
      updateContent(next);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  const lineCount = useMemo(() => {
    if (!activeNote?.content) return 1;
    return activeNote.content.split("\n").length;
  }, [activeNote?.content]);

  const charCount = activeNote?.content?.length ?? 0;

  return (
    <div className="flex h-full w-full flex-col bg-canvas select-text">
      <div className="flex shrink-0 items-center justify-between border-b border-line bg-panel px-3 py-1 text-xs select-none">
        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
          {notes.map((note) => {
            const isActive = note.id === (activeNote?.id ?? "default");
            const isEditing = editingTitleId === note.id;

            return (
              <div
                key={note.id}
                onClick={() => setActiveId(note.id)}
                onDoubleClick={() => startRename(note)}
                className={cn(
                  "group flex items-center gap-1.5 rounded-t px-2.5 py-1 font-mono text-[11px] transition-colors cursor-pointer",
                  isActive
                    ? "bg-canvas text-fg font-medium border-t-2 border-accent"
                    : "text-fg-dim hover:bg-hover hover:text-fg",
                )}
              >
                {isEditing ? (
                  <input
                    type="text"
                    value={editTitleText}
                    autoFocus
                    onChange={(e) => setEditTitleText(e.target.value)}
                    onBlur={finishRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishRename();
                      if (e.key === "Escape") setEditingTitleId(null);
                    }}
                    className="w-20 bg-transparent px-0.5 outline-none text-fg border-b border-accent"
                  />
                ) : (
                  <span>{note.title}</span>
                )}

                {notes.length > 1 && (
                  <button
                    type="button"
                    title="Delete Note"
                    aria-label="Delete Note"
                    onClick={(e) => deleteNote(note.id, e)}
                    className="opacity-0 group-hover:opacity-100 hover:text-status-danger p-0.5 rounded transition-opacity"
                  >
                    <Trash2 className="size-2.5" />
                  </button>
                )}
              </div>
            );
          })}

          <button
            type="button"
            title="New Scratch Note"
            aria-label="New Scratch Note"
            onClick={addNote}
            className="flex items-center justify-center size-6 rounded hover:bg-hover text-fg-dim hover:text-fg transition-colors"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2 text-fg-dim">
          <span className="text-[11px] font-mono text-fg-faint">
            {lineCount} lines · {charCount} chars
          </span>

          <div className="h-3 w-px bg-line" />

          <button
            type="button"
            title="Toggle Word Wrap"
            aria-label="Toggle Word Wrap"
            onClick={() => setWordWrap((w) => !w)}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-hover transition-colors",
              wordWrap ? "text-accent" : "text-fg-dim",
            )}
          >
            <WrapText className="size-3.5" />
            <span className="text-[11px]">Wrap</span>
          </button>

          <button
            type="button"
            title="Copy All"
            aria-label="Copy All"
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-hover text-fg hover:text-fg-bright transition-colors"
          >
            {copied ? <Check className="size-3.5 text-status-ok" /> : <Copy className="size-3.5" />}
            <span className="text-[11px]">{copied ? "Copied" : "Copy"}</span>
          </button>

          <button
            type="button"
            title="Clear Note"
            aria-label="Clear Note"
            onClick={handleClear}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-hover hover:text-status-danger transition-colors"
          >
            <Trash2 className="size-3.5" />
            <span className="text-[11px]">Clear</span>
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 p-2">
        <textarea
          value={activeNote?.content ?? ""}
          onChange={(e) => updateContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Quick Scratchpad: Paste payloads, URLs, temporary code snippets, or notes here. Saved automatically..."
          spellCheck={false}
          className={cn(
            "h-full w-full resize-none bg-canvas p-2 font-mono text-[13px] leading-relaxed text-fg outline-none selection:bg-selected placeholder:text-fg-faint/50",
            wordWrap ? "whitespace-pre-wrap" : "whitespace-pre overflow-x-auto",
          )}
        />
      </div>
    </div>
  );
}
