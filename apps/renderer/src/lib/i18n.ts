import { useCallback } from "react";
import { create } from "zustand";

import { useSettings } from "@/stores/settings";

export type Language = "en" | "tr" | "es" | "de" | "fr" | "it" | "ja" | "ko";

export const LANGUAGES: readonly { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "tr", label: "Türkçe" },
  { id: "es", label: "Español" },
  { id: "de", label: "Deutsch" },
  { id: "fr", label: "Français" },
  { id: "it", label: "Italiano" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
];

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.id === value);
}

export type Values = Record<string, string | number>;

type Dictionary = Record<string, string>;

const LOADERS: Partial<Record<Language, () => Promise<Dictionary>>> = {
  tr: () => import("./i18n.tr").then((m) => m.TR),
  es: () => import("./i18n.es").then((m) => m.ES),
  de: () => import("./i18n.de").then((m) => m.DE),
  fr: () => import("./i18n.fr").then((m) => m.FR),
  it: () => import("./i18n.it").then((m) => m.IT),
  ja: () => import("./i18n.ja").then((m) => m.JA),
  ko: () => import("./i18n.ko").then((m) => m.KO),
};

const useI18nReady = create<{ v: number }>(() => ({ v: 0 }));
const dictionaries: Partial<Record<Language, Dictionary>> = {};
const loading = new Set<Language>();

async function loadDictionary(language: Language): Promise<void> {
  const load = LOADERS[language];
  if (!load || dictionaries[language] || loading.has(language)) return;
  loading.add(language);
  try {
    dictionaries[language] = await load();
    useI18nReady.setState((state) => ({ v: state.v + 1 }));
  } catch {
    void 0;
  } finally {
    loading.delete(language);
  }
}

function fill(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

export function translate(language: Language, text: string, values?: Values): string {
  const dictionary = dictionaries[language];
  const found = dictionary && Object.prototype.hasOwnProperty.call(dictionary, text) ? dictionary[text] : undefined;
  return fill(typeof found === "string" ? found : text, values);
}

export function t(text: string, values?: Values): string {
  return translate(useSettings.getState().language, text, values);
}

export function useT(): (text: string, values?: Values) => string {
  const language = useSettings((state) => state.language);
  const ready = useI18nReady((state) => state.v);
  return useCallback((text: string, values?: Values) => translate(language, text, values), [language, ready]);
}

export function applyLanguage(): void {
  const language = useSettings.getState().language;
  document.documentElement.lang = language;
  void loadDictionary(language);
}

export async function ensureLanguageLoaded(): Promise<void> {
  const language = useSettings.getState().language;
  document.documentElement.lang = language;
  await loadDictionary(language);
}
