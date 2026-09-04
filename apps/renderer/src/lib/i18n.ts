import { useCallback } from "react";
import { create } from "zustand";

import { useSettings } from "@/stores/settings";

export type Language = "en" | "tr";

export const LANGUAGES: readonly { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "tr", label: "Türkçe" },
];

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "tr";
}

export type Values = Record<string, string | number>;

const useI18nReady = create<{ v: number }>(() => ({ v: 0 }));
let trDict: Record<string, string> | null = null;
let trLoading = false;
function loadTr(): void {
  if (trDict || trLoading) return;
  trLoading = true;
  void import("./i18n.tr").then((m) => {
    trDict = m.TR;
    useI18nReady.setState((s) => ({ v: s.v + 1 }));
  });
}

function fill(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

export function translate(language: Language, text: string, values?: Values): string {
  const dict = language === "tr" ? trDict : null;
  return fill(dict?.[text] ?? text, values);
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
  if (language === "tr") loadTr();
}

export async function ensureLanguageLoaded(): Promise<void> {
  const language = useSettings.getState().language;
  document.documentElement.lang = language;
  if (language !== "tr" || trDict) return;
  trLoading = true;
  try {
    const m = await import("./i18n.tr");
    trDict = m.TR;
    useI18nReady.setState((s) => ({ v: s.v + 1 }));
  } catch {
    void 0;
  }
}
