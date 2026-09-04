import { create } from "zustand";

export interface Param {
  key: string;
  value: string;
  enabled: boolean;
}

export type BodyMode = "none" | "form" | "multipart" | "raw" | "graphql" | "binary";
export type RawType = "json" | "xml" | "text" | "html";

export interface BodyConfig {
  mode: BodyMode;
  raw: string;
  rawType: RawType;
  form: Param[];
  graphql: { query: string; variables: string };
  binaryPath: string;
}

export type AuthType = "none" | "bearer" | "basic" | "apikey" | "oauth2" | "digest" | "awssigv4";
export interface AuthConfig {
  type: AuthType;
  bearer: string;
  basic: { username: string; password: string };
  apikey: { key: string; value: string; in: "header" | "query" };
  oauth2: { tokenUrl: string; clientId: string; clientSecret: string; scope: string; grant: "client_credentials" | "password"; username: string; password: string; token: string };
  aws: { accessKey: string; secretKey: string; region: string; service: string };
  digest: { username: string; password: string };
}

export type Protocol = "http" | "websocket" | "sse" | "grpc";

export interface PitcherRequest {
  id: string;
  name: string;
  protocol: Protocol;
  method: string;
  url: string;
  params: Param[];
  headers: Param[];
  auth: AuthConfig;
  body: BodyConfig;
  preScript: string;
  testScript: string;
  followRedirects: boolean;
  throughProxy: boolean;
}

export type Node =
  | { id: string; kind: "folder"; name: string; open: boolean; nodes: Node[] }
  | { id: string; kind: "request"; request: PitcherRequest };

