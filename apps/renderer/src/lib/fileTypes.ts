import { CATALOGUE } from "./marketplace";

export interface FileType {

  extension: string;

  language: string;

  colour: string;

  path: string;
}

export const FILE_TYPES: readonly FileType[] = CATALOGUE.flatMap((extension) =>
  extension.fileExtensions.map((suffix) => ({
    extension: suffix,
    language: extension.name,
    colour: extension.colour,
    path: extension.path,
  })),
).sort((a, b) =>

  a.language === b.language
    ? a.extension.localeCompare(b.extension)
    : a.language.localeCompare(b.language),
);

export const DEFAULT_FILE_TYPE =
  FILE_TYPES.find((type) => type.extension === "ts") ?? FILE_TYPES[0];

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function nameProblem(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/[\\/:*?"<>|]/.test(trimmed)) return 'A file name cannot contain \\ / : * ? " < > or |';
  if (RESERVED.test(trimmed)) return "That name is reserved by Windows.";
  if (trimmed.endsWith(".") || trimmed.endsWith(" ")) {
    return "A file name cannot end with a dot or a space.";
  }
  return "";
}
