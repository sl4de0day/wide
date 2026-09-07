import { KeyRound, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCatcher } from "@/stores/catcher";
import { useEditor } from "@/stores/editor";
import { usePitcher } from "@/stores/pitcher";
import { useScanner } from "@/stores/scanner";
import { toast } from "@/stores/toast";
import { useVault } from "@/stores/vault";
import type { VaultEntry } from "@/lib/bridge";

const KINDS: { id: VaultEntry["kind"]; label: string }[] = [
  { id: "bearer", label: "Bearer token" },
  { id: "header", label: "Custom header" },
  { id: "cookie", label: "Cookie" },
  { id: "basic", label: "Basic (user:pass)" },
];

const input =
  "w-full rounded-sm border border-line bg-canvas px-2 py-1 text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint";
const label = "text-[10px] uppercase tracking-wide text-fg-faint";
const chip =
  "rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg";

export function VaultView() {
  const t = useT();
  const entries = useVault((state) => state.entries);
  const loaded = useVault((state) => state.loaded);
  const error = useVault((state) => state.error);

  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<VaultEntry["kind"]>("bearer");
  const [headerName, setHeaderName] = useState("");
  const [secret, setSecret] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!loaded) void useVault.getState().load();
  }, [loaded]);

  const reset = () => {
    setEditing(null);
    setName("");
    setKind("bearer");
    setHeaderName("");
    setSecret("");
    setNote("");
  };

  const submit = async () => {
    if (!name.trim()) return;
    const ok = await useVault.getState().save({
      id: editing ?? undefined,
      name: name.trim(),
      kind,
      headerName: headerName.trim(),
      note: note.trim(),
      secret,
    });
    if (ok) {
      toast.success(editing ? t("Credential updated.") : t("Credential saved."));
      reset();
    } else {
      toast.error(t(useVault.getState().error || "The credential could not be saved."));
    }
  };

  const applyTo = async (entry: VaultEntry, target: "scanner" | "pitcher" | "repeater") => {
    const headers = await useVault.getState().headersFor(entry.id);
    if (headers.length === 0) {
      toast.error(t("That credential is gone."));
      return;
    }

    if (target === "scanner") {
      const text = headers.map(([key, value]) => `${key}: ${value}`).join("\n");
      useScanner.getState().setSession(text);
      useCatcher.getState().show("scanner");
      toast.success(t("Applied to the Scanner session."));
      return;
    }

    if (target === "repeater") {
      useCatcher.getState().addRepeater({
        method: "GET",
        url: "https://example.com/",
        headers,
        body: "",
      });
      toast.success(t("Sent to Repeater"));
      return;
    }

    usePitcher.getState().captureRequest({
      name: entry.name,
      method: "GET",
      url: "https://example.com/",
      headers,
      body: "",
    });
    useEditor.getState().openPitcher();
    toast.success(t("Saved to Pitcher"));
  };

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <div className="flex min-h-0 w-1/2 flex-col border-r border-line">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
          <KeyRound className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-[11px] uppercase tracking-wide text-fg-faint">
            {t("Saved credentials")}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-fg-faint">{entries.length}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {entries.length === 0 ? (
            <p className="px-3 py-4 text-[12px] leading-relaxed text-fg-faint">
              {t("Nothing saved yet. Add a token, cookie or header on the right and reuse it across Catcher, Pitcher and the Scanner.")}
            </p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="border-b border-line px-3 py-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-3 shrink-0 text-status-ok" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{entry.name}</span>
                  <span className="shrink-0 text-[10px] text-fg-faint">{entry.kind}</span>
                </div>
                {entry.note && <p className="truncate pt-0.5 text-[10px] text-fg-faint">{entry.note}</p>}
                <div className="flex flex-wrap items-center gap-1 pt-1.5">
                  <button type="button" className={chip} onClick={() => void applyTo(entry, "scanner")}>
                    {t("Use in Scanner")}
                  </button>
                  <button type="button" className={chip} onClick={() => void applyTo(entry, "repeater")}>
                    {t("Use in Repeater")}
                  </button>
                  <button type="button" className={chip} onClick={() => void applyTo(entry, "pitcher")}>
                    {t("Use in Pitcher")}
                  </button>
                  <span className="flex-1" />
                  <button
                    type="button"
                    className={chip}
                    onClick={() => {
                      setEditing(entry.id);
                      setName(entry.name);
                      setKind(entry.kind);
                      setHeaderName(entry.headerName);
                      setNote(entry.note);
                      setSecret("");
                    }}
                  >
                    {t("Edit")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("Remove")}
                    title={t("Remove")}
                    className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-rose-300"
                    onClick={() => void useVault.getState().remove(entry.id)}
                  >
                    <Trash2 className="size-3" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex min-h-0 w-1/2 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
          <Plus className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <span className="text-[11px] uppercase tracking-wide text-fg-faint">
            {editing ? t("Edit credential") : t("New credential")}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
          <div>
            <p className={label}>{t("Name")}</p>
            <input value={name} onChange={(event) => setName(event.target.value)} aria-label={t("Name")} className={cn(input, "mt-1")} spellCheck={false} />
          </div>

          <div>
            <p className={label}>{t("Kind")}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {KINDS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setKind(option.id)}
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors duration-100",
                    kind === option.id ? "border-accent text-accent" : "border-line text-fg-dim hover:bg-hover hover:text-fg",
                  )}
                >
                  {t(option.label)}
                </button>
              ))}
            </div>
          </div>

          {kind === "header" && (
            <div>
              <p className={label}>{t("Header name")}</p>
              <input
                value={headerName}
                onChange={(event) => setHeaderName(event.target.value)}
                aria-label={t("Header name")}
                placeholder="X-Api-Key"
                className={cn(input, "mt-1 font-mono")}
                spellCheck={false}
              />
            </div>
          )}

          <div>
            <p className={label}>{editing ? t("Secret (leave empty to keep the current one)") : t("Secret")}</p>
            <textarea
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              aria-label={t("Secret")}
              rows={3}
              className={cn(input, "mt-1 resize-y font-mono")}
              spellCheck={false}
            />
            <p className="pt-1 text-[10px] text-fg-faint">
              {t("Secrets are encrypted by Windows and never leave this machine.")}
            </p>
          </div>

          <div>
            <p className={label}>{t("Note")}</p>
            <input value={note} onChange={(event) => setNote(event.target.value)} aria-label={t("Note")} className={cn(input, "mt-1")} spellCheck={false} />
          </div>

          {error && <p className="text-[11px] text-status-error">{t(error)}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!name.trim() || (!editing && !secret)}
              className="flex items-center gap-1.5 rounded-md border border-accent px-2.5 py-1 text-[11px] text-accent transition-colors duration-100 hover:bg-accent hover:text-bg disabled:opacity-40"
            >
              <Send className="size-3" strokeWidth={1.75} />
              {editing ? t("Update") : t("Save")}
            </button>
            {editing && (
              <button type="button" onClick={reset} className={chip}>
                {t("Cancel")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
