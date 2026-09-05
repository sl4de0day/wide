import { describe, expect, it } from "vitest";

import { basename, dirname, extname, formatBytes, normalisePath } from "@/lib/utils";
import { diffCounts, lineDiff } from "@/lib/lineDiff";

describe("path helpers", () => {
  it("turns Windows separators into forward slashes", () => {
    expect(normalisePath("C:\\Users\\sl4de\\a.ts")).toBe("C:/Users/sl4de/a.ts");
    expect(normalisePath("already/posix")).toBe("already/posix");
  });

  it("takes the last segment whichever separator was used", () => {
    expect(basename("C:\\a\\b\\c.ts")).toBe("c.ts");
    expect(basename("/a/b/c.ts")).toBe("c.ts");
    expect(basename("bare.ts")).toBe("bare.ts");
  });

  it("returns the parent folder, and nothing for a bare name", () => {
    expect(dirname("C:\\a\\b\\c.ts")).toBe("C:/a/b");
    expect(dirname("bare.ts")).toBe("");
    expect(dirname("/top.ts")).toBe("");
  });

  it("lowercases the extension and ignores dotfiles", () => {
    expect(extname("a/b/Component.TSX")).toBe("tsx");
    expect(extname("archive.tar.gz")).toBe("gz");
    expect(extname("noext")).toBe("");
    expect(extname(".gitignore")).toBe("");
  });

  it("formats byte counts", () => {
    expect(formatBytes(0)).toMatch(/0/);
    expect(formatBytes(1024)).toMatch(/1/);
  });
});

describe("line diff", () => {
  it("marks identical text as unchanged", () => {
    const rows = lineDiff("a\nb", "a\nb");
    expect(rows.every((row) => row.type === "same")).toBe(true);
    expect(diffCounts(rows)).toEqual({ added: 0, removed: 0 });
  });

  it("counts an added line", () => {
    const counts = diffCounts(lineDiff("a", "a\nb"));
    expect(counts.added).toBe(1);
    expect(counts.removed).toBe(0);
  });

  it("counts a removed line", () => {
    const counts = diffCounts(lineDiff("a\nb", "a"));
    expect(counts.added).toBe(0);
    expect(counts.removed).toBe(1);
  });

  it("reports a replaced line as one add and one remove", () => {
    const counts = diffCounts(lineDiff("a\nold\nc", "a\nnew\nc"));
    expect(counts).toEqual({ added: 1, removed: 1 });
  });
});
