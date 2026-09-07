import { describe, expect, it } from "vitest";

import { canVerifyLive, parseFileLocation } from "@/lib/liveVerify";

describe("parseFileLocation", () => {
  it("splits a POSIX path and line", () => {
    expect(parseFileLocation("/srv/app/routes.js:42")).toEqual({ file: "/srv/app/routes.js", line: 42 });
  });

  it("keeps the drive letter on a Windows path", () => {
    expect(parseFileLocation("C:\\Users\\me\\app\\routes.ts:7")).toEqual({
      file: "C:\\Users\\me\\app\\routes.ts",
      line: 7,
    });
  });

  it("splits on the last colon, not the drive colon", () => {
    expect(parseFileLocation("D:/work/a:b/file.py:100")?.line).toBe(100);
  });

  it("rejects a location with no line", () => {
    expect(parseFileLocation("C:\\Users\\me\\routes.ts")).toBeNull();
  });

  it("rejects a URL, which belongs to a dynamic finding", () => {
    expect(parseFileLocation("https://example.com/users")).toBeNull();
    expect(parseFileLocation("http://localhost:3000")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(parseFileLocation("")).toBeNull();
    expect(parseFileLocation("   ")).toBeNull();
  });
});

describe("canVerifyLive", () => {
  it("accepts a source location", () => {
    expect(canVerifyLive("src/routes.js:12")).toBe(true);
  });

  it("refuses a URL location", () => {
    expect(canVerifyLive("https://example.com/a")).toBe(false);
  });
});
