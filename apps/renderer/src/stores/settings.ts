import { create } from "zustand";

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
  fontSize: number;
  tabSize: number;
  useTabs: boolean;
  lineWrapping: boolean;
  typewriter: boolean;
  colorfulSyntax: boolean;

  formatOnSave: boolean;

  focusLayer: boolean;

  aiGhostText: boolean;

  securityLint: boolean;

  updateManifestUrl: string;
  terminalShell: "default" | "cmd" | "powershell" | "pwsh" | "gitbash" | "wsl";
}

export const DEFAULTS: Settings = {
  language: "en",
  theme: "default",
  fontSize: 13,
  tabSize: 2,
  useTabs: false,
  lineWrapping: false,
  typewriter: true,
  colorfulSyntax: true,
  formatOnSave: false,
  focusLayer: false,
  aiGhostText: false,
  securityLint: true,
  updateManifestUrl: "",
  terminalShell: "default",
};

interface SettingsState extends Settings {
  set(patch: Partial<Settings>): void;
  reset(): void;
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
    try {
      const { set: _set, reset: _reset, ...values } = next;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch {

    }
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
    applySyntaxPalette();
    applyLanguage();
    applyTheme();
  },
}));

export function applyTheme(): void {
  const { theme } = useSettings.getState();
  if (theme === BASE_THEME) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function applySyntaxPalette(): void {
  const { colorfulSyntax } = useSettings.getState();
  if (colorfulSyntax) delete document.documentElement.dataset.syntax;
  else document.documentElement.dataset.syntax = "mono";
}
