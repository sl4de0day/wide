import { useT } from "@/lib/i18n";
import type { MediaTab } from "@/stores/editor";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaView({ tab }: { tab: MediaTab }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col overflow-auto bg-canvas">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1.5 text-[11px] text-fg-faint">
        <span className="truncate">{tab.name}</span>
        <span className="tabular-nums">{humanSize(tab.size)}</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        {tab.mediaKind === "image" ? (
          <img src={tab.dataUri} alt={tab.name} className="max-h-full max-w-full object-contain" style={{ imageRendering: "auto" }} />
        ) : tab.mediaKind === "pdf" ? (
          <iframe title={tab.name} src={tab.dataUri} className="h-full w-full border-0" />
        ) : tab.mediaKind === "font" ? (
          <FontPreview dataUri={tab.dataUri} name={tab.name} sample={t("The quick brown fox jumps over the lazy dog 0123456789")} />
        ) : (
          <p className="text-[12px] text-fg-faint">{t("This is a binary file — no preview available.")}</p>
        )}
      </div>
    </div>
  );
}

function FontPreview({ dataUri, name, sample }: { dataUri: string; name: string; sample: string }) {
  const family = `wide-preview-${name.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div className="w-full max-w-2xl">
      <style>{`@font-face { font-family: "${family}"; src: url("${dataUri}"); }`}</style>
      <div style={{ fontFamily: `"${family}", sans-serif` }} className="space-y-3 text-fg">
        <p className="text-2xl">{sample}</p>
        <p className="text-lg">{sample}</p>
        <p className="text-sm">{sample}</p>
      </div>
    </div>
  );
}
