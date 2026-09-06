import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge, type RemoteConfig } from "@/lib/bridge";
import { LANGUAGES, useT, type Language } from "@/lib/i18n";
import { THEMES, type ThemeId } from "@/lib/themes";
import { formatCombo, shortcutFor, useCommandPalette } from "@/stores/commands";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { useSettings } from "@/stores/settings";
import { useUpdate } from "@/stores/update";

const ABOUT_DESCRIPTION =
  "Wide is an IDE that unifies web development and web security in a single ecosystem. It detects vulnerabilities in real time as you code, enabling secure development from line one, while providing built-in tools to execute full-scale, professional web penetration tests. Whether you are a web pentester, bug bounty hunter, or web developer, Wide is the only tool you need.";
const ABOUT_REPO_URL = "https://github.com/sl4de0day/wide";

const THEME_PREVIEW_LINES: { token: string; width: number }[][] = [
  [
    { token: "syn-keyword", width: 13 },
    { token: "syn-function", width: 22 },
    { token: "syn-punct", width: 5 },
  ],
  [
    { token: "syn-property", width: 10 },
    { token: "syn-string", width: 28 },
  ],
  [
    { token: "syn-number", width: 8 },
    { token: "syn-type", width: 15 },
    { token: "syn-comment", width: 12 },
  ],
];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-line py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-fg">{label}</p>
        {hint && <p className="pt-0.5 text-[11px] text-fg-faint">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        "h-5 w-9 rounded-full p-0.5 transition-colors duration-100",
        value ? "bg-selected" : "bg-panel",
      )}
    >
      <span
        className={cn(
          "block size-4 rounded-full bg-fg-muted transition-transform duration-100",
          value && "translate-x-4 bg-fg-bright",
        )}
      />
    </button>
  );
}

