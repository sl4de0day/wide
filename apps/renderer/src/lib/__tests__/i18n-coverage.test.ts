import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DE } from "@/lib/i18n.de";
import { ES } from "@/lib/i18n.es";
import { FR } from "@/lib/i18n.fr";
import { IT } from "@/lib/i18n.it";
import { JA } from "@/lib/i18n.ja";
import { KO } from "@/lib/i18n.ko";
import { TR } from "@/lib/i18n.tr";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const I18N_MODULE = readFileSync(fileURLToPath(new URL("../i18n.ts", import.meta.url)), "utf8");

const REFERENCE = TR;
const DICTIONARIES: { code: string; dict: Record<string, string> }[] = [
  { code: "tr", dict: TR },
  { code: "es", dict: ES },
  { code: "de", dict: DE },
  { code: "fr", dict: FR },
  { code: "it", dict: IT },
  { code: "ja", dict: JA },
  { code: "ko", dict: KO },
];

const SKIP = /(i18n\.[a-z]{2}\.ts|[\\/]i18n\.ts|__tests__|[\\/]inspect[\\/]rules\.ts|[\\/]inspect[\\/]taint\.ts)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !SKIP.test(full)) out.push(full);
  }
  return out;
}

function keysPassedToT(): string[] {
  const keys = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    const double = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;
    const single = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;
    let match: RegExpExecArray | null;
    while ((match = double.exec(text))) keys.add(match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"));
    while ((match = single.exec(text))) keys.add(match[1].replace(/\\'/g, "'"));
  }
  return [...keys].filter((key) => key.trim().length > 0);
}

const placeholders = (text: string): string =>
  (text.match(/\{\w+\}/g) ?? []).slice().sort().join("|");

const breaks = (text: string): number => (text.match(/\n/g) ?? []).length;

describe("translation dictionaries", () => {
  it("ships one dictionary for every non-English language the app offers", () => {
    const declared = [...I18N_MODULE.matchAll(/\{\s*id:\s*"([a-z]{2})"/g)].map((m) => m[1]);
    expect(declared[0]).toBe("en");
    expect(declared.slice(1).sort()).toEqual(DICTIONARIES.map((d) => d.code).sort());
    for (const { code } of DICTIONARIES) {
      expect(I18N_MODULE, `i18n.ts has no loader for ${code}`).toContain(`import("./i18n.${code}")`);
    }
  });

  it("derives isLanguage from the language list instead of hard-coding it", () => {
    expect(I18N_MODULE).toMatch(/isLanguage[\s\S]{0,120}LANGUAGES\.some/);
  });

  it.each(DICTIONARIES)("$code translates every literal passed to t()", ({ dict }) => {
    const missing = keysPassedToT()
      .filter((key) => !(key in dict))
      .sort();
    expect(missing).toEqual([]);
  });

  it.each(DICTIONARIES)("$code has exactly the reference key set", ({ code, dict }) => {
    if (code === "tr") return;
    const reference = Object.keys(REFERENCE);
    const missing = reference.filter((key) => !(key in dict)).sort();
    const extra = Object.keys(dict).filter((key) => !(key in REFERENCE)).sort();
    expect(missing, `${code} is missing keys`).toEqual([]);
    expect(extra, `${code} has keys the reference does not`).toEqual([]);
  });

  it.each(DICTIONARIES)("$code keeps every placeholder the key declares", ({ dict }) => {
    const broken = Object.entries(dict)
      .filter(([key, value]) => placeholders(key) !== placeholders(value))
      .map(([key]) => key)
      .sort();
    expect(broken).toEqual([]);
  });

  it.each(DICTIONARIES)("$code keeps the paragraph structure of the key", ({ dict }) => {
    const broken = Object.entries(dict)
      .filter(([key, value]) => breaks(key) !== breaks(value))
      .map(([key]) => key)
      .sort();
    expect(broken).toEqual([]);
  });

  it.each(DICTIONARIES)("$code never leaves a translation empty", ({ dict }) => {
    const empty = Object.entries(dict)
      .filter(([, value]) => value.trim().length === 0)
      .map(([key]) => key)
      .sort();
    expect(empty).toEqual([]);
  });
});
