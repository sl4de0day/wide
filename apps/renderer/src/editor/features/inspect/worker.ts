import { Text } from "@codemirror/state";

import type { Diagnostic } from "@/lib/bridge";
import { BUILT_IN_RULES, type Rule } from "./rules";
import { runRouteAudit } from "./routes";
import { deserializeTextRule, runTextPass, type SerializedTextRule } from "./shared";
import { runTaint, runToctou, TAINT_LANGUAGES } from "./taint";

interface FlowRequest {
  id: number;
  docText: string;
  ext: string;
  securityOn: boolean;
}
interface ProjectRulesMsg {
  type: "projectRules";
  rules: SerializedTextRule[];
}
interface FlowResponse {
  id: number;
  security: Diagnostic[];
  inspection: Diagnostic[];
}

const post = (msg: FlowResponse) => (self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg);

let projectTextRules: Rule[] = [];

self.onmessage = (event: MessageEvent<FlowRequest | ProjectRulesMsg>) => {
  const msg = event.data;
  if ((msg as ProjectRulesMsg).type === "projectRules") {
    projectTextRules = ((msg as ProjectRulesMsg).rules ?? []).map(deserializeTextRule);
    return;
  }
  const { id, docText, ext, securityOn } = msg as FlowRequest;

  const doc = Text.of(docText.length ? docText.split("\n") : [""]);
  const rules = projectTextRules.length ? [...BUILT_IN_RULES, ...projectTextRules] : BUILT_IN_RULES;
  const { security, inspection } = runTextPass(doc, rules, ext, securityOn);

  if (securityOn && TAINT_LANGUAGES.has(ext)) {
    security.push(...runTaint(doc), ...runToctou(doc), ...runRouteAudit(doc));
  }
  post({ id, security, inspection });
};
