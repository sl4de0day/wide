import { ChevronDown, ChevronRight, Cloud, Download, HardDrive, RotateCw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge, type AiModelFile } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAi } from "@/stores/ai";

const formatBytes = (bytes: number): string => {
  if (!bytes) return "";
  const gigabytes = bytes / 1e9;
  if (gigabytes >= 1) return `${gigabytes.toFixed(gigabytes >= 10 ? 0 : 1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
};

const FIT_TONE: Record<string, string> = {
  gpu: "bg-emerald-400",
  cpu: "bg-amber-400",
  no: "bg-status-error",
};

function FitDot({ fit }: { fit?: AiModelFile["fit"] }) {
  const t = useT();
  if (!fit || fit === "unknown") return null;
  const label =
    fit === "gpu"
      ? t("Runs on the graphics card")
      : fit === "cpu"
        ? t("Runs in memory, slowly")
        : t("Too large for this machine");
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", FIT_TONE[fit])}
      title={label}
      aria-label={label}
    />
  );
}

function FileRow({ file }: { file: AiModelFile }) {
  const t = useT();
  const pull = useAi((state) => state.pulls[file.reference]);
  const pulling = pull && pull.status !== "done" && pull.status !== "error";
  const percent = pull?.total ? Math.round((pull.completed / pull.total) * 100) : 0;
  const failed = pull?.status === "error";

  return (
    <div className="flex items-center gap-2 py-1 pl-7 pr-2">
      <FitDot fit={file.fit} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-dim" title={file.path}>
        {file.quant || file.path}
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-fg-faint">{formatBytes(file.size)}</span>
      {pulling ? (
        <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-accent">
          {pull.total ? `${percent}%` : "…"}
        </span>
      ) : (

        <button
          type="button"
          onClick={() => void useAi.getState().pull(file.reference)}
          title={failed ? `${pull.error || t("Failed")} · ${t("Try again")}` : t("Download and install this model")}
          aria-label={failed ? t("Try again") : t("Download and install this model")}
          className={cn(
            "w-10 shrink-0 rounded-sm py-0.5 transition-colors duration-100 hover:bg-hover hover:text-fg",
            failed ? "text-status-error" : "text-fg-faint",
          )}
        >
          {failed ? (
            <RotateCw className="mx-auto size-3" strokeWidth={2} />
          ) : (
            <Download className="mx-auto size-3" strokeWidth={1.75} />
          )}
        </button>
      )}
    </div>
  );
}

function ModelRow({ id, name, source }: { id: string; name: string; source: string }) {
  const expanded = useAi((state) => state.expanded === id);
  const files = useAi((state) => state.files[id]);
  const t = useT();

  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => void useAi.getState().expand(id, source)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg" title={id}>
          {name}
        </span>
      </button>
      {expanded && (
        <div className="wide-enter-fade pb-1">
          {!files ? (
            <p className="py-1 pl-7 text-[11px] text-fg-faint">{t("Reading the file list…")}</p>
          ) : files.length === 0 ? (
            <p className="py-1 pl-7 text-[11px] text-fg-faint">{t("No GGUF files in this one.")}</p>
          ) : (
            files.map((file) => <FileRow key={file.reference} file={file} />)
          )}
        </div>
      )}
    </div>
  );
}

function LocalHalf() {
  const t = useT();
  const query = useAi((state) => state.query);
  const results = useAi((state) => state.results);
  const searching = useAi((state) => state.searching);
  const recommended = useAi((state) => state.recommended);
  const installed = useAi((state) => state.installed);
  const ollama = useAi((state) => state.ollama);
  const hardware = useAi((state) => state.hardware);
  const busy = useAi((state) => state.busy);
  const config = useAi((state) => state.config);

  useEffect(() => {
    if (useAi.getState().hardware) return;
    void useAi.getState().refreshLocal();
  }, []);

  const asked = useRef("");
  useEffect(() => {
    const wanted = query.trim();
    if (wanted.length < 2 || asked.current === wanted) return;
    const timer = setTimeout(() => {
      asked.current = wanted;
      void useAi.getState().search();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <>
      {!ollama.running && (
        <div className="border-b border-line px-2 py-2.5">
          <p className="text-[11px] leading-snug text-fg-dim">
            {ollama.installed
              ? t("Ollama is installed but not running.")
              : t("Local models run through Ollama, which is not on this machine yet.")}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void useAi.getState().setupOllama()}
            className="mt-1.5 rounded-md border border-accent px-2.5 py-1 text-[11px] text-accent transition-colors duration-100 hover:bg-accent hover:text-bg disabled:opacity-40"
          >
            {busy ? t("Working…") : ollama.installed ? t("Start Ollama") : t("Install Ollama")}
          </button>
        </div>
      )}

      {installed.length > 0 && (
        <>
          <p className="px-2 pb-1 pt-2.5 text-[10px] uppercase tracking-wide text-fg-faint">
            {t("On this machine")}
          </p>
          {installed.map((model) => (
            <button
              key={model.name}
              type="button"

              onClick={() => void useAi.getState().setConfig({ tab: "local", localModel: model.name })}
              className={cn(
                "flex w-full items-center gap-2 border-b border-line px-2 py-1.5 text-left transition-colors duration-100",
                config?.tab === "local" && config?.localModel === model.name
                  ? "bg-selected"
                  : "hover:bg-hover",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{model.name}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-fg-faint">
                {formatBytes(model.size)}
              </span>
            </button>
          ))}
        </>
      )}

      <div className="border-b border-line px-2 py-2">
        <div className="flex items-center gap-1 rounded-md border border-line bg-panel px-2">
          <Search className="size-3 shrink-0 text-fg-faint" strokeWidth={1.5} />
          <input
            value={query}
            onChange={(event) => useAi.getState().setQuery(event.target.value)}
            placeholder={t("Search for a model")}
            aria-label={t("Search for a model")}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint"
          />
        </div>
        {
}
        {hardware && (
          <p className="pt-1.5 text-[10px] leading-snug text-fg-faint">
            {t("This machine: {ram}{gpu}. Check a model fits before you download it.", {
              ram: formatBytes(hardware.totalRam),
              gpu: hardware.vram ? ` · ${formatBytes(hardware.vram)} ${t("on the GPU")}` : "",
            })}
          </p>
        )}
      </div>

      {query.trim().length >= 2 ? (
        <>
          <p className="px-2 pb-1 pt-2.5 text-[10px] uppercase tracking-wide text-fg-faint">
            {searching ? t("Searching…") : t("Results")}
          </p>
          {results.map((result) => (
            <ModelRow
              key={`${result.source}:${result.id}`}
              id={result.id}
              name={result.name}
              source={result.source}
            />
          ))}
          {!searching && results.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-fg-faint">{t("Nothing matched that.")}</p>
          )}
        </>
      ) : (
        <>
          <p className="px-2 pb-1 pt-2.5 text-[10px] uppercase tracking-wide text-fg-faint">
            {t("Recommended")}
          </p>
          {recommended.map((entry) =>
            entry.found && entry.id ? (
              <ModelRow key={entry.query} id={entry.id} name={entry.label} source="huggingface" />
            ) : (
              <div key={entry.query} className="border-b border-line px-2 py-1.5">
                <span className="text-[12px] text-fg-faint line-through">{entry.label}</span>
              </div>
            ),
          )}
        </>
      )}
    </>
  );
}

const keyDrafts: Record<string, string> = {};

function ProviderCard({
  id,
  label,
  note,
  models,
}: {
  id: string;
  label: string;
  note: string;
  models: string[];
}) {
  const t = useT();
  const configured = useAi((state) => state.keys[id]);
  const config = useAi((state) => state.config);
  const busy = useAi((state) => state.busy);
  const [key, setKey] = useState(() => keyDrafts[id] ?? "");
  const [open, setOpen] = useState(false);
  const selected = config?.tab === "cloud" && config?.provider === id;

  const remember = (value: string) => {
    keyDrafts[id] = value;
    setKey(value);
  };

  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() =>
          configured
            ? void useAi.getState().setConfig({ tab: "cloud", provider: id })
            : setOpen((was) => !was)
        }
        className={cn(
          "flex w-full items-center gap-2 px-2 py-2 text-left transition-colors duration-100",
          selected ? "bg-selected" : "hover:bg-hover",
        )}
      >
        {}
        <span
          className={cn("size-1.5 shrink-0 rounded-full", configured ? "bg-emerald-400" : "bg-fg-faint/40")}
        />
        <span className={cn("min-w-0 flex-1 truncate text-[12px]", selected ? "text-fg-bright" : "text-fg")}>
          {label}
        </span>
        {configured ? (
          <span className="shrink-0 truncate text-[10px] text-fg-faint">
            {config?.cloudModel[id] ?? ""}
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-accent">{t("Set up")}</span>
        )}
      </button>

      {configured && selected && (
        <div className="wide-enter-fade flex items-center gap-1 px-2 pb-2">
          <select
            value={config?.cloudModel[id] ?? ""}
            onChange={(event) =>
              void useAi.getState().setConfig({ cloudModel: { [id]: event.target.value } })
            }
            className="min-w-0 flex-1 rounded-sm border border-line bg-panel px-1.5 py-1 text-[11px] text-fg outline-none"
          >
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <button
            type="button"

            onClick={() =>
              void bridge
                .aiSetKey(id, "")
                .then(() => bridge.aiKeyStatus())
                .then((status) => useAi.setState({ keys: status.ok ? (status.configured ?? {}) : {} }))
            }
            className="shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            {t("Forget")}
          </button>
        </div>
      )}

      {!configured && open && (
        <div className="wide-enter-fade px-2 pb-2">
          <p className="pb-1.5 text-[10px] leading-snug text-fg-faint">{note}</p>
          <div className="flex items-center gap-1">
            <input
              type="password"
              value={key}
              onChange={(event) => remember(event.target.value)}
              placeholder={t("API key")}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-sm border border-line bg-panel px-2 py-1 text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
            />
            <button
              type="button"
              disabled={!key.trim() || busy}
              onClick={() =>
                void useAi
                  .getState()
                  .setKey(id, key)
                  .then((ok) => {
                    if (!ok) return;
                    remember("");
                    setOpen(false);
                    void useAi.getState().setConfig({ tab: "cloud", provider: id });
                  })
              }
              className="shrink-0 rounded-sm border border-accent px-2 py-1 text-[11px] text-accent transition-colors duration-100 hover:bg-accent hover:text-bg disabled:opacity-40"
            >
              {busy ? t("Checking…") : t("Save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

let claudeProbe: { checked: boolean; installed: boolean; signedIn: boolean } | null = null;

function ClaudeCodeCard() {
  const t = useT();
  const config = useAi((state) => state.config);
  const selected = config?.tab === "cloud" && config?.provider === "claude-code";
  const [state, setState] = useState(
    () => claudeProbe ?? { checked: false, installed: false, signedIn: false },
  );
  const [busy, setBusy] = useState(false);

  const check = () => {
    void bridge.aiClaudeCodeStatus().then((reply) => {
      claudeProbe = {
        checked: true,
        installed: Boolean(reply.ok && reply.installed),
        signedIn: Boolean(reply.ok && reply.signedIn),
      };
      setState(claudeProbe);
    });
  };

  useEffect(() => {
    if (claudeProbe) return;
    check();

  }, []);

  const act = async (what: "install" | "login") => {
    setBusy(true);
    if (what === "install") await bridge.aiClaudeCodeInstall();
    else await bridge.aiClaudeCodeLogin();
    setBusy(false);
    check();
  };

  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() =>
          state.installed
            ? void useAi.getState().setConfig({ tab: "cloud", provider: "claude-code" })
            : void act("install")
        }

        disabled={busy}
        className={cn(
          "flex w-full items-center gap-2 px-2 py-2 text-left transition-colors duration-100 disabled:opacity-60",
          selected ? "bg-selected" : "hover:bg-hover",
        )}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            state.signedIn ? "bg-emerald-400" : state.installed ? "bg-amber-400" : "bg-fg-faint/40",
          )}
        />
        <span className={cn("min-w-0 flex-1 truncate text-[12px]", selected ? "text-fg-bright" : "text-fg")}>
          Claude Code
        </span>
        <span className="shrink-0 text-[10px] text-accent">
          {busy ? t("Working…") : !state.checked ? t("Checking…") : state.installed ? "" : t("Install")}
        </span>
      </button>

      {

}
      {state.checked && !state.signedIn && (
        <div className="px-2 pb-2">
          <p className="pb-1.5 text-[10px] leading-snug text-fg-faint">
            {t("Uses your Claude subscription rather than a key.")}
          </p>
          {state.installed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("login")}
              className="rounded-sm border border-line px-2 py-1 text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              {t("Sign in")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CloudHalf() {
  const t = useT();
  return (
    <>
      <ProviderCard
        id="gemini"
        label="Gemini"
        note={t("The key comes from Google AI Studio.")}
        models={["gemini-3.7-flash", "gemini-3.1-pro-preview", "gemini-3.5-flash-lite"]}
      />
      <ProviderCard
        id="deepseek"
        label="DeepSeek"
        note={t("The key comes from the DeepSeek platform.")}
        models={["deepseek-v4-pro", "deepseek-v4-flash"]}
      />
      <ProviderCard
        id="claude"
        label="Claude API"
        note={t("Pay per token, with a key from the Claude Console.")}
        models={["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]}
      />
      {
}
      <ClaudeCodeCard />
    </>
  );
}

export function useModelLabel(): { label: string; ready: boolean } {
  const t = useT();
  const config = useAi((state) => state.config);
  const keys = useAi((state) => state.keys);

  if (!config) return { label: t("No model chosen"), ready: false };
  if (config.tab === "local") {
    return { label: config.localModel || t("No model chosen"), ready: Boolean(config.localModel) };
  }
  const label =
    { gemini: "Gemini", deepseek: "DeepSeek", claude: "Claude API", "claude-code": "Claude Code" }[
      config.provider
    ] ?? config.provider;
  if (config.provider === "claude-code") return { label, ready: true };
  const model = config.cloudModel[config.provider] ?? "";
  return {
    label: keys[config.provider] && model ? `${label} · ${model}` : label,
    ready: Boolean(keys[config.provider]),
  };
}

export function ModelPicker() {
  const t = useT();
  const { label, ready } = useModelLabel();
  const [open, setOpen] = useState(false);
  const [half, setHalf] = useState<"cloud" | "local">(
    () => useAi.getState().config?.tab ?? "cloud",
  );
  const error = useAi((state) => state.error);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        title={t("Providers and models")}
        className={cn(
          "flex max-w-[240px] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors duration-100",
          open ? "border-accent bg-hover text-fg" : "border-line text-fg-dim hover:bg-hover hover:text-fg",
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-emerald-400" : "bg-fg-faint/40")} />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={2} />
      </button>

      {

}
      {open && (
        <div className="wide-pop-up absolute bottom-full left-0 z-30 mb-1.5 flex max-h-[420px] w-[300px] flex-col overflow-hidden rounded-md border border-line bg-panel shadow-lg">
          <div className="flex shrink-0 border-b border-line">
            {(["cloud", "local"] as const).map((name) => (
              <button
                key={name}
                type="button"

                onClick={() => setHalf(name)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] transition-colors duration-100",
                  half === name
                    ? "border-b border-accent text-fg-bright"
                    : "text-fg-dim hover:bg-hover hover:text-fg",
                )}
              >
                {name === "cloud" ? (
                  <Cloud className="size-3.5" strokeWidth={1.5} />
                ) : (
                  <HardDrive className="size-3.5" strokeWidth={1.5} />
                )}
                {name === "cloud" ? t("Cloud") : t("Local")}
              </button>
            ))}
          </div>

          {
}
          {error && (
            <button
              type="button"
              onClick={() => useAi.setState({ error: "" })}
              className="shrink-0 border-b border-line px-2 py-1.5 text-left text-[11px] text-status-error"
            >
              {t(error)}
            </button>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {half === "cloud" ? <CloudHalf /> : <LocalHalf />}
          </div>
        </div>
      )}
    </div>
  );
}
