import { bridge } from "@/lib/bridge";


export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface MutableRequest {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body: string;
}

export interface ResponseCtx {
  code: number;
  status: string;
  responseTime: number;
  headers: [string, string][];
  body: string;
}

export interface PmScopes {

  get(name: string): string | undefined;
  setEnvironment(name: string, value: string): void;
  unsetEnvironment(name: string): void;
  setGlobal(name: string, value: string): void;
  unsetGlobal(name: string): void;
  setCollection(name: string, value: string): void;
  unsetCollection(name: string): void;
  setLocal(name: string, value: string): void;
}

export interface PmContext {
  request: MutableRequest;
  response: ResponseCtx | null;
  scopes: PmScopes;
  requestName: string;
  iteration: number;
  results: TestResult[];
  logs: string[];
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

class Assertion {
  constructor(private actual: unknown, private negated = false, private deepFlag = false) {}

  private check(cond: boolean, msg: string): void {
    const pass = this.negated ? !cond : cond;
    if (!pass) throw new Error(`expected ${JSON.stringify(this.actual)} ${this.negated ? "not " : ""}${msg}`);
  }

  get not(): Assertion {
    return new Assertion(this.actual, !this.negated, this.deepFlag);
  }

  get to(): this { return this; }
  get be(): this { return this; }
  get been(): this { return this; }
  get is(): this { return this; }
  get that(): this { return this; }
  get which(): this { return this; }
  get and(): this { return this; }
  get has(): this { return this; }
  get have(): this { return this; }
  get with(): this { return this; }
  get deep(): Assertion { return new Assertion(this.actual, this.negated, true); }

  equal(expected: unknown): this {
    const same = this.deepFlag ? deepEqual(this.actual, expected) : this.actual === expected;
    this.check(same, `to equal ${JSON.stringify(expected)}`);
    return this;
  }
  equals(expected: unknown): this {
    return this.equal(expected);
  }
  eql(expected: unknown): this {
    this.check(deepEqual(this.actual, expected), `to deeply equal ${JSON.stringify(expected)}`);
    return this;
  }
  a(type: string): this {
    this.check(typeName(this.actual) === type, `to be a ${type}`);
    return this;
  }
  an(type: string): this {
    return this.a(type);
  }
  include(sub: unknown): this {
    const a = this.actual;
    let ok = false;
    if (typeof a === "string") ok = a.includes(String(sub));
    else if (Array.isArray(a)) ok = a.some((x) => deepEqual(x, sub));
    else if (a && typeof a === "object" && sub && typeof sub === "object") ok = Object.entries(sub as object).every(([k, v]) => deepEqual((a as Record<string, unknown>)[k], v));
    this.check(ok, `to include ${JSON.stringify(sub)}`);
    return this;
  }
  contain(sub: unknown): this {
    return this.include(sub);
  }
  above(n: number): this {
    this.check(Number(this.actual) > n, `to be above ${n}`);
    return this;
  }
  below(n: number): this {
    this.check(Number(this.actual) < n, `to be below ${n}`);
    return this;
  }
  least(n: number): this {
    this.check(Number(this.actual) >= n, `to be at least ${n}`);
    return this;
  }
  most(n: number): this {
    this.check(Number(this.actual) <= n, `to be at most ${n}`);
    return this;
  }
  lengthOf(n: number): this {
    const len = (this.actual as { length?: number })?.length;
    this.check(len === n, `to have length ${n}`);
    return this;
  }
  match(re: RegExp): this {
    this.check(typeof this.actual === "string" && re.test(this.actual), `to match ${re}`);
    return this;
  }
  oneOf(list: unknown[]): this {
    this.check(list.some((x) => deepEqual(x, this.actual)), `to be one of ${JSON.stringify(list)}`);
    return this;
  }
  property(name: string, value?: unknown): this {
    const has = this.actual != null && Object.prototype.hasOwnProperty.call(this.actual, name);
    this.check(has, `to have property ${name}`);
    if (value !== undefined && has) this.check(deepEqual((this.actual as Record<string, unknown>)[name], value), `to have property ${name} of ${JSON.stringify(value)}`);
    return this;
  }

