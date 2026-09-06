import type { Language } from "@/lib/i18n";

const LOADERS: Partial<Record<Language, () => Promise<Record<string, string>>>> = {
  tr: () => import("./rulesI18n.tr").then((m) => m.TR_RULES),
};

let activeLanguage: Language = "en";
let activeDict: Record<string, string> | null = null;
const loaded = new Set<Language>();
const loading = new Set<Language>();

export function translateRuleText(text: string): string {
  if (!activeDict) return text;
  const hit = activeDict[text];
  return hit && hit.length ? hit : text;
}

export function ruleLanguage(): Language {
  return activeLanguage;
}

export async function loadRuleDictionary(language: Language): Promise<void> {
  activeLanguage = language;
  const loader = LOADERS[language];
  if (!loader) {
    activeDict = null;
    return;
  }
  if (loaded.has(language)) return;
  if (loading.has(language)) return;
  loading.add(language);
  try {
    const dict = await loader();
    loaded.add(language);
    if (activeLanguage === language) activeDict = dict;
  } catch {
    if (activeLanguage === language) activeDict = null;
  } finally {
    loading.delete(language);
  }
}
