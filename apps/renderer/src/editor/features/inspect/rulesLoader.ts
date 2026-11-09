import { bridge } from "@/lib/bridge";
import type { Rule } from "./rules";
import { parseProjectRules } from "./engine";

export class RuleLoader {
  static parse(source: string): { rules: Rule[]; errors: string[] } {
    return parseProjectRules(source);
  }

  static async load(root?: string): Promise<Rule[]> {
    if (root) {
      try {
        const file = await bridge.readFile(`${root}/.wide/rules.json`);
        if (file?.content) {
          const parsed = parseProjectRules(file.content);
          if (parsed.rules.length > 0) {
            return parsed.rules;
          }
        }
      } catch {
        void 0;
      }
    }
    return [];
  }
}