function LanguagePicker({
  value,
  onChange,
}: {
  value: Language;
  onChange: (next: Language) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((language) => language.id === value) ?? LANGUAGES[0];
  const isBeta = (id: Language) => id !== "en" && id !== "tr";

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-44 items-center justify-between gap-2 rounded-md border border-line px-2 py-1 text-[12px] text-fg transition-colors duration-100 hover:bg-hover"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{current.label}</span>
          {isBeta(current.id) && (
            <span className="shrink-0 rounded-sm border border-line px-1 text-[9px] uppercase tracking-wide text-fg-faint">beta</span>
          )}
        </span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-fg-faint transition-transform duration-100", open && "rotate-180")}
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-1 max-h-64 w-44 overflow-auto rounded-md border border-line bg-raised py-0.5 shadow-lg"
        >
          {LANGUAGES.map((language) => (
            <button
              key={language.id}
              type="button"
              role="option"
              aria-selected={language.id === value}
              onClick={() => {
                onChange(language.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px] transition-colors duration-100",
                language.id === value
                  ? "bg-selected text-fg-bright"
                  : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              <span className="truncate">{language.label}</span>
              {isBeta(language.id) && (
                <span className="ml-auto shrink-0 rounded-sm border border-line px-1 text-[9px] uppercase tracking-wide text-fg-faint">beta</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EXTRA_SHORTCUTS: { combo: string; label: string }[] = [
  { combo: "ctrl+shift+p", label: "Command palette" },
  { combo: "ctrl+tab", label: "Next tab" },
  { combo: "ctrl+shift+tab", label: "Previous tab" },
  { combo: "ctrl+=", label: "Zoom in" },
  { combo: "ctrl+-", label: "Zoom out" },
  { combo: "ctrl+0", label: "Reset font size" },
];

function ShortcutsSection() {
  const t = useT();
  const commands = useCommandPalette((state) => state.commands);
  const bindings = useCommandPalette((state) => state.bindings);
  const rows = commands
    .map((command) => ({ label: t(command.title), combo: shortcutFor(command, bindings) }))
    .filter((row): row is { label: string; combo: string } => Boolean(row.combo))
    .sort((a, b) => a.label.localeCompare(b.label));
  const line = (label: string, combo: string) => (
    <div key={label + combo} className="flex items-center justify-between py-0.5 text-[12px]">
      <span className="min-w-0 truncate text-fg-dim">{label}</span>
      <kbd className="ml-2 shrink-0 rounded-sm border border-line bg-panel px-1.5 text-[10px] text-fg-dim">{formatCombo(combo)}</kbd>
    </div>
  );
  return (
    <div className="border-b border-line py-2">
      {EXTRA_SHORTCUTS.map((s) => line(t(s.label), s.combo))}
      {rows.map((row) => line(row.label, row.combo))}
      <p className="pt-2 text-[11px] leading-snug text-fg-faint">
        {t("Rebind a command by adding \"combo\": \"command.id\" to .wide/keybindings.json in your project.")}
      </p>
    </div>
  );
}

function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeId;
  onChange: (next: ThemeId) => void;
}) {
  const t = useT();
  return (
    <div role="radiogroup" className="flex w-full flex-col gap-1">
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          role="radio"
          aria-checked={value === theme.id}
          onClick={() => onChange(theme.id)}
          className={cn(
            "flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors duration-100",
            value === theme.id
              ? "border-line-strong bg-selected"
              : "border-line hover:bg-hover",
          )}
        >
          <span
            data-theme={theme.id}
            className="flex shrink-0 flex-col justify-center gap-[3px] overflow-hidden rounded-sm border border-line px-2 py-2"
            style={{ background: "var(--canvas)", width: 82, height: 46 }}
            aria-hidden="true"
          >
            {THEME_PREVIEW_LINES.map((line, index) => (
              <span key={index} className="flex items-center gap-[3px]">
                {line.map((bar) => (
                  <span
                    key={bar.token}
                    className="block rounded-full"
                    style={{ background: `var(--${bar.token})`, width: bar.width, height: 3 }}
                  />
                ))}
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-fg">{t(theme.label)}</span>
            <span className="block text-[11px] text-fg-faint">{t(theme.hint)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function RemoteSection() {
  const t = useT();
  const [config, setConfig] = useState<RemoteConfig>({ node: "node" });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    bridge
      .remoteGet()
      .then((reply) => {
        if (alive && reply.ok && reply.config) setConfig({ node: "node", ...reply.config });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const field = (key: keyof RemoteConfig, value: string | boolean) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setState("idle");
  };

  const save = async () => {
    setState("saving");
    setError("");
    const reply = await bridge.remoteSet({
      enabled: Boolean(config.enabled),
      host: (config.host ?? "").trim(),
      remotePath: (config.remotePath ?? "").trim(),
      node: (config.node ?? "node").trim() || "node",
    });
    if (reply.ok) setState("saved");
    else {
      setState("error");
      setError(reply.error ?? t("The remote target could not be saved."));
    }
  };

  const input = (key: keyof RemoteConfig, placeholder: string) => (
    <input
      value={String(config[key] ?? "")}
      onChange={(event) => field(key, event.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="w-60 rounded-sm border border-line bg-panel px-2 py-1 font-mono text-[12px] text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
    />
  );

  return (
    <>
      <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("Remote")}</h2>
      <Row
        label={t("Run the backend over SSH")}
        hint={t("When on and saved, Wide reconnects its backend to the remote host instead of this machine.")}
      >
        <Toggle value={Boolean(config.enabled)} onChange={(next) => field("enabled", next)} />
      </Row>
      <Row label={t("SSH host")} hint={t("user@host, or a Host from your ~/.ssh/config. Key or agent auth only.")}>
        {input("host", "user@host")}
      </Row>
      <Row label={t("Remote path")} hint={t("The folder on the remote holding the synced backend.")}>
        {input("remotePath", "/home/you/wide-backend")}
      </Row>
      <Row label={t("Node command")} hint={t("How node is started on the remote.")}>
        {input("node", "node")}
      </Row>
      <div className="flex items-center gap-3 pt-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={state === "saving"}
          className="rounded-md border border-line px-3 py-1.5 text-[12px] text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-50"
        >
          {t("Save")}
        </button>
        {state === "saved" && <span className="text-[11px] text-status-ok">{t("Saved.")}</span>}
        {state === "error" && <span className="text-[11px] text-status-error">{t(error)}</span>}
      </div>
      <p className="pt-2 text-[11px] text-fg-faint">
        {t("The remote needs Node and a synced copy of Wide's backend at the path above — see scripts/remote-sync.")}
      </p>
    </>
  );
}

function UpdatesSection() {
  const t = useT();
  const current = useUpdate((state) => state.current);

  return (
    <>
      <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("Updates")}</h2>
      <Row
        label={t("Automatic updates")}
        hint={t("Wide checks for updates on startup and installs them automatically from GitHub.")}
      >
        <span className="font-mono text-[12px] text-fg-dim">{current || "…"}</span>
      </Row>
    </>
  );
}

export function SettingsView() {
  const settings = useSettings();
  const t = useT();
  const aboutVersion = useUpdate((state) => state.current);

  useEffect(() => {
    if (!aboutVersion) void useUpdate.getState().check();
  }, [aboutVersion]);

  return (
    <div className="wide-enter-fade h-full overflow-auto px-6 py-5">
      <div className="mx-auto w-full max-w-[560px]">
        <h1 className="text-[16px] font-semibold text-fg-bright">{t("Settings")}</h1>

        <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("Appearance")}</h2>
        <Row label={t("Language")} hint={t("The language of the interface.")}>
          <LanguagePicker
            value={settings.language}
            onChange={(next) => settings.set({ language: next })}
          />
        </Row>
        {}
        <div className="border-b border-line py-3">
          <p className="pb-2 text-[13px] text-fg">{t("Theme")}</p>
          <ThemePicker
            value={settings.theme}
            onChange={(next) => settings.set({ theme: next })}
          />
        </div>

        <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("Keyboard Shortcuts")}</h2>
        <ShortcutsSection />

        <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("Editor")}</h2>
        <Row label={t("Font size")}>
          <input
            type="number"
            min={10}
            max={24}
            value={settings.fontSize}
            onChange={(event) => settings.set({ fontSize: Number(event.target.value) })}
            className="w-16 rounded-sm border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none"
          />
        </Row>
        <Row label={t("Tab size")}>
          <input
            type="number"
            min={2}
            max={8}
            value={settings.tabSize}
            onChange={(event) => settings.set({ tabSize: Number(event.target.value) })}
            className="w-16 rounded-sm border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none"
          />
        </Row>
        <Row label={t("Indent with tabs")} hint={t("Off inserts spaces.")}>
          <Toggle value={settings.useTabs} onChange={(next) => settings.set({ useTabs: next })} />
        </Row>
        <Row label={t("Wrap long lines")}>
          <Toggle value={settings.lineWrapping} onChange={(next) => settings.set({ lineWrapping: next })} />
        </Row>
        <Row label={t("Colourful syntax")} hint={t("Off flattens every token to one tone.")}>
          <Toggle value={settings.colorfulSyntax} onChange={(next) => settings.set({ colorfulSyntax: next })} />
        </Row>
        <Row label={t("Terminal shell")} hint={t("Applies to the next terminal you open.")}>
          <select
            value={settings.terminalShell}
            onChange={(event) => settings.set({ terminalShell: event.target.value as typeof settings.terminalShell })}
            className="rounded-sm border border-line bg-canvas px-2 py-1 text-[12px] text-fg outline-none"
          >
            <option value="default">{t("Default")}</option>
            <option value="cmd">Command Prompt</option>
            <option value="powershell">Windows PowerShell</option>
            <option value="pwsh">PowerShell (pwsh)</option>
            <option value="gitbash">Git Bash</option>
            <option value="wsl">WSL</option>
          </select>
        </Row>
        <Row
          label={t("Format on save")}
          hint={t(
            "Prettier for JS, TS, HTML, CSS, GraphQL, JSON and Markdown; the tool you have installed for the rest.",
          )}
        >
          <Toggle value={settings.formatOnSave} onChange={(next) => settings.set({ formatOnSave: next })} />
        </Row>

        <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("Security")}</h2>
        <Row
          label={t("Real-time security analysis")}
          hint={t("Flags likely vulnerabilities as you type — XSS sinks, injection, weak crypto, secrets — with a fix on hover.")}
        >
          <Toggle value={settings.securityLint} onChange={(next) => settings.set({ securityLint: next })} />
        </Row>
        <Row
          label={t("Security policy")}
          hint={t("What Wide is allowed to touch, and a log of every decision it has made.")}
        >
          <button
            type="button"
            onClick={() => useEditor.getState().openPolicy()}
            className="rounded-md border border-line px-3 py-1 text-[12px] text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            {t("Open")}
          </button>
        </Row>

        <RemoteSection />

        <UpdatesSection />

        <h2 className="pt-6 text-[11px] uppercase tracking-wide text-fg-faint">{t("About")}</h2>
        <div className="border-b border-line py-3">
          <p className="text-[14px] font-semibold text-fg-bright">{t("About Wide")}</p>
          <p className="pt-2 text-[12px] leading-relaxed text-fg-dim">{ABOUT_DESCRIPTION}</p>
          <div className="flex flex-col gap-1.5 pt-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-fg-dim">{t("Version")}</span>
              <span className="font-mono text-fg">{aboutVersion || "…"}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-fg-dim">{t("Maker")}</span>
              <span className="font-mono text-fg">sl4de</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-fg-dim">{t("License")}</span>
              <span className="font-mono text-fg">GPLv3</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-fg-dim">GitHub</span>
              <button
                type="button"
                onClick={() => void bridge.openExternal(ABOUT_REPO_URL)}
                className="font-mono text-accent transition-colors duration-100 hover:underline"
              >
                sl4de0day/wide
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => settings.reset()}
          className="mt-6 rounded-md border border-line px-3 py-1.5 text-[12px] text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          {t("Reset to defaults")}
        </button>
      </div>
    </div>
  );
}