  get ok(): this { this.check(Boolean(this.actual), "to be truthy"); return this; }
  get true(): this { this.check(this.actual === true, "to be true"); return this; }
  get false(): this { this.check(this.actual === false, "to be false"); return this; }
  get null(): this { this.check(this.actual === null, "to be null"); return this; }
  get undefined(): this { this.check(this.actual === undefined, "to be undefined"); return this; }
  get exist(): this { this.check(this.actual !== null && this.actual !== undefined, "to exist"); return this; }
  get empty(): this {
    const a = this.actual;
    const isEmpty = a == null || (typeof a === "string" && a.length === 0) || (Array.isArray(a) && a.length === 0) || (typeof a === "object" && Object.keys(a).length === 0);
    this.check(Boolean(isEmpty), "to be empty");
    return this;
  }
  keys(...names: (string | string[])[]): this {
    const wanted = names.flat();
    const obj = this.actual as Record<string, unknown> | null;
    const has = obj != null && wanted.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
    this.check(has, `to have keys ${JSON.stringify(wanted)}`);
    return this;
  }
  closeTo(expected: number, delta: number): this {
    this.check(Math.abs(Number(this.actual) - expected) <= delta, `to be close to ${expected} (±${delta})`);
    return this;
  }
  instanceOf(ctor: new (...args: unknown[]) => unknown): this {
    this.check(this.actual instanceof ctor, `to be an instance of ${ctor?.name ?? "type"}`);
    return this;
  }
  throw(): this {
    let threw = false;
    try {
      if (typeof this.actual === "function") (this.actual as () => void)();
    } catch {
      threw = true;
    }
    this.check(threw, "to throw");
    return this;
  }
}

function expect(actual: unknown): Assertion {
  return new Assertion(actual);
}

function scopeApi(scope: "environment" | "globals" | "collection", ctx: PmContext) {
  return {
    get: (name: string): string | undefined => ctx.scopes.get(name),
    set: (name: string, value: unknown): void => {
      const v = String(value);
      if (scope === "environment") ctx.scopes.setEnvironment(name, v);
      else if (scope === "globals") ctx.scopes.setGlobal(name, v);
      else ctx.scopes.setCollection(name, v);
    },
    has: (name: string): boolean => ctx.scopes.get(name) !== undefined,
    unset: (name: string): void => {
      if (scope === "environment") ctx.scopes.unsetEnvironment(name);
      else if (scope === "globals") ctx.scopes.unsetGlobal(name);
      else ctx.scopes.unsetCollection(name);
    },
  };
}

function requestApi(req: MutableRequest) {
  const findIndex = (key: string) => req.headers.findIndex((h) => h.key.toLowerCase() === key.toLowerCase());
  return {
    get method() {
      return req.method;
    },
    set method(m: string) {
      req.method = m;
    },
    get url() {
      return req.url;
    },
    set url(u: string) {
      req.url = u;
    },
    get body() {
      return req.body;
    },
    set body(b: string) {
      req.body = b;
    },
    headers: {
      add: (h: { key: string; value: string }) => req.headers.push({ key: h.key, value: h.value }),
      upsert: (h: { key: string; value: string }) => {
        const i = findIndex(h.key);
        if (i >= 0) req.headers[i] = { key: h.key, value: h.value };
        else req.headers.push({ key: h.key, value: h.value });
      },
      remove: (key: string) => {
        const i = findIndex(key);
        if (i >= 0) req.headers.splice(i, 1);
      },
      get: (key: string) => req.headers[findIndex(key)]?.value,
    },
  };
}

function responseApi(res: ResponseCtx) {
  const headerGet = (name: string) => res.headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  const self = {
    code: res.code,
    status: res.status,
    responseTime: res.responseTime,
    text: () => res.body,
    json: () => JSON.parse(res.body),
    headers: { get: headerGet },
    reason: () => res.status,
    size: () => res.body.length,
    to: {
      have: {
        status: (code: number | string) => {
          if (typeof code === "number") {
            if (res.code !== code) throw new Error(`expected status ${code} but got ${res.code}`);
          } else if (res.status !== code) throw new Error(`expected status "${code}" but got "${res.status}"`);
          return self;
        },
        header: (name: string) => {
          if (headerGet(name) === undefined) throw new Error(`expected header ${name}`);
          return self;
        },
        jsonBody: (expected?: unknown) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(res.body);
          } catch {
            throw new Error("expected the body to be JSON");
          }
          if (expected !== undefined && !deepEqual(parsed, expected)) {
            throw new Error(`expected JSON body to equal ${JSON.stringify(expected)}`);
          }
          return self;
        },
      },
      be: {
        get ok() {
          if (res.code < 200 || res.code >= 300) throw new Error(`expected a 2xx status but got ${res.code}`);
          return self;
        },
        get success() {
          if (res.code < 200 || res.code >= 300) throw new Error(`expected a 2xx status but got ${res.code}`);
          return self;
        },
        get clientError() {
          if (res.code < 400 || res.code >= 500) throw new Error(`expected a 4xx status but got ${res.code}`);
          return self;
        },
        get serverError() {
          if (res.code < 500 || res.code >= 600) throw new Error(`expected a 5xx status but got ${res.code}`);
          return self;
        },
      },
    },
  };
  return self;
}

