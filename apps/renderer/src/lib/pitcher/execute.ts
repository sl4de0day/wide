import { usePitcher, type Param, type PitcherRequest } from "@/stores/pitcher";
import { usePitcherEnv } from "@/stores/pitcherEnv";

import type { MutableRequest, PmContext, PmScopes, ResponseCtx, TestResult } from "./pm";
import { runScript } from "./script";
import { sendPitcher, type PitcherResponse } from "./send";

export interface ExecResult {
  resp: PitcherResponse;
  tests: TestResult[];
  logs: string[];
  scriptError?: string;
}

function collectionVarsMap(req: PitcherRequest): Param[] {
  return usePitcher.getState().collectionOf(req.id)?.vars ?? [];
}

export async function executeRequest(
  req: PitcherRequest,
  opts: { extraVars?: Record<string, string>; iteration?: number; collectionAuth?: PitcherRequest["auth"] } = {},
): Promise<ExecResult> {
  const extraVars = opts.extraVars ?? {};
  const collVars = collectionVarsMap(req);
  const collection = usePitcher.getState().collectionOf(req.id);

  const bag: Record<string, string> = { ...usePitcherEnv.getState().merged(collVars), ...extraVars };

  const upsertCollectionVar = (name: string, value: string) => {
    if (!collection) return;
    const vars = collection.vars.some((v) => v.key === name)
      ? collection.vars.map((v) => (v.key === name ? { ...v, value } : v))
      : [...collection.vars, { key: name, value, enabled: true }];
    usePitcher.getState().setCollectionVars(collection.id, vars);
  };

  const scopes: PmScopes = {
    get: (name) => bag[name],
    setEnvironment: (name, value) => {
      bag[name] = value;
      usePitcherEnv.getState().setVar(name, value, "environment");
    },
    unsetEnvironment: (name) => {
      delete bag[name];
      usePitcherEnv.getState().unsetVar(name, "environment");
    },
    setGlobal: (name, value) => {
      bag[name] = value;
      usePitcherEnv.getState().setVar(name, value, "globals");
    },
    unsetGlobal: (name) => {
      delete bag[name];
      usePitcherEnv.getState().unsetVar(name, "globals");
    },
    setCollection: (name, value) => {
      bag[name] = value;
      upsertCollectionVar(name, value);
    },
    unsetCollection: (name) => {
      delete bag[name];
      if (collection) usePitcher.getState().setCollectionVars(collection.id, collection.vars.filter((v) => v.key !== name));
    },
    setLocal: (name, value) => {
      bag[name] = value;
    },
  };

  const initialBody = req.body.mode === "raw" ? req.body.raw : "";
  const mutable: MutableRequest = {
    method: req.method,
    url: req.url,
    headers: req.headers.filter((h) => h.enabled).map((h) => ({ key: h.key, value: h.value })),
    body: initialBody,
  };

  const results: TestResult[] = [];
  const logs: string[] = [];
  const baseCtx: Omit<PmContext, "response"> = {
    request: mutable,
    scopes,
    requestName: req.name,
    iteration: opts.iteration ?? 0,
    results,
    logs,
  };

  const pre = await runScript(req.preScript, { ...baseCtx, response: null });

  const bodyChanged = mutable.body !== initialBody;
  const clone: PitcherRequest = {
    ...req,
    method: mutable.method,
    url: mutable.url,
    headers: mutable.headers.map((h) => ({ key: h.key, value: h.value, enabled: true })),
    body: bodyChanged
      ? { ...req.body, mode: "raw", raw: mutable.body, rawType: req.body.mode === "raw" ? req.body.rawType : "json" }
      : req.body,
  };

  const resp = await sendPitcher(clone, bag, opts.collectionAuth);

  let testError: string | undefined;
  if (resp.ok) {
    const response: ResponseCtx = {
      code: resp.status ?? 0,
      status: resp.statusText ?? "",
      responseTime: resp.ms ?? 0,
      headers: resp.headers ?? [],
      body: resp.body ?? "",
    };
    const post = await runScript(req.testScript, { ...baseCtx, response });
    testError = post.error;
  }

  return { resp, tests: results, logs, scriptError: pre.error ?? testError };
}
