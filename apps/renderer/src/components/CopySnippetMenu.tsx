import { Check, ChevronDown, Code2, Copy, FileCode, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { curlFromParts, fetchFromParts, pythonFromParts } from "@/lib/pitcher/codegen";
import { copyText } from "@/lib/utils";
import { toast } from "@/stores/toast";

export interface CopySnippetProps {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
  className?: string;
}

export function CopySnippetMenu({
  method,
  url,
  headers,
  body = "",
  className = "",
}: CopySnippetProps) {
  const [open, setOpen] = useState(false);
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const copyCurl = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const snippet = curlFromParts(method, url, headers, body);
    if (await copyText(snippet)) {
      toast.success("Copied as cURL");
      triggerCopiedFeedback("curl");
    }
    setOpen(false);
  };

  const copyFetch = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const snippet = fetchFromParts(method, url, headers, body);
    if (await copyText(snippet)) {
      toast.success("Copied as Fetch (JavaScript)");
      triggerCopiedFeedback("fetch");
    }
    setOpen(false);
  };

  const copyPython = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const snippet = pythonFromParts(method, url, headers, body);
    if (await copyText(snippet)) {
      toast.success("Copied as Python (requests)");
      triggerCopiedFeedback("python");
    }
    setOpen(false);
  };

  const copyRawHttp = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const headerLines = headers.map(([k, v]) => `${k}: ${v}`).join("\r\n");
    const raw = `${method} ${url} HTTP/1.1\r\n${headerLines}\r\n\r\n${body}`;
    if (await copyText(raw)) {
      toast.success("Copied as Raw HTTP");
      triggerCopiedFeedback("raw");
    }
    setOpen(false);
  };

  const triggerCopiedFeedback = (type: string) => {
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 1500);
  };

  return (
    <div
      ref={menuRef}
      className={`relative inline-flex items-center rounded-sm border border-line bg-canvas ${className}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      <button
        type="button"
        onClick={copyCurl}
        title="Copy as cURL (Right-click or arrow for Fetch / Python)"
        aria-label="Copy as cURL"
        className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-fg-dim hover:bg-hover hover:text-fg transition-colors"
      >
        {copiedType ? (
          <Check className="size-3 text-status-ok" strokeWidth={2} />
        ) : (
          <Copy className="size-3" strokeWidth={1.75} />
        )}
        <span className="hidden sm:inline text-[10px]">cURL</span>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="More copy formats (Fetch, Python, Raw)"
        aria-label="More copy formats"
        className="border-l border-line px-0.5 py-0.5 text-fg-faint hover:bg-hover hover:text-fg transition-colors"
      >
        <ChevronDown className="size-2.5" />
      </button>

      {open && (
        <div className="wide-pop-up absolute right-0 top-full z-50 mt-1 min-w-[170px] rounded-md border border-line bg-panel p-1 shadow-lg text-xs">
          <button
            type="button"
            onClick={copyCurl}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-fg hover:bg-hover hover:text-fg-bright transition-colors"
          >
            <Terminal className="size-3.5 text-fg-dim" />
            <span>Copy as cURL</span>
          </button>

          <button
            type="button"
            onClick={copyFetch}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-fg hover:bg-hover hover:text-fg-bright transition-colors"
          >
            <Code2 className="size-3.5 text-fg-dim" />
            <span>Copy as Fetch</span>
          </button>

          <button
            type="button"
            onClick={copyPython}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-fg hover:bg-hover hover:text-fg-bright transition-colors"
          >
            <FileCode className="size-3.5 text-fg-dim" />
            <span>Copy as Python</span>
          </button>

          <div className="my-1 border-t border-line/60" />

          <button
            type="button"
            onClick={copyRawHttp}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-fg hover:bg-hover hover:text-fg-bright transition-colors"
          >
            <Copy className="size-3.5 text-fg-dim" />
            <span>Copy as Raw HTTP</span>
          </button>
        </div>
      )}
    </div>
  );
}

