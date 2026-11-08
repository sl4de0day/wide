import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  ExternalLink,
  HardDrive,
  Loader2,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge, type AiModelFile, type OpenCodeModel } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAi } from "@/stores/ai";

const formatBytes = (bytes: number): string => {
  if (!bytes) return "0 MB";
  const gigabytes = bytes / (1024 * 1024 * 1024);
  if (gigabytes >= 1) return `${gigabytes.toFixed(gigabytes >= 10 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
};

export function cleanModelName(raw: string): string {
  if (!raw) return "";
  let name = raw.trim();
  name = name.replace(/^(?:https?:\/\/)?(?:[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\/)+/, "");
  if (name.includes("/")) {
    name = name.split("/").pop() ?? name;
  }
  name = name.replace(/:latest$/i, "");
  if (name.includes(":")) {
    const colonIndex = name.lastIndexOf(":");
    const base = name.slice(0, colonIndex);
    const tag = name.slice(colonIndex + 1);
    if (
      /\.gguf$/i.test(tag) ||
      /^q\d/i.test(tag) ||
      /^f\d/i.test(tag) ||
      /-gguf$/i.test(base) ||
      tag.toLowerCase().includes(base.toLowerCase().replace(/[-_]gguf$/i, ""))
    ) {
      name = base;
    }
  }
  name = name.replace(/[-_.](?:gguf)$/i, "");
  return name;
}

const CLOUD_MODEL_NAMES: Record<string, string> = {
  "gemini-3.7-flash": "Gemini 3.7 Flash",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash Lite",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-1.5-pro": "Gemini 1.5 Pro",
  "gemini-1.5-flash": "Gemini 1.5 Flash",

  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-chat": "DeepSeek Chat",
  "deepseek-reasoner": "DeepSeek Reasoner",
  "deepseek-coder": "DeepSeek Coder",

  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "claude-opus-4-5": "Claude Opus 4.5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "claude-3-7-sonnet": "Claude 3.7 Sonnet",
  "claude-3-5-sonnet": "Claude 3.5 Sonnet",
  "claude-3-5-haiku": "Claude 3.5 Haiku",
  "claude-code": "Claude Code",
};

export function formatCloudModelName(raw: string, provider?: string): string {
  if (!raw) {
    if (provider === "gemini") return "Gemini";
    if (provider === "deepseek") return "DeepSeek";
    if (provider === "claude") return "Claude API";
    if (provider === "claude-code") return "Claude Code";
    if (provider === "opencode") return "OpenCode";
    return provider || "";
  }
  const clean = raw.trim();
  if (CLOUD_MODEL_NAMES[clean]) return CLOUD_MODEL_NAMES[clean];

  if (provider === "opencode" || clean.startsWith("opencode/")) {
    const unprefix = clean.replace(/^opencode\//i, "");
    if (CLOUD_MODEL_NAMES[unprefix]) return CLOUD_MODEL_NAMES[unprefix];
    return unprefix
      .replace(/[-_]/g, " ")
      .replace(/(\d+)\s+(\d+)/g, "$1.$2")
      .split(" ")
      .map((w) => (w.toLowerCase() === "vl" ? "VL" : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  }

  return clean
    .replace(/^gemini[-_]/i, "Gemini ")
    .replace(/^deepseek[-_]/i, "DeepSeek ")
    .replace(/^claude[-_]/i, "Claude ")
    .replace(/[-_]/g, " ")
    .replace(/(\d+)\s+(\d+)/g, "$1.$2")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function FileRow({ file }: { file: AiModelFile }) {
  const t = useT();
  const pull = useAi((state) => state.pulls[file.reference]);
  const pulling = pull && pull.status !== "done" && pull.status !== "error";
  const percent = pull?.total ? Math.round((pull.completed / pull.total) * 100) : 0;
  const failed = pull?.status === "error";

  return (
    <div className="flex items-center gap-2 py-1.5 pl-7 pr-2.5">
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
            "w-8 shrink-0 rounded-md py-1 transition-colors duration-150 hover:bg-hover hover:text-fg",
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
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-hover"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg" title={id}>
          {cleanModelName(name)}
        </span>
      </button>
      {expanded && (
        <div className="wide-enter-fade pb-1.5">
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
  const ollamaStatusText = useAi((state) => state.ollamaStatusText);
  const ollamaError = useAi((state) => state.ollamaError);
  const config = useAi((state) => state.config);

  useEffect(() => {
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
      {!ollama.running && !ollama.installed && (
        <div className="border-b border-line bg-panel/30 px-3 py-3">
          <p className="text-[11px] leading-snug text-fg-dim">
            {t("Local models run through Ollama, which is not on this machine yet.")}
          </p>

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void useAi.getState().setupOllama()}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-medium shadow-xs transition-all duration-150",
                busy
                  ? "cursor-wait border-accent/40 bg-accent/15 text-accent"
                  : "border-accent bg-accent/10 text-accent hover:bg-accent hover:text-bg",
                "disabled:opacity-70",
              )}
            >
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin text-accent" />
                  <span>{t("Installing Ollama…")}</span>
                </>
              ) : (
                <>
                  <Download className="size-3" />
                  <span>{t("Install Ollama")}</span>
                </>
              )}
            </button>

            {!busy && (
              <button
                type="button"
                onClick={() => void bridge.openExternal("https://ollama.com/download")}
                title={t("Visit Ollama official website")}
                className="inline-flex items-center gap-1 px-1 py-1 text-[11px] text-fg-faint transition-colors hover:text-fg hover:underline"
              >
                <span>ollama.com</span>
                <ExternalLink className="size-2.5" />
              </button>
            )}
          </div>

          {busy && (
            <div className="mt-2.5 rounded-md border border-accent/20 bg-accent/5 p-2 text-[11px] text-fg-dim">
              <div className="flex items-center gap-2">
                <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
                <span className="font-medium text-accent">
                  {ollamaStatusText || t("Downloading and installing Ollama (this may take a few minutes)…")}
                </span>
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-accent/15">
                <div className="h-full w-2/5 animate-[pulse_1.5s_ease-in-out_infinite] rounded-full bg-accent" />
              </div>
              <p className="mt-1.5 text-[10px] text-fg-faint">
                {t("Please do not close Wide while setup is in progress.")}
              </p>
            </div>
          )}

          {ollamaError && (
            <div className="mt-2.5 rounded-md border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px]">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-rose-300">
                    {t("Ollama installation / start error")}
                  </div>
                  <p className="mt-0.5 break-words leading-tight text-rose-300/80">
                    {ollamaError}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void useAi.getState().setupOllama()}
                      className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2.5 py-1 text-[10px] font-medium text-rose-200 transition-colors hover:bg-rose-500/30"
                    >
                      <RotateCw className="size-3" />
                      <span>{t("Retry")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void bridge.openExternal("https://ollama.com/download")}
                      className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2.5 py-1 text-[10px] font-medium text-rose-200 transition-colors hover:bg-rose-500/30"
                    >
                      <ExternalLink className="size-3" />
                      <span>{t("Download Manually (ollama.com)")}</span>
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  title={t("Dismiss")}
                  onClick={() => useAi.getState().clearOllamaError()}
                  className="rounded p-0.5 text-rose-400/60 transition-colors hover:bg-rose-500/20 hover:text-rose-400"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {installed.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
            {t("On this machine")}
          </p>
          {installed.map((model) => {
            const active = config?.tab === "local" && config?.localModel === model.name;
            const displayName = cleanModelName(model.name);
            return (
              <button
                key={model.name}
                type="button"
                onClick={() => void useAi.getState().setConfig({ tab: "local", localModel: model.name })}
                className={cn(
                  "flex w-full items-center justify-between border-b border-line px-3 py-2 text-left transition-colors duration-150",
                  active ? "bg-selected" : "hover:bg-hover",
                )}
              >
                <div className="min-w-0 flex-1 truncate pr-2">
                  <div className="truncate text-[12px] font-medium text-fg" title={model.name}>
                    {displayName}
                  </div>
                  <div className="truncate text-[10px] text-fg-faint">
                    {[model.parameters, model.quantization].filter(Boolean).join(" · ") || t("Local LLM")}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-fg-faint">{formatBytes(model.size)}</span>
              </button>
            );
          })}
        </>
      )}

      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5">
          <Search className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.5} />
          <input
            value={query}
            onChange={(event) => useAi.getState().setQuery(event.target.value)}
            placeholder={t("Search for a model")}
            aria-label={t("Search for a model")}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint"
          />
        </div>
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
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
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
            <p className="px-3 py-3 text-[12px] text-fg-faint">{t("Nothing matched that.")}</p>
          )}
        </>
      ) : (
        <>
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
            {t("Recommended")}
          </p>
          {recommended.map((entry) =>
            entry.found && entry.id ? (
              <ModelRow key={entry.query} id={entry.id} name={entry.label} source="huggingface" />
            ) : (
              <div key={entry.query} className="border-b border-line px-3 py-2">
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
          "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150",
          selected ? "bg-selected" : "hover:bg-hover",
        )}
      >
        <span
          className={cn("size-2 shrink-0 rounded-full", configured ? "bg-emerald-400" : "bg-fg-faint/40")}
        />
        <span className={cn("min-w-0 flex-1 truncate text-[12px] font-medium", selected ? "text-fg-bright" : "text-fg")}>
          {label}
        </span>
        {configured ? (
          <span className="shrink-0 truncate text-[10.5px] text-fg-faint">
            {formatCloudModelName(config?.cloudModel[id] ?? "", id)}
          </span>
        ) : (
          <span className="shrink-0 text-[10.5px] font-medium text-accent">{t("Set up")}</span>
        )}
      </button>

      {configured && selected && (
        <div className="wide-enter-fade flex items-center gap-1.5 px-3 pb-2">
          <select
            value={config?.cloudModel[id] ?? ""}
            onChange={(event) =>
              void useAi.getState().setConfig({ cloudModel: { [id]: event.target.value } })
            }
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-fg outline-none focus:border-accent"
          >
            {models.map((model) => (
              <option key={model} value={model}>
                {formatCloudModelName(model, id)}
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
            className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[11px] text-fg-faint transition-colors duration-150 hover:bg-hover hover:text-fg"
          >
            {t("Forget")}
          </button>
        </div>
      )}

      {!configured && open && (
        <div className="wide-enter-fade px-3 pb-2.5">
          <p className="pb-1.5 text-[10.5px] leading-snug text-fg-faint">{note}</p>
          <div className="flex items-center gap-1.5">
            <input
              type="password"
              value={key}
              onChange={(event) => remember(event.target.value)}
              placeholder={t("API key")}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
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
                    void useAi.getState().refreshTelemetry();
                  })
              }
              className="shrink-0 rounded-md border border-accent px-2.5 py-1.5 text-[11px] font-medium text-accent transition-colors duration-150 hover:bg-accent hover:text-bg disabled:opacity-40"
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
          "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 disabled:opacity-60",
          selected ? "bg-selected" : "hover:bg-hover",
        )}
      >
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            state.signedIn ? "bg-emerald-400" : state.installed ? "bg-amber-400" : "bg-fg-faint/40",
          )}
        />
        <span className={cn("min-w-0 flex-1 truncate text-[12px] font-medium", selected ? "text-fg-bright" : "text-fg")}>
          Claude Code
        </span>
        <span className="shrink-0 text-[10.5px] font-medium text-accent">
          {busy ? t("Working…") : !state.checked ? t("Checking…") : state.installed ? "" : t("Install")}
        </span>
      </button>

      {state.checked && !state.signedIn && (
        <div className="px-3 pb-2.5">
          <p className="pb-1.5 text-[10.5px] leading-snug text-fg-faint">
            {t("Uses your Claude subscription rather than a key.")}
          </p>
          {state.installed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("login")}
              className="rounded-md border border-line px-2.5 py-1 text-[11px] text-fg-dim transition-colors duration-150 hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              {t("Sign in")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

let openCodeProbeState: {
  checked: boolean;
  installed: boolean;
  broken: boolean;
  version: string;
} | null = null;
let openCodeCachedModels: OpenCodeModel[] = [];

function OpenCodeCard() {
  const t = useT();
  const config = useAi((state) => state.config);
  const selected = config?.tab === "cloud" && config?.provider === "opencode";
  const [probe, setProbe] = useState(
    () => openCodeProbeState ?? { checked: false, installed: false, broken: false, version: "" },
  );
  const [models, setModels] = useState<OpenCodeModel[]>(() => openCodeCachedModels);
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchModels = async (fresh = false) => {
    setLoadingModels(true);
    try {
      const reply = await bridge.aiOpenCodeModels(fresh);
      if (reply.ok && Array.isArray(reply.models)) {
        openCodeCachedModels = reply.models;
        setModels(reply.models);
        const current = useAi.getState().config?.cloudModel?.opencode;
        if (!current && reply.selectedModel) {
          void useAi.getState().setConfig({
            cloudModel: { opencode: reply.selectedModel },
          });
        }
      }
    } finally {
      setLoadingModels(false);
    }
  };

  const check = (fresh = false) => {
    void bridge.aiOpenCodeStatus(fresh).then((reply) => {
      const next = {
        checked: true,
        installed: Boolean(reply.ok && reply.installed),
        broken: Boolean(reply.ok && reply.broken),
        version: reply.ok ? (reply.version ?? "") : "",
      };
      openCodeProbeState = next;
      setProbe(next);
      if (next.installed) {
        void fetchModels(fresh);
      }
    });
  };

  useEffect(() => {
    if (openCodeProbeState) {
      if (openCodeProbeState.installed && openCodeCachedModels.length === 0) {
        void fetchModels();
      }
      return;
    }
    check();
  }, []);

  const install = async () => {
    setBusy(true);
    try {
      await bridge.aiOpenCodeInstall();
      check(true);
    } finally {
      setBusy(false);
    }
  };

  const selectCard = () => {
    if (probe.installed) {
      const current = config?.cloudModel?.opencode;
      const fallback = models[0]?.key || "";
      void useAi.getState().setConfig({
        tab: "cloud",
        provider: "opencode",
        ...(!current && fallback ? { cloudModel: { opencode: fallback } } : {}),
      });
    } else {
      void install();
    }
  };

  const selectedModelKey = config?.cloudModel?.opencode ?? "";

  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={selectCard}
        disabled={busy}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 disabled:opacity-60",
          selected ? "bg-selected" : "hover:bg-hover",
        )}
      >
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            probe.installed ? "bg-emerald-400" : probe.broken ? "bg-amber-400" : "bg-fg-faint/40",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12px] font-medium",
            selected ? "text-fg-bright" : "text-fg",
          )}
        >
          OpenCode
        </span>
        {probe.installed ? (
          <span className="shrink-0 truncate text-[10.5px] text-fg-faint">
            {formatCloudModelName(selectedModelKey || models[0]?.name || "", "opencode")}
          </span>
        ) : (
          <span className="shrink-0 text-[10.5px] font-medium text-accent">
            {busy ? t("Working…") : !probe.checked ? t("Checking…") : t("Install")}
          </span>
        )}
      </button>

      {probe.installed && selected && (
        <div className="wide-enter-fade flex items-center gap-1.5 px-3 pb-2.5">
          <select
            value={selectedModelKey}
            onChange={(event) =>
              void useAi.getState().setConfig({ cloudModel: { opencode: event.target.value } })
            }
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-fg outline-none focus:border-accent"
          >
            {models.length === 0 ? (
              <option value="">{loadingModels ? t("Checking…") : t("No model chosen")}</option>
            ) : (
              models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name || formatCloudModelName(m.key, "opencode")}
                  {m.free ? " (Free)" : ""}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => void fetchModels(true)}
            disabled={loadingModels}
            title={t("Refresh")}
            aria-label={t("Refresh")}
            className="shrink-0 rounded-md border border-line p-1 text-fg-faint transition-colors duration-150 hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <RotateCw className={cn("size-3", loadingModels && "animate-spin")} strokeWidth={1.75} />
          </button>
        </div>
      )}

      {probe.checked && !probe.installed && (
        <div className="px-3 pb-2.5">
          <p className="pb-1.5 text-[10.5px] leading-snug text-fg-faint">
            {t("Access free models through the OpenCode CLI.")}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void install()}
            className="rounded-md border border-line px-2.5 py-1 text-[11px] text-fg-dim transition-colors duration-150 hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            {busy ? t("Working…") : t("Install")}
          </button>
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
      <ClaudeCodeCard />
      <OpenCodeCard />
    </>
  );
}

export function useModelLabel(): { label: string; ready: boolean } {
  const t = useT();
  const config = useAi((state) => state.config);
  const keys = useAi((state) => state.keys);

  if (!config) return { label: t("No model chosen"), ready: false };
  if (config.tab === "local") {
    return {
      label: config.localModel ? cleanModelName(config.localModel) : t("No model chosen"),
      ready: Boolean(config.localModel),
    };
  }
  if (config.provider === "claude-code") return { label: "Claude Code", ready: true };
  if (config.provider === "opencode") {
    const chosen = config.cloudModel?.opencode ?? "";
    return {
      label: formatCloudModelName(chosen, "opencode") || "OpenCode",
      ready: true,
    };
  }
  const model = config.cloudModel[config.provider] ?? "";
  const ready = Boolean(keys[config.provider]);
  if (!ready || !model) {
    const providerName =
      { gemini: "Gemini", deepseek: "DeepSeek", claude: "Claude API" }[config.provider] ??
      config.provider;
    return { label: providerName, ready };
  }
  return {
    label: formatCloudModelName(model, config.provider),
    ready: true,
  };
}

export function ModelPicker({ className }: { className?: string } = {}) {
  const t = useT();
  const { label, ready } = useModelLabel();
  const [open, setOpen] = useState(false);
  const [half, setHalf] = useState<"cloud" | "local">(
    () => useAi.getState().config?.tab ?? "cloud",
  );
  const error = useAi((state) => state.error);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void useAi.getState().load();
  }, []);

  useEffect(() => {
    if (!open) return;
    void useAi.getState().load();
    void useAi.getState().refreshLocal();
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
          "flex max-w-[320px] items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium transition-colors duration-150",
          className
            ? className
            : open
              ? "border border-accent bg-hover text-fg"
              : "border border-line text-fg-dim hover:bg-hover hover:text-fg",
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-emerald-400" : "bg-fg-faint/40")} />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-180")} strokeWidth={2} />
      </button>

      {open && (
        <div className="wide-pop-up absolute bottom-full left-0 z-30 mb-2 flex max-h-[500px] w-[360px] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
          <div className="flex shrink-0 border-b border-line bg-raised/40">
            {(["cloud", "local"] as const).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setHalf(name)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 py-2 text-[11.5px] font-medium transition-colors duration-150",
                  half === name
                    ? "border-b-2 border-accent text-fg-bright"
                    : "text-fg-dim hover:bg-hover hover:text-fg",
                )}
              >
                {name === "cloud" ? (
                  <Cloud className="size-3.5" strokeWidth={1.75} />
                ) : (
                  <HardDrive className="size-3.5" strokeWidth={1.75} />
                )}
                {name === "cloud" ? t("Cloud") : t("Local")}
              </button>
            ))}
          </div>

          {error && (
            <button
              type="button"
              onClick={() => useAi.setState({ error: "" })}
              className="shrink-0 border-b border-line px-3 py-2 text-left text-[11px] text-status-error"
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
