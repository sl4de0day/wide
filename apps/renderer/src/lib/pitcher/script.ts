import { createPm, type PmContext } from "./pm";

export interface ScriptOutcome {
  error?: string;
}

export async function runScript(code: string, ctx: PmContext): Promise<ScriptOutcome> {
  if (!code.trim()) return {};
  const pm = createPm(ctx);
  const console = {
    log: (...args: unknown[]) => ctx.logs.push(args.map(fmt).join(" ")),
    info: (...args: unknown[]) => ctx.logs.push(args.map(fmt).join(" ")),
    warn: (...args: unknown[]) => ctx.logs.push("⚠ " + args.map(fmt).join(" ")),
    error: (...args: unknown[]) => ctx.logs.push("✖ " + args.map(fmt).join(" ")),
  };

  const tests = new Proxy(
    {},
    {
      set: (_t, name: string, value: unknown) => {
        ctx.results.push({ name, passed: Boolean(value) });
        return true;
      },
    },
  );
  try {

    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<void>;
    const fn = AsyncFunction("pm", "console", "tests", code);
    await fn(pm, console, tests);

    while (ctx.pending && ctx.pending.length > 0) {
      const waiting = ctx.pending;
      ctx.pending = [];
      await Promise.all(waiting);
    }
    return {};
  } catch (e) {

    try {
      while (ctx.pending && ctx.pending.length > 0) {
        const waiting = ctx.pending;
        ctx.pending = [];
        await Promise.all(waiting);
      }
    } catch {
      void 0;
    }
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
