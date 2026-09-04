import { useCatcher } from "@/stores/catcher";
import { useIntruder } from "@/stores/intruder";
import type { PitcherRequest } from "@/stores/pitcher";
import { useScanner } from "@/stores/scanner";

import { materialize } from "./codegen";

function rawHttp(method: string, url: string, headers: [string, string][], body: string): string {
  return `${method} ${url}\n` + headers.map(([n, v]) => `${n}: ${v}`).join("\n") + `\n\n${body}`;
}

export function sendToRepeater(req: PitcherRequest, vars: Record<string, string>): void {
  const e = materialize(req, vars);
  useCatcher.getState().addRepeater({ method: e.method, url: e.url, headers: e.headers, body: e.body ?? "" });
}

export function sendToIntruder(req: PitcherRequest, vars: Record<string, string>): void {
  const e = materialize(req, vars);
  useIntruder.getState().openIntruder(rawHttp(e.method, e.url, e.headers, e.body ?? ""));
}

export function sendToScanner(req: PitcherRequest, vars: Record<string, string>): void {
  const e = materialize(req, vars);
  useScanner.getState().scan(rawHttp(e.method, e.url, e.headers, e.body ?? ""));
}