export function createPm(ctx: PmContext): Record<string, unknown> {
  const environment = scopeApi("environment", ctx);
  const globals = scopeApi("globals", ctx);
  const collectionVariables = scopeApi("collection", ctx);
  const variables = {
    get: (name: string): string | undefined => ctx.scopes.get(name),
    set: (name: string, value: unknown): void => ctx.scopes.setLocal(name, String(value)),
    has: (name: string): boolean => ctx.scopes.get(name) !== undefined,
    replaceIn: (template: string): string => template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, n: string) => ctx.scopes.get(n) ?? whole),
  };

  return {
    environment,
    globals,
    collectionVariables,
    variables,
    request: requestApi(ctx.request),
    response: ctx.response ? responseApi(ctx.response) : undefined,
    info: { requestName: ctx.requestName, iteration: ctx.iteration },
    expect,
    sendRequest: async (
      config: string | { url?: string; method?: string; header?: Record<string, string> | { key: string; value: string }[]; body?: { raw?: string } | string },
      callback?: (err: Error | null, res: unknown) => void,
    ): Promise<unknown> => {
      try {
        const url = typeof config === "string" ? config : config.url ?? "";
        const method = typeof config === "string" ? "GET" : (config.method ?? "GET").toUpperCase();
        let headers: [string, string][] = [];
        if (typeof config !== "string" && config.header) {
          headers = Array.isArray(config.header)
            ? config.header.map((h) => [h.key, h.value] as [string, string])
            : Object.entries(config.header).map(([k, v]) => [k, String(v)] as [string, string]);
        }
        let body: string | null = null;
        if (typeof config !== "string" && config.body) {
          body = typeof config.body === "string" ? config.body : config.body.raw ?? null;
        }
        const resolved = url.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, n) => ctx.scopes.get(String(n).trim()) ?? whole);
        const reply = await bridge.httpSend(resolved, method, headers, body);
        const res = reply.ok
          ? {
              code: reply.status,
              status: reply.statusText,
              headers: reply.headers,
              text: () => reply.body,
              json: () => JSON.parse(reply.body),
            }
          : null;
        const err = reply.ok ? null : new Error(reply.error);
        if (callback) callback(err, res);
        if (err) throw err;
        return res;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (callback) callback(err, null);
        throw err;
      }
    },
    test: (name: string, fn: () => void | Promise<void>) => {
      try {
        const out = fn();
        if (out && typeof (out as Promise<void>).then === "function") {
          return (out as Promise<void>)
            .then(() => ctx.results.push({ name, passed: true }))
            .catch((e) => ctx.results.push({ name, passed: false, error: e instanceof Error ? e.message : String(e) }));
        }
        ctx.results.push({ name, passed: true });
      } catch (e) {
        ctx.results.push({ name, passed: false, error: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
