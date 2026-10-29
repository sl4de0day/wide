import { create } from "zustand";

import { bridge } from "@/lib/bridge";
import { applyLanguage, isLanguage, type Language } from "@/lib/i18n";
import { BASE_THEME, isTheme, type ThemeId } from "@/lib/themes";

const STORAGE_KEY = "wide.settings";

const LEGACY_STORAGE_KEY = "handcuffs.settings";

export function hasStoredLanguage(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return typeof parsed?.language === "string";
  } catch {
    return false;
  }
}

export interface Settings {

  language: Language;

  theme: ThemeId;
  followSystemTheme: boolean;
  fontSize: number;
  tabSize: number;
  useTabs: boolean;
  lineWrapping: boolean;
  typewriter: boolean;
  colorfulSyntax: boolean;

  formatOnSave: boolean;

  focusLayer: boolean;

  aiGhostText: boolean;

  streamerMode: boolean;
  securityLint: boolean;

  updateManifestUrl: string;
  terminalShell: "default" | "cmd" | "powershell" | "pwsh" | "gitbash" | "wsl";

  autoOpenDevServer: boolean;
}

export const DEFAULTS: Settings = {
  language: "en",
  theme: "default",
  followSystemTheme: false,
  fontSize: 13,
  tabSize: 2,
  useTabs: false,
  lineWrapping: false,
  typewriter: true,
  colorfulSyntax: true,
  formatOnSave: false,
  focusLayer: false,
  aiGhostText: false,
  streamerMode: false,
  securityLint: true,
  updateManifestUrl: "",
  terminalShell: "default",
  autoOpenDevServer: true,
};

interface SettingsState extends Settings {
  set(patch: Partial<Settings>): void;
  reset(): void;
}

function valuesOf(state: SettingsState): Settings {
  const { set: _set, reset: _reset, ...values } = state;
  return values;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistToDisk(values: Settings): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void bridge.saveSettings(values as unknown as Record<string, unknown>).catch(() => undefined);
  }, 250);
}

let hydrated = false;

export async function hydrateSettingsFromDisk(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const reply = await bridge.loadSettings();
    const disk = reply.ok ? reply.settings : null;
    if (disk && typeof disk === "object") {
      const patch = { ...(disk as Partial<Settings>) };
      if (!isLanguage(patch.language)) delete patch.language;
      if (patch.theme && !isTheme(patch.theme)) delete patch.theme;
      useSettings.getState().set(patch);
    }
  } catch {

  }
}

function load(): Settings {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
    if (!raw) return { ...DEFAULTS };
    const stored = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };

    if (!isLanguage(stored.language)) stored.language = DEFAULTS.language;

    if (!isTheme(stored.theme)) stored.theme = DEFAULTS.theme;
    return stored;
  } catch {
    return { ...DEFAULTS };
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),

  set: (patch) => {
    const next = { ...get(), ...patch };
    set(patch);
    const values = valuesOf(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch {

    }
    persistToDisk(values);
    applySyntaxPalette();
    applyLanguage();
    applyTheme();
  },

  reset: () => {
    set({ ...DEFAULTS });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {

    }
    persistToDisk({ ...DEFAULTS });
    applySyntaxPalette();
    applyLanguage();
    applyTheme();
  },
}));

export function applyTheme(): void {
  const { theme, followSystemTheme } = useSettings.getState();
  let activeTheme = theme;
  if (followSystemTheme && typeof window !== "undefined") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    activeTheme = isDark ? (theme || "default") : BASE_THEME;
  }
  if (activeTheme === BASE_THEME) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = activeTheme;
}

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (useSettings.getState().followSystemTheme) {
      applyTheme();
    }
  });
}

export function applySyntaxPalette(): void {
  const { colorfulSyntax } = useSettings.getState();
  if (colorfulSyntax) delete document.documentElement.dataset.syntax;
  else document.documentElement.dataset.syntax = "mono";
}
