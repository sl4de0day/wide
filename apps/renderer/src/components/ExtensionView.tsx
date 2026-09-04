import { LoaderCircle, Play, RotateCw, ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

import { bridge, type ExtensionSettingsRecord } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { extensionById, type MarketplaceExtension } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "@/stores/commands";
import { useExtensions } from "@/stores/extensions";
import { useFindings, type Severity } from "@/stores/findings";
import { useRun } from "@/stores/run";
import { useWorkspace } from "@/stores/workspace";

const ANSI = /\[[0-9;]*m/g;
type Parsed = { title: string; severity: Severity; location: string; detail: string };
const mapSev = (s: string): Severity => {
  const v = s.toLowerCase();
  return v === "critical" ? "critical" : v === "high" ? "high" : v === "medium" ? "medium" : v === "low" ? "low" : "info";
};
const TOOL_PARSERS: Record<string, (output: string, target: string) => Parsed[]> = {
  nuclei: (out) => {
    const found: Parsed[] = [];
    for (const raw of out.split("\n")) {
      const line = raw.replace(ANSI, "");
      const m = /\[([^\]]+)\]\s*\[[^\]]*\]\s*\[(critical|high|medium|low|info|unknown)\]\s*(\S+)/i.exec(line);
      if (m) found.push({ title: `nuclei: ${m[1]}`, severity: mapSev(m[2]), location: m[3], detail: line.trim() });
    }
    return found;
  },
  dalfox: (out, target) => {
    const found: Parsed[] = [];
    for (const raw of out.split("\n")) {
      const line = raw.replace(ANSI, "");
      const m = /\[(POC|VULN)\]\s*(.*)/.exec(line);
      if (m) found.push({ title: "XSS (dalfox)", severity: "high", location: target, detail: m[2].slice(0, 500) });
    }
    return found;
  },
  sqlmap: (out, target) => {
    const s = out.replace(ANSI, "");
    if (!/is vulnerable|injection point|Type:\s/i.test(s)) return [];
    const params = [...s.matchAll(/Parameter:\s*([^\s(]+)/gi)].map((m) => m[1]);
    return [{ title: "SQL injection (sqlmap)", severity: "high", location: target, detail: (params.length ? "Parameters: " + params.join(", ") + "\n" : "") + s.slice(-1500).trim() }];
  },
  trufflehog: (out) => {
    const s = out.replace(ANSI, "");
    const found: Parsed[] = [];
    for (const block of s.split(/\n(?=Found |Detector Type:)/)) {
      if (!/Detector Type:|Found (verified|unverified)/i.test(block)) continue;
      const type = /Detector Type:\s*(\S+)/i.exec(block)?.[1] ?? "secret";
      const verified = /Verified:\s*true/i.test(block);
      found.push({ title: `Secret: ${type}${verified ? " (verified)" : ""}`, severity: verified ? "critical" : "high", location: /File:\s*(\S+)/i.exec(block)?.[1] ?? "", detail: block.slice(0, 600).trim() });
    }
    return found;
  },
};

function RetryButton({ id, label, stopLabel }: { id: string; label: string; stopLabel: string }) {
  const busy = useExtensions((state) => state.busy.has(id));
  return (
    <button
      type="button"
      onClick={() =>
        void (busy
          ? useExtensions.getState().cancel(id)
          : useExtensions.getState().retryServer(id))
      }
      className="mt-1 flex w-fit items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover"
    >
      <RotateCw className={cn("size-3", busy && "animate-spin")} strokeWidth={2} />
      {busy ? stopLabel : label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="w-40 shrink-0 text-[12px] text-fg-faint">{label}</span>
      <div className="min-w-0 flex-1 text-[12px] text-fg">{children}</div>
    </div>
  );
}

interface Runner {
  fields: { name: string; label: string; placeholder: string }[];
  build: (values: Record<string, string>) => string;
}

const TOOL_RUNNERS: Record<string, Runner> = {
  nuclei: { fields: [{ name: "target", label: "Target URL", placeholder: "https://example.com" }], build: (v) => `nuclei -u ${v.target}` },
  httpx: { fields: [{ name: "target", label: "Target URL", placeholder: "https://example.com" }], build: (v) => `httpx -u ${v.target} -sc -title -td` },
  katana: { fields: [{ name: "target", label: "Target URL", placeholder: "https://example.com" }], build: (v) => `katana -u ${v.target}` },
  dalfox: { fields: [{ name: "target", label: "Target URL", placeholder: "https://example.com/?q=1" }], build: (v) => `dalfox url ${v.target}` },
  sqlmap: { fields: [{ name: "target", label: "Target URL", placeholder: "https://example.com/?id=1" }], build: (v) => `sqlmap -u ${v.target} --batch` },
  commix: { fields: [{ name: "target", label: "Target URL", placeholder: "https://example.com/?q=1" }], build: (v) => `commix -u ${v.target}` },
  arjun: { fields: [{ name: "target", label: "Target URL", placeholder: "https://example.com" }], build: (v) => `arjun -u ${v.target}` },
  subfinder: { fields: [{ name: "target", label: "Domain", placeholder: "example.com" }], build: (v) => `subfinder -d ${v.target}` },
  sublist3r: { fields: [{ name: "target", label: "Domain", placeholder: "example.com" }], build: (v) => `sublist3r -d ${v.target}` },
  trufflehog: { fields: [{ name: "target", label: "Path or git URL", placeholder: "." }], build: (v) => `trufflehog filesystem ${v.target}` },
  secretfinder: { fields: [{ name: "target", label: "URL or file", placeholder: "https://example.com/app.js" }], build: (v) => `secretfinder -i ${v.target} -o cli` },
  retirejs: { fields: [{ name: "target", label: "Path", placeholder: "." }], build: (v) => `retire --path ${v.target}` },
  jwt_tool: { fields: [{ name: "target", label: "JWT", placeholder: "eyJhbGci…" }], build: (v) => `jwt_tool ${v.target}` },
  ffuf: {
    fields: [
      { name: "target", label: "Target URL (FUZZ marks the spot)", placeholder: "https://example.com/FUZZ" },
      { name: "wordlist", label: "Wordlist path", placeholder: "/usr/share/seclists/…" },
    ],
    build: (v) => `ffuf -u ${v.target} -w ${v.wordlist}`,
  },
};

function ToolRunner({ id }: { id: string }) {
  const t = useT();
  const runner = TOOL_RUNNERS[id];
  const parser = TOOL_PARSERS[id] as ((output: string, target: string) => Parsed[]) | undefined;
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  if (!runner) return null;

  const ready = runner.fields.every((field) => (values[field.name] ?? "").trim().length > 0);
  const run = () => {
    if (!ready) return;
    useRun.getState().send(runner.build(values));

    useCommandPalette.getState().runById("view.terminal");
  };

  const collect = async () => {
    if (!ready || busy || !parser) return;
    setBusy(true);
    setNote(t("Running…"));
    try {
      const root = useWorkspace.getState().root ?? "";
      const reply = await bridge.toolScanRun(root, runner.build(values));
      if (!reply.ok) {
        setNote(reply.error ?? t("Run failed."));
        return;
      }
      const rows = parser(reply.output ?? "", values.target ?? "");
      for (const row of rows) {
        useFindings.getState().add({ title: row.title, severity: row.severity, location: row.location, detail: `${row.detail}\n\n— ${id}` });
      }
      setNote(reply.timedOut ? t("Timed out; {n} findings added.", { n: rows.length }) : rows.length ? t("{n} findings added.", { n: rows.length }) : t("No findings parsed."));
      if (rows.length) useCommandPalette.getState().runById("view.findings");
    } catch (error) {
      setNote(String((error as Error)?.message ?? error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-md border border-line p-3">
      <p className="pb-2 text-[12px] font-medium text-fg">{t("Run")}</p>
      {runner.fields.map((field) => (
        <label key={field.name} className="mb-2 flex flex-col gap-1">
          <span className="text-[11px] text-fg-faint">{t(field.label)}</span>
          <input
            value={values[field.name] ?? ""}
            onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
            placeholder={field.placeholder}
            spellCheck={false}
            className="w-full rounded-sm border border-line bg-panel px-2 py-1 font-mono text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
          />
        </label>
      ))}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={!ready}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1 text-[12px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
        >
          <Play className="size-3" strokeWidth={2} fill="currentColor" />
          {t("Run in terminal")}
        </button>
        {parser && (
          <button
            type="button"
            onClick={collect}
            disabled={!ready || busy}
            title={t("Run once and turn the output into findings")}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1 text-[12px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
          >
            {busy ? <LoaderCircle className="size-3 animate-spin" strokeWidth={2} /> : <ShieldAlert className="size-3" strokeWidth={2} />}
            {t("Collect findings")}
          </button>
        )}
        {note && <span className="text-[11px] text-fg-faint">{note}</span>}
      </div>
      <p className="pt-2 font-mono text-[10px] text-fg-faint">{ready ? runner.build(values) : ""}</p>
    </div>
  );
}

type SettingValue = string | number | boolean;

function resolveRecord(
  extension: MarketplaceExtension,
  values: Record<string, SettingValue>,
  serverCommand: string,
): ExtensionSettingsRecord {
  const init: Record<string, SettingValue> = {};
  const env: Record<string, string> = {};
  let command = serverCommand;
  for (const setting of extension.settings ?? []) {
    const value = values[setting.key];
    if (value === undefined || value === "") continue;
    if (setting.apply.bucket === "init") init[setting.apply.path] = value;
    else if (setting.apply.bucket === "env") env[setting.apply.name] = String(value);
    else if (setting.apply.bucket === "serverCommand") command = String(value);
  }
  return { values, serverCommand: command.trim(), init, env };
}

function ExtensionSettings({ extension }: { extension: MarketplaceExtension }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, SettingValue>>({});
  const [serverCommand, setServerCommand] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    void bridge.extensionGetSettings().then((result) => {
      if (!live || !result.ok) return;
      const record = result.settings?.[extension.id];
      const seeded: Record<string, SettingValue> = {};
      for (const setting of extension.settings ?? []) {
        seeded[setting.key] = record?.values?.[setting.key] ?? setting.default;
      }
      setValues(seeded);
      setServerCommand(record?.serverCommand ?? "");
    });
    return () => {
      live = false;
    };
  }, [extension.id, extension.settings]);

  const persist = (nextValues: Record<string, SettingValue>, nextCommand: string) => {
    void bridge.extensionSetSettings(extension.id, resolveRecord(extension, nextValues, nextCommand)).then((result) => {
      if (result.ok) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1500);
      }
    });
  };

  const setValue = (key: string, value: SettingValue) => {
    const next = { ...values, [key]: value };
    setValues(next);
    persist(next, serverCommand);
  };

  return (
    <div className="mt-6 rounded-md border border-line p-3">
      <p className="flex items-center gap-2 pb-2 text-[12px] font-medium text-fg">
        {t("Settings")}
        {saved && <span className="text-[10px] text-emerald-300">{t("Saved")}</span>}
      </p>

      {extension.server && (
        <label className="mb-3 flex flex-col gap-1">
          <span className="text-[11px] text-fg-faint">{t("Server command")}</span>
          <input
            value={serverCommand}
            onChange={(event) => {
              setServerCommand(event.target.value);
              persist(values, event.target.value);
            }}
            placeholder={extension.server}
            spellCheck={false}
            className="w-full rounded-sm border border-line bg-panel px-2 py-1 font-mono text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
          />
          <span className="text-[10px] text-fg-faint">
            {t("A full path or a different command to run instead of looking for {name} on PATH.", {
              name: extension.server,
            })}
          </span>
        </label>
      )}

      {(extension.settings ?? []).map((setting) => (
        <label key={setting.key} className="mb-3 flex flex-col gap-1">
          <span className="text-[11px] text-fg-faint">{t(setting.label)}</span>
          {setting.type === "select" ? (
            <select
              value={String(values[setting.key] ?? setting.default)}
              onChange={(event) => setValue(setting.key, event.target.value)}
              className="w-full rounded-sm border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent"
            >
              {(setting.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          ) : setting.type === "boolean" ? (
            <input
              type="checkbox"
              checked={Boolean(values[setting.key] ?? setting.default)}
              onChange={(event) => setValue(setting.key, event.target.checked)}
              className="size-4 self-start accent-accent"
            />
          ) : (
            <input
              type={setting.type === "number" ? "number" : "text"}
              value={String(values[setting.key] ?? setting.default ?? "")}
              onChange={(event) =>
                setValue(setting.key, setting.type === "number" ? Number(event.target.value) : event.target.value)
              }
              spellCheck={false}
              className="w-full rounded-sm border border-line bg-panel px-2 py-1 font-mono text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent"
            />
          )}
          {setting.description && <span className="text-[10px] text-fg-faint">{t(setting.description)}</span>}
        </label>
      ))}
    </div>
  );
}

export function ExtensionView({ id }: { id: string }) {
  const t = useT();
  const extension = extensionById(id);
  const installedSet = useExtensions((state) => state.installed);
  const busy = useExtensions((state) => state.busy.has(id));

  const serverRecord = useExtensions((state) => state.servers[id]);

  if (!extension) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[12px] italic text-fg-dim">{t("That extension is not installed.")}</p>
      </div>
    );
  }

  const builtIn = extension.id === "javascript" || extension.id === "typescript";
  const language = extension.kind === "language";
  const installed = installedSet.has(extension.id);

  return (
    <div className="wide-enter-fade h-full overflow-auto px-6 py-5">
      <div className="mx-auto w-full max-w-[680px]">
        <div className="flex items-start gap-4">
          <svg viewBox="0 0 24 24" className="size-12 shrink-0" fill={extension.colour} aria-hidden="true">
            <path d={extension.path} />
          </svg>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-semibold text-fg-bright">{extension.name}</h1>
            <p className="pt-1 text-[13px] text-fg-muted">{t(extension.summary)}</p>
            <p className="flex flex-wrap items-center gap-2 pt-2 text-[11px] text-fg-faint">
              <span className="tabular-nums">{extension.version}</span>
              <span aria-hidden="true">·</span>
              <span className="rounded-sm bg-panel px-1.5 py-0.5">
                {installed ? t("Installed") : t("Not installed")}
              </span>
            </p>
          </div>

            <button
            type="button"
            title={busy ? t("Stop") : undefined}
            onClick={() =>
              void (busy
                ? useExtensions.getState().cancel(extension.id)
                : installed
                  ? useExtensions.getState().remove(extension.id)
                  : useExtensions.getState().install(extension.id))
            }
            className={cn(
              "min-w-[76px] shrink-0 rounded-sm border px-3 py-1 text-center text-[12px] transition-colors duration-100",
              installed
                ? "border-line text-fg-dim hover:bg-hover hover:text-fg"
                : "border-accent text-accent hover:bg-accent hover:text-bg",
            )}
          >
            {busy ? (

              <span className="group/spin flex items-center justify-center" aria-label={t("Stop")}>
                <LoaderCircle
                  className="size-3.5 animate-spin group-hover/spin:hidden"
                  strokeWidth={2}
                />
                <X className="hidden size-3.5 group-hover/spin:block" strokeWidth={2.5} />
              </span>
            ) : installed ? (
              t("Remove")
            ) : (
              t("Install")
            )}
          </button>
        </div>

        {

}
        {

}
        <div className="flex flex-col gap-3 pt-6">
          {t(extension.description)
            .split("\n\n")
            .map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="text-[13px] leading-relaxed text-fg">
                {paragraph}
              </p>
            ))}
        </div>

        {installed && <ToolRunner id={id} />}

        <div className="pt-6">
          {language ? (
            <>
              <Field label={t("File extensions")}>
                <span className="flex flex-wrap gap-1">
                  {extension.fileExtensions.map((ext) => (
                    <code
                      key={ext}
                      className="rounded-sm bg-panel px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
                    >
                      .{ext}
                    </code>
                  ))}
                </span>
              </Field>

              <Field label={t("Syntax highlighting")}>{t("Included")}</Field>

              <Field label={t("Language server")}>
                {builtIn ? (
                  <span>{t("Built in, no separate server needed.")}</span>
                ) : !extension.server ? (
                  <span className="text-fg-faint">{t("None, highlighting only.")}</span>
                ) : serverRecord?.state === "present" || serverRecord?.state === "installed" ? (
                  <span className="flex flex-col gap-1">
                    <span className="text-emerald-300">
                      {serverRecord.state === "installed"
                        ? t("{name} was installed on this machine.", { name: serverRecord.command })
                        : t("{name} was already on this machine.", { name: serverRecord.command })}
                    </span>
                    {
}
                    <code
                      className="truncate font-mono text-[11px] text-fg-faint"
                      title={serverRecord.path}
                    >
                      {serverRecord.path}
                    </code>
                  </span>
                ) : serverRecord?.state === "no-manager" ? (
                  <span className="flex flex-col gap-1">
                    <span className="text-status-error">
                      {t("{manager} is not on this machine, so {name} could not be installed.", {
                        manager: serverRecord.manager ?? "",
                        name: serverRecord.command,
                      })}
                    </span>
                    <span className="text-[11px] text-fg-faint">
                      {t("The toolchain it needs could not be installed either.")}
                    </span>
                    <RetryButton id={id} label={t("Try installing the server again")} stopLabel={t("Stop")} />
                  </span>
                ) : serverRecord?.state === "failed" ? (
                  <span className="flex flex-col gap-1">
                    <span className="text-status-error">
                      {t("{name} could not be installed. Highlighting only.", {
                        name: serverRecord.command,
                      })}
                    </span>
                    {
}
                    {serverRecord.detail && (
                      <code className="whitespace-pre-wrap font-mono text-[11px] text-fg-faint">
                        {serverRecord.detail}
                      </code>
                    )}
                    <span className="text-[11px] text-fg-faint">
                      {t("Wide tried once and stopped, rather than looping on something that will fail the same way.")}
                    </span>
                    <RetryButton id={id} label={t("Try installing the server again")} stopLabel={t("Stop")} />
                  </span>
                ) : serverRecord?.state === "manual" ? (
                  <span className="flex flex-col gap-1">
                    <span className="text-status-error">
                      {t("{name} could not be installed on this platform. Highlighting only.", {
                        name: serverRecord.command,
                      })}
                    </span>
                    <span className="text-[11px] text-fg-faint">
                      {t("This one ships as an archive to unpack, which is not a single command.")}
                    </span>
                  </span>
                ) : (
                  <span className="flex flex-col gap-1">
                    <code className="font-mono text-[11px] text-fg-muted">{extension.server}</code>
                    <span className="text-[11px] text-fg-faint">
                      {t("Wide installs it for you when you install this extension.")}
                    </span>
                  </span>
                )}
              </Field>

              <Field label={t("Version shown")}>
                <span className="text-fg-faint">
                  {t("The language's current stable release when this build was made.")}
                </span>
              </Field>

              {
}
              {installed && !builtIn && (extension.server || (extension.settings?.length ?? 0) > 0) && (
                <ExtensionSettings extension={extension} />
              )}
            </>
          ) : (
            <>
              <Field label={t("What it adds")}>
                <span className="flex flex-col gap-0.5">
                  {extension.provides.map((line) => (
                    <span key={line}>{t(line)}</span>
                  ))}
                </span>
              </Field>

              {

}
              {extension.id === "codeberg" && (
                <>
                  <Field label={t("Requires")}>
                    <span className="flex flex-col gap-1">
                      <code className="font-mono text-[11px] text-fg-muted">git</code>
                      <span className="text-[11px] text-fg-faint">
                        {t("Wide talks to it if you install it; it never installs one for you.")}
                      </span>
                    </span>
                  </Field>

                  <Field label={t("Your token")}>
                    <span className="text-[11px] leading-relaxed text-fg-faint">
                      {t(
                        "Wide never stores it. Signing in hands the token to Git's own credential manager through its standard input, so it is never written to a command line, a file of Wide's, or the audit log.",
                      )}
                    </span>
                  </Field>
                </>
              )}

              {extension.homepage && (
                <Field label={t("Home")}>
                  <code className="font-mono text-[11px] text-fg-muted">{extension.homepage}</code>
                </Field>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
