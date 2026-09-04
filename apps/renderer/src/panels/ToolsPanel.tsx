import { LoaderCircle, Search, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import { useT } from "@/lib/i18n";
import { CATALOGUE, type MarketplaceExtension } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { useExtensions } from "@/stores/extensions";

function ExtensionRow({
  extension,
  description,
  installed,
  busy,
  warning,
  onRetry,
  labels,
  isLast,
  onOpen,
  onInstall,
  onRemove,
  onCancel,
}: {
  extension: MarketplaceExtension;

  description: string;
  installed: boolean;
  busy: boolean;

  warning: string;

  onRetry?: () => void;
  labels: { install: string; remove: string; working: string; retry: string; cancel: string };
  isLast: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onRemove: () => void;

  onCancel: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-start gap-2.5 px-3 py-2",
        !isLast && "border-b border-line",
      )}
    >
      {

}
      <button
        type="button"
        onClick={onOpen}
        aria-label={extension.name}
        title={warning || undefined}
        className={cn(
          "absolute inset-0 z-0 w-full transition-colors duration-100",
          "hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      />
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none relative z-10 mt-0.5 size-4 shrink-0"
        fill={extension.colour}
        aria-hidden="true"
      >
        <path d={extension.path} />
      </svg>
      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
        <span className={cn("block truncate text-[12px]", warning ? "text-status-error" : "text-fg")}>
          {extension.name}
        </span>
        <p className={cn("truncate pt-0.5 text-[11px]", warning ? "text-status-error/80" : "text-fg-dim")}>
          {warning || description}
        </p>
      </div>

      {

}
      {warning && !busy && (
        <button
          type="button"
          onClick={onRetry}
          disabled={!onRetry}
          title={onRetry ? labels.retry : warning}
          aria-label={onRetry ? labels.retry : warning}
          className="relative z-10 shrink-0 self-center rounded-sm p-1 text-status-error transition-colors duration-100 enabled:hover:bg-hover disabled:cursor-default"
        >
          <TriangleAlert className="size-3.5" strokeWidth={2} />
        </button>
      )}
      <button
        type="button"
        title={busy ? labels.cancel : undefined}
        onClick={busy ? onCancel : installed ? onRemove : onInstall}
        className={cn(
          "relative z-10 shrink-0 rounded-sm border px-2 py-0.5 text-[11px] transition-colors duration-100 disabled:opacity-40",
          installed
            ? "border-line text-fg-dim hover:bg-hover hover:text-fg"
            : "border-accent text-accent hover:bg-accent hover:text-bg",
        )}
      >
        {busy ? (

          <span className="group/spin flex items-center justify-center" aria-label={labels.cancel}>
            <LoaderCircle className="size-3 animate-spin group-hover/spin:hidden" strokeWidth={2} />
            <X className="hidden size-3 group-hover/spin:block" strokeWidth={2.5} />
          </span>
        ) : installed ? (
          labels.remove
        ) : (
          labels.install
        )}
      </button>
    </div>
  );
}

export function ToolsPanel() {
  const t = useT();
  const [query, setQuery] = useState("");
  const installedSet = useExtensions((state) => state.installed);
  const busyIds = useExtensions((state) => state.busy);
  const servers = useExtensions((state) => state.servers);
  const failure = useExtensions((state) => state.error);

  useEffect(() => {
    void useExtensions.getState().refresh();
  }, []);

  const results = useMemo(() => {
    const raw = query.trim().toLowerCase();
    if (!raw) return CATALOGUE;

    if (raw.startsWith(".")) {
      const wanted = raw.slice(1);
      return CATALOGUE.filter((extension) => extension.fileExtensions.includes(wanted));
    }

    return CATALOGUE.filter(
      (extension) =>
        extension.name.toLowerCase().includes(raw) ||
        extension.summary.toLowerCase().includes(raw) ||
        extension.fileExtensions.some((ext) => ext.includes(raw)),
    );
  }, [query]);

  const isInstalled = (extension: MarketplaceExtension) =>
    !extension.removable || installedSet.has(extension.id);

  const installed = results.filter(isInstalled);
  const available = results.filter((extension) => !isInstalled(extension));

  const warningFor = (extension: MarketplaceExtension): string => {
    if (!isInstalled(extension)) return "";
    const record = servers[extension.id];
    if (!record) return "";
    if (record.state === "no-manager") {
      return t("{manager} is not on this machine, so {name} could not be installed.", {
        manager: record.manager ?? "",
        name: record.command,
      });
    }
    if (record.state === "failed") {
      return t("{name} could not be installed. Highlighting only.", { name: record.command });
    }
    if (record.state === "manual") {
      return t("{name} could not be installed on this platform. Highlighting only.", { name: record.command });
    }
    return "";
  };

  const canRetry = (extension: MarketplaceExtension): boolean => {
    const record = servers[extension.id];
    return Boolean(
      isInstalled(extension) &&
        record &&
        (record.state === "failed" || record.state === "no-manager"),
    );
  };

  const labels = {
    install: t("Install"),
    remove: t("Remove"),
    working: t("Working…"),
    retry: t("Try installing the server again"),
    cancel: t("Stop"),
  };

  const rows = (list: MarketplaceExtension[]) =>
    list.map((extension, index) => (
      <ExtensionRow
        key={extension.id}
        isLast={index === list.length - 1}
        extension={extension}
        description={t(extension.summary)}
        installed={isInstalled(extension)}
        busy={busyIds.has(extension.id)}
        warning={warningFor(extension)}
        onRetry={canRetry(extension) ? () => void useExtensions.getState().retryServer(extension.id) : undefined}
        labels={labels}
        onOpen={() => useEditor.getState().openExtension(extension.id, extension.name)}
        onInstall={() => void useExtensions.getState().install(extension.id)}
        onRemove={() => void useExtensions.getState().remove(extension.id)}
        onCancel={() => void useExtensions.getState().cancel(extension.id)}
      />
    ));

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Extensions")} />

      <div className="shrink-0 border-b border-line px-2 py-2">
        <div className="flex items-center gap-1 rounded-md border border-line bg-panel px-2">
          <Search className="size-3 shrink-0 text-fg-faint" strokeWidth={1.5} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search extensions in marketplace")}
            aria-label={t("Search extensions in marketplace")}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint"
          />
        </div>
      </div>

      {failure && (
        <button
          type="button"
          onClick={() => useExtensions.setState({ error: null })}
          className="wide-enter-fade shrink-0 border-b border-line px-3 py-1.5 text-left text-[11px] leading-snug text-rose-300"
        >
          {t(failure)}
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {results.length === 0 && (
          <p className="px-3 py-3 text-[12px] text-fg-faint">{t("No extension matches that.")}</p>
        )}

        {

}
        {installed.length > 0 && (
          <>
            <p className="px-3 pb-1 pt-1 text-[10px] uppercase tracking-wide text-fg-faint">
              {t("Installed")}
            </p>
            {rows(installed)}
          </>
        )}

        {available.length > 0 && (
          <>
            <p
              className={cn(
                "px-3 pb-1 text-[10px] uppercase tracking-wide text-fg-faint",
                installed.length > 0 ? "border-t border-line pt-2" : "pt-1",
              )}
            >
              {t("Recommended")}
            </p>
            {rows(available)}
          </>
        )}
      </div>
    </div>
  );
}
