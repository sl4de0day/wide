import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BASE_THEME, THEMES, isTheme } from "@/lib/themes";

const CSS = readFileSync(fileURLToPath(new URL("../../styles/index.css", import.meta.url)), "utf8");

const PALETTE_TOKEN =
  /^--(canvas|chrome|panel|raised|hover|selected|active|line|line-strong|fg|fg-bright|fg-muted|fg-dim|fg-faint|status-[a-z]+|syn-[a-z]+|term-[a-z-]+|mono-\d+)$/;

function blockFor(selector: RegExp): string | null {
  const match = selector.exec(CSS);
  return match ? match[1] : null;
}

function tokensIn(block: string): Set<string> {
  const found = new Set<string>();
  const declaration = /^\s*(--[a-z0-9-]+)\s*:/gim;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(block))) found.add(match[1]);
  return found;
}

const baseBlock = blockFor(/:root,\s*\[data-theme="default"\]\s*\{([\s\S]*?)\n\}/);
const baseTokens = new Set(
  [...tokensIn(baseBlock ?? "")].filter((token) => PALETTE_TOKEN.test(token)),
);

describe("theme catalogue", () => {
  it("recognises exactly the themes it lists", () => {
    for (const theme of THEMES) expect(isTheme(theme.id)).toBe(true);
    expect(isTheme("no-such-theme")).toBe(false);
  });

  it("gives every theme a label and a hint", () => {
    for (const theme of THEMES) {
      expect(theme.label.trim().length).toBeGreaterThan(0);
      expect(theme.hint.trim().length).toBeGreaterThan(0);
    }
  });

  it("shares the default palette with elements marked as the default theme", () => {
    expect(baseBlock).not.toBeNull();
    expect(baseTokens.size).toBeGreaterThan(30);
  });

  it("gives every non-default theme the whole palette", () => {
    for (const theme of THEMES) {
      if (theme.id === BASE_THEME) continue;
      const block = blockFor(new RegExp(`\\[data-theme="${theme.id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
      expect(block, `${theme.id} has no [data-theme] block in index.css`).not.toBeNull();
      const defined = tokensIn(block ?? "");
      const missing = [...baseTokens].filter((token) => !defined.has(token)).sort();
      expect(missing, `${theme.id} is missing palette tokens`).toEqual([]);
    }
  });
});
