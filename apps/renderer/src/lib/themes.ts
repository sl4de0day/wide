

export type ThemeId = "default";

export interface ThemeDef {
  id: ThemeId;

  label: string;

  hint: string;
}

export const THEMES: readonly ThemeDef[] = [
  { id: "default", label: "Default", hint: "Dark, low contrast, Nord blue-grey palette." },
];

export const BASE_THEME: ThemeId = "default";

export function isTheme(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

const TERMINAL_TOKENS = {
  background: "--canvas",
  foreground: "--fg-muted",
  cursor: "--fg-bright",
  selectionBackground: "--mono-650",
  black: "--term-black",
  red: "--term-red",
  green: "--term-green",
  yellow: "--term-yellow",
  blue: "--term-blue",
  magenta: "--term-magenta",
  cyan: "--term-cyan",
  white: "--term-white",
  brightBlack: "--term-bright-black",
  brightRed: "--term-bright-red",
  brightGreen: "--term-bright-green",
  brightYellow: "--term-bright-yellow",
  brightBlue: "--term-bright-blue",
  brightMagenta: "--term-bright-magenta",
  brightCyan: "--term-bright-cyan",
  brightWhite: "--term-bright-white",
} as const;

export type TerminalTheme = Record<keyof typeof TERMINAL_TOKENS, string>;

export function terminalFontFamily(): string {
  const resolved = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-terminal")
    .trim();
  return resolved || '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';
}

export function terminalTheme(): TerminalTheme {
  const styles = getComputedStyle(document.documentElement);
  const out = {} as TerminalTheme;
  for (const [key, token] of Object.entries(TERMINAL_TOKENS)) {

    const value = styles.getPropertyValue(token).trim();
    out[key as keyof TerminalTheme] = value || (key === "background" ? "#000000" : "#ffffff");
  }
  return out;
}
