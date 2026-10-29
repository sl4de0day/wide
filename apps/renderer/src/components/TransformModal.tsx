import { ArrowRight, Binary, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TRANSFORMS_LIST } from "@/lib/transformSelection";
import { useDecoder } from "@/stores/decoder";
import { useTransformModal } from "@/stores/transform";

export function TransformModal() {
  const isOpen = useTransformModal((state) => state.isOpen);
  const selectedText = useTransformModal((state) => state.selectedText);
  const closeModal = useTransformModal((state) => state.closeModal);
  const apply = useTransformModal((state) => state.apply);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  const items = useMemo(() => {
    const q = query.toLowerCase().trim();
    return TRANSFORMS_LIST.map((t) => {
      let preview = "";
      let valid = true;
      try {
        preview = t.run(selectedText);
      } catch {
        preview = "(invalid input for this format)";
        valid = false;
      }
      return {
        ...t,
        preview,
        valid,
      };
    }).filter((item) => {
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
      );
    });
  }, [selectedText, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleApply = (transformed: string, valid: boolean) => {
    if (!valid) return;
    apply(transformed);
  };

  const handleOpenDecoder = () => {
    closeModal();
    useDecoder.getState().openDecoder(selectedText);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = items[selectedIndex];
      if (current && current.valid) {
        handleApply(current.preview, true);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40 backdrop-blur-xs select-none">
      <div className="fixed inset-0" onClick={closeModal} />

      <div
        className="wide-enter-fade relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 bg-chrome">
          <Binary className="size-4 text-accent" />
          <span className="text-xs font-semibold text-fg">Transform Selection</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleOpenDecoder}
            className="text-[11px] text-fg-dim hover:text-accent hover:underline mr-2"
          >
            Open in Full Decoder ↗
          </button>
          <button
            type="button"
            onClick={closeModal}
            className="rounded p-0.5 text-fg-dim hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-line px-3 py-2 bg-canvas">
          <Search className="size-3.5 text-fg-faint" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to filter transformations... (Enter to replace)"
            className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint font-sans"
          />
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-fg-faint">
              No matching transformation found.
            </div>
          ) : (
            items.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => handleApply(item.preview, item.valid)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "flex flex-col gap-0.5 px-3 py-1.5 cursor-pointer text-xs transition-colors",
                    isSelected ? "bg-selected text-fg-bright" : "hover:bg-hover text-fg",
                    !item.valid && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <div className="flex items-center justify-between font-medium">
                    <span>{item.name}</span>
                    <span className="text-[10px] font-mono text-fg-faint">
                      {item.valid ? "Press Enter" : "Unsupported"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-fg-dim truncate">
                    <ArrowRight className="size-2.5 shrink-0 text-fg-faint" />
                    <span className="truncate">{item.preview}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line bg-chrome px-3 py-1.5 text-[10px] text-fg-faint">
          <span>{items.length} formats available</span>
          <span>Esc to cancel · ↑↓ navigate · ↵ replace</span>
        </div>
      </div>
    </div>
  );
}

