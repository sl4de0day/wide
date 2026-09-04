import { create } from "zustand";

export interface Command {
  id: string;

  title: string;

  group?: string;

  key?: string;
  run(): void;

  when?(): boolean;
}

interface CommandPaletteState {
  open: boolean;
  commands: Command[];
  active: number;

  bindings: Record<string, string>;

  register(commands: Command[]): void;
  setBindings(bindings: Record<string, string>): void;

  runById(id: string): boolean;
  openPalette(): void;
  close(): void;
  setActive(index: number): void;
  move(delta: number, length: number): void;
}

export function comboOf(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  if (!["control", "meta", "alt", "shift"].includes(key)) parts.push(key);
  return parts.join("+");
}

export function normaliseCombo(combo: string): string {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const mods: string[] = [];
  let key = "";
  for (const part of parts) {
    if (part === "ctrl" || part === "cmd" || part === "control" || part === "meta") {
      if (!mods.includes("ctrl")) mods.push("ctrl");
    } else if (part === "alt" || part === "option") {
      if (!mods.includes("alt")) mods.push("alt");
    } else if (part === "shift") {
      if (!mods.includes("shift")) mods.push("shift");
    } else {
      key = part;
    }
  }
  const order = ["ctrl", "alt", "shift"].filter((mod) => mods.includes(mod));
  return [...order, key].filter(Boolean).join("+");
}

export function formatCombo(combo: string): string {
  return combo
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (p === "ctrl") return "Ctrl";
      if (p === "alt") return "Alt";
      if (p === "shift") return "Shift";
      if (p === "tab") return "Tab";
      if (p === ",") return ",";
      return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join("+");
}

export function shortcutFor(command: Command, bindings: Record<string, string>): string | null {
  for (const [combo, id] of Object.entries(bindings)) if (id === command.id) return combo;
  return command.key ?? null;
}

export const useCommandPalette = create<CommandPaletteState>((set, get) => ({
  open: false,
  commands: [],
  active: 0,
  bindings: {},

  register: (commands) =>
    set((state) => {
      const byId = new Map(state.commands.map((command) => [command.id, command]));
      for (const command of commands) byId.set(command.id, command);
      return { commands: [...byId.values()] };
    }),

  setBindings: (bindings) => {
    const normalised: Record<string, string> = {};
    for (const [combo, id] of Object.entries(bindings)) {
      if (typeof id === "string") normalised[normaliseCombo(combo)] = id;
    }
    set({ bindings: normalised });
  },

  runById: (id) => {
    const command = get().commands.find((entry) => entry.id === id);
    if (!command || (command.when && !command.when())) return false;
    command.run();
    return true;
  },

  openPalette: () => set({ open: true, active: 0 }),
  close: () => set({ open: false }),
  setActive: (index) => set({ active: index }),
  move: (delta, length) => {
    if (length === 0) return;
    set((state) => ({ active: (state.active + delta + length) % length }));
  },
}));
