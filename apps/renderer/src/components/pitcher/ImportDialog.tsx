import { useState } from "react";

import { useT } from "@/lib/i18n";
import { importAny } from "@/lib/pitcher/import";
import { usePitcher } from "@/stores/pitcher";

import { Modal } from "./Modal";

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState("");

  const detected = text.trim() ? importAny(text) : null;
  const count = detected ? countRequests(detected.collections) : 0;

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const doImport = () => {
    if (!detected || detected.collections.length === 0) return;
    usePitcher.getState().addCollections(detected.collections);
    onClose();
  };

  return (
    <Modal title={t("Import")} onClose={onClose} wide>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[11px]">
          <label className="cursor-pointer rounded-sm border border-line px-2 py-1 text-fg-dim hover:bg-hover hover:text-fg">
            {t("Open file…")}
            <input
              type="file"
              accept=".json,.har,.http,.txt,.yaml,.yml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
          <span className="text-fg-faint">{t("Postman · Insomnia · OpenAPI · HAR · curl · .http")}</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={t("Paste an export here, or open a file…")}
          className="w-full resize-y rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
        />
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[11px] text-fg-faint">
            {detected && detected.format !== "unknown"
              ? t("Detected {f} — {n} request(s).").replace("{f}", formatName(detected.format)).replace("{n}", String(count))
              : text.trim()
                ? t("Unrecognised format.")
                : ""}
          </span>
          <button type="button" onClick={onClose} className="rounded-sm border border-line px-3 py-1 text-[11px] text-fg-dim hover:bg-hover">{t("Cancel")}</button>
          <button
            type="button"
            onClick={doImport}
            disabled={!detected || detected.collections.length === 0}
            className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent hover:bg-accent hover:text-bg disabled:opacity-40"
          >
            {t("Import")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function countRequests(collections: { nodes: unknown[] }[]): number {
  let n = 0;
  const walk = (nodes: { kind?: string; nodes?: unknown[] }[]) => {
    for (const node of nodes) {
      if (node.kind === "folder") walk((node.nodes as { kind?: string }[]) ?? []);
      else n += 1;
    }
  };
  for (const c of collections) walk(c.nodes as { kind?: string }[]);
  return n;
}

function formatName(format: string): string {
  switch (format) {
    case "postman":
      return "Postman";
    case "insomnia":
      return "Insomnia";
    case "openapi":
      return "OpenAPI / Swagger";
    case "har":
      return "HAR";
    case "curl":
      return "curl";
    case "http":
      return ".http";
    default:
      return format;
  }
}