export interface Collection {
  id: string;
  name: string;
  nodes: Node[];
  vars: Param[];
}

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`;

const emptyBody = (): BodyConfig => ({ mode: "none", raw: "", rawType: "json", form: [], graphql: { query: "", variables: "" }, binaryPath: "" });
const emptyAuth = (): AuthConfig => ({
  type: "none",
  bearer: "",
  basic: { username: "", password: "" },
  apikey: { key: "", value: "", in: "header" },
  oauth2: { tokenUrl: "", clientId: "", clientSecret: "", scope: "", grant: "client_credentials", username: "", password: "", token: "" },
  aws: { accessKey: "", secretKey: "", region: "us-east-1", service: "execute-api" },
  digest: { username: "", password: "" },
});

export function newRequest(name = "New request"): PitcherRequest {
  return {
    id: uid("r"),
    name,
    protocol: "http",
    method: "GET",
    url: "https://",
    params: [],
    headers: [],
    auth: emptyAuth(),
    body: emptyBody(),
    preScript: "",
    testScript: "",
    followRedirects: true,
    throughProxy: false,
  };
}

function normalizeRequest(r: PitcherRequest): PitcherRequest {
  const ea = emptyAuth();
  const a = r.auth ?? ea;
  const eb = emptyBody();
  const b = r.body ?? eb;
  return {
    ...r,
    protocol: r.protocol ?? "http",
    method: r.method ?? "GET",
    url: r.url ?? "",
    params: Array.isArray(r.params) ? r.params : [],
    headers: Array.isArray(r.headers) ? r.headers : [],
    preScript: r.preScript ?? "",
    testScript: r.testScript ?? "",
    followRedirects: r.followRedirects ?? true,
    throughProxy: r.throughProxy ?? false,
    auth: {
      type: a.type ?? "none",
      bearer: a.bearer ?? "",
      basic: a.basic ?? ea.basic,
      apikey: a.apikey ?? ea.apikey,
      oauth2: a.oauth2 ?? ea.oauth2,
      aws: a.aws ?? ea.aws,
      digest: a.digest ?? ea.digest,
    },
    body: {
      mode: b.mode ?? "none",
      raw: b.raw ?? "",
      rawType: b.rawType ?? "json",
      form: Array.isArray(b.form) ? b.form : [],
      graphql: b.graphql ?? eb.graphql,
      binaryPath: b.binaryPath ?? "",
    },
  };
}
function normalizeNodes(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (!n) continue;
    if (n.kind === "folder") out.push({ ...n, nodes: normalizeNodes(n.nodes ?? []) });
    else if (n.kind === "request") out.push({ ...n, request: normalizeRequest(n.request) });
  }
  return out;
}

const KEY = "wide.pitcher.collections";
function load(): Collection[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((c: Collection) => ({ ...c, nodes: normalizeNodes(c.nodes ?? []), vars: Array.isArray(c.vars) ? c.vars : [] }));
  } catch {
    return [];
  }
}
function persist(collections: Collection[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(collections));
  } catch {

  }
}

function findReq(collections: Collection[], id: string): PitcherRequest | null {
  const walk = (nodes: Node[]): PitcherRequest | null => {
    for (const n of nodes) {
      if (n.kind === "request" && n.request.id === id) return n.request;
      if (n.kind === "folder") {
        const found = walk(n.nodes);
        if (found) return found;
      }
    }
    return null;
  };
  for (const c of collections) {
    const found = walk(c.nodes);
    if (found) return found;
  }
  return null;
}

function mapNodes(nodes: Node[], fn: (n: Node) => Node | null): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    const mapped = fn(n);
    if (mapped === null) continue;
    if (mapped.kind === "folder") out.push({ ...mapped, nodes: mapNodes(mapped.nodes, fn) });
    else out.push(mapped);
  }
  return out;
}

interface PitcherState {
  collections: Collection[];
  openTabs: string[];
  activeTab: string | null;

  newCollection(name?: string): void;
  addCollections(collections: Collection[]): void;

  captureRequest(seed: { name?: string; method: string; url: string; headers: [string, string][]; body: string }): void;
  addFolder(collectionId: string, parentFolderId: string | null): void;
  addRequest(collectionId: string, parentFolderId: string | null): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
  toggleFolder(id: string): void;
  setCollectionVars(collectionId: string, vars: Param[]): void;

  openRequest(id: string): void;
  closeTab(id: string): void;
  selectTab(id: string): void;
  updateRequest(id: string, patch: Partial<PitcherRequest>): void;
  getRequest(id: string): PitcherRequest | null;
  collectionOf(requestId: string): Collection | null;
}

export const usePitcher = create<PitcherState>((set, get) => ({
  collections: load(),
  openTabs: [],
  activeTab: null,

  newCollection: (name = "New collection") => {
    const c: Collection = { id: uid("c"), name, nodes: [], vars: [] };
    set((s) => {
      const collections = [...s.collections, c];
      persist(collections);
      return { collections };
    });
  },

  addCollections: (incoming) => {
    if (incoming.length === 0) return;
    set((s) => {
      const collections = [...s.collections, ...incoming];
      persist(collections);
      return { collections };
    });
  },

  captureRequest: (seed) => {
    const req = newRequest(seed.name || `${seed.method} ${seed.url}`);
    req.method = (seed.method || "GET").toUpperCase();
    req.url = seed.url;
    req.headers = seed.headers.map(([key, value]) => ({ key, value, enabled: true }));
    if (seed.body && seed.body.trim()) {
      req.body.mode = "raw";
      req.body.raw = seed.body;
      const ct = seed.headers.find(([n]) => n.toLowerCase() === "content-type")?.[1] ?? "";
      req.body.rawType = ct.includes("json") ? "json" : ct.includes("xml") ? "xml" : ct.includes("html") ? "html" : "text";
    }
    const node: Node = { id: uid("n"), kind: "request", request: req };
    set((s) => {
      let collections = s.collections;
      let target = collections.find((c) => c.name === "Captured") ?? collections[0];
      if (!target) {
        target = { id: uid("c"), name: "Captured", nodes: [], vars: [] };
        collections = [...collections, target];
      }
      collections = collections.map((c) => (c.id === target.id ? { ...c, nodes: [...c.nodes, node] } : c));
      persist(collections);
      return { collections, openTabs: [...s.openTabs, req.id], activeTab: req.id };
    });
  },

  addFolder: (collectionId, parentFolderId) => {
    const folder: Node = { id: uid("f"), kind: "folder", name: "New folder", open: true, nodes: [] };
    set((s) => {
      const collections = s.collections.map((c) => {
        if (c.id !== collectionId) return c;
        if (!parentFolderId) return { ...c, nodes: [...c.nodes, folder] };
        return { ...c, nodes: mapNodes(c.nodes, (n) => (n.kind === "folder" && n.id === parentFolderId ? { ...n, nodes: [...n.nodes, folder] } : n)) };
      });
      persist(collections);
      return { collections };
    });
  },

  addRequest: (collectionId, parentFolderId) => {
    const req = newRequest();
    const node: Node = { id: uid("n"), kind: "request", request: req };
    set((s) => {
      const collections = s.collections.map((c) => {
        if (c.id !== collectionId) return c;
        if (!parentFolderId) return { ...c, nodes: [...c.nodes, node] };
        return { ...c, nodes: mapNodes(c.nodes, (n) => (n.kind === "folder" && n.id === parentFolderId ? { ...n, nodes: [...n.nodes, node] } : n)) };
      });
      persist(collections);
      return { collections, openTabs: [...s.openTabs, req.id], activeTab: req.id };
    });
  },

  rename: (id, name) => {
    set((s) => {
      const collections = s.collections.map((c) => {
        if (c.id === id) return { ...c, name };
        return { ...c, nodes: mapNodes(c.nodes, (n) => (n.id === id ? (n.kind === "folder" ? { ...n, name } : { ...n, request: { ...n.request, name } }) : n)) };
      });
      persist(collections);
      return { collections };
    });
  },

  remove: (id) => {
    set((s) => {
      const collections = s.collections
        .filter((c) => c.id !== id)
        .map((c) => ({ ...c, nodes: mapNodes(c.nodes, (n) => (n.id === id ? null : n)) }));
      persist(collections);
      return { collections };
    });
  },

  toggleFolder: (id) => {
    set((s) => {
      const collections = s.collections.map((c) => ({ ...c, nodes: mapNodes(c.nodes, (n) => (n.kind === "folder" && n.id === id ? { ...n, open: !n.open } : n)) }));
      persist(collections);
      return { collections };
    });
  },

  setCollectionVars: (collectionId, vars) => {
    set((s) => {
      const collections = s.collections.map((c) => (c.id === collectionId ? { ...c, vars } : c));
      persist(collections);
      return { collections };
    });
  },

  openRequest: (id) =>
    set((s) => ({ openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id], activeTab: id })),

  closeTab: (id) =>
    set((s) => {
      const openTabs = s.openTabs.filter((t) => t !== id);
      const activeTab = s.activeTab === id ? (openTabs[openTabs.length - 1] ?? null) : s.activeTab;
      return { openTabs, activeTab };
    }),

  selectTab: (id) => set({ activeTab: id }),

  updateRequest: (id, patch) => {
    set((s) => {
      const collections = s.collections.map((c) => ({
        ...c,
        nodes: mapNodes(c.nodes, (n) => (n.kind === "request" && n.request.id === id ? { ...n, request: { ...n.request, ...patch } } : n)),
      }));
      persist(collections);
      return { collections };
    });
  },

  getRequest: (id) => findReq(get().collections, id),
  collectionOf: (requestId) => {
    for (const c of get().collections) {
      if (findReq([c], requestId)) return c;
    }
    return null;
  },
}));
