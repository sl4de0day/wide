import { describe, expect, it } from "vitest";
import { RuleLoader } from "@/editor/features/inspect/rulesLoader";

describe("RuleLoader", () => {
  it("parses array format rules", () => {
    const raw = JSON.stringify([
      {
        id: "wide/sql-injection",
        pattern: "query\\s*\\(",
        message: "SQL injection sink detected",
        severity: "CRITICAL",
        languages: ["js", "ts"],
        cwe: "CWE-89"
      }
    ]);

    const res = RuleLoader.parse(raw);
    expect(res.errors).toHaveLength(0);
    expect(res.rules).toHaveLength(1);
    expect(res.rules[0].id).toBe("wide/sql-injection");
    expect(res.rules[0].severity).toBe("error");
    expect(res.rules[0].cwe).toBe("CWE-89");
  });

  it("parses object wrapper format rules", () => {
    const raw = JSON.stringify({
      version: "0.191126",
      rules: [
        {
          id: "wide/command-injection",
          pattern: "exec\\s*\\(",
          message: "Command execution sink detected",
          severity: "HIGH",
          languages: ["js", "py"]
        }
      ]
    });

    const res = RuleLoader.parse(raw);
    expect(res.errors).toHaveLength(0);
    expect(res.rules).toHaveLength(1);
    expect(res.rules[0].id).toBe("wide/command-injection");
    expect(res.rules[0].severity).toBe("error");
  });

  it("handles malformed JSON gracefully", () => {
    const res = RuleLoader.parse("not json");
    expect(res.rules).toHaveLength(0);
    expect(res.errors).toHaveLength(1);
  });
});
