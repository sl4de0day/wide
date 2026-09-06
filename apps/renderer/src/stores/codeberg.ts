import { create } from "zustand";

import { bridge, type CodebergCommit, type CodebergFile, type CodebergStatus, type GitBranch } from "@/lib/bridge";
import { providerFor, type GitProvider } from "@/lib/gitProviders";
import { useWorkspace } from "./workspace";

export type SyncStage = "" | "pushing" | "pulling" | "committing" | "staging" | "stashing";

export interface Message {
  key: string;
  params?: Record<string, string | number>;
}

interface CodebergState {

  status: CodebergStatus | null;
  commits: CodebergCommit[];

  branches: GitBranch[];

  selected: Set<string>;
  message: string;
  busy: SyncStage;

  error: Message | null;

  notice: Message | null;
  signedIn: boolean;
  username: string;

  provider: GitProvider;

  refresh(): Promise<void>;
  setMessage(message: string): void;
  toggle(path: string): void;
  selectAll(paths: string[]): void;
  clearSelection(): void;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  discard(paths: string[]): Promise<void>;
  commit(amend?: boolean): Promise<void>;
  switchBranch(name: string, create: boolean): Promise<boolean>;
  push(withTags: boolean): Promise<void>;
  pull(): Promise<void>;
  stash(action: "push" | "pop"): Promise<void>;
  init(branch: string): Promise<void>;
  setRemote(url: string): Promise<void>;
  setIdentity(name: string, email: string): Promise<void>;
  signIn(username: string, token: string): Promise<boolean>;
  signOut(): Promise<void>;
  tag(name: string, message: string, push: boolean): Promise<void>;
  dismiss(): void;
}

const root = () => useWorkspace.getState().root ?? "";

const ADVICE: Record<string, string> = {
  auth: "Codeberg refused those credentials. Sign in with an access token.",
  "no-remote-repo":
    "Codeberg has no such repository. Create it on the website first — Push-To-Create is switched off there.",
  network: "Codeberg could not be reached.",
  behind: "Codeberg has commits you do not. Pull first, then push.",
  conflict: "The histories have diverged. Resolve it in the terminal.",
  "no-upstream": "This branch has no upstream yet.",
  "no-identity": "Git does not know who you are yet. Set a name and email address.",
  "nothing-to-commit": "There is nothing staged to commit.",
  timeout: "Git took too long and was stopped.",
  detached: "You are not on a branch.",
  "token-in-url": "Sign in instead of putting a token in the address.",
};

const failure = (reply: { reason?: string; error?: string }): Message =>
  reply.reason && ADVICE[reply.reason]
    ? { key: ADVICE[reply.reason] }
    :

      { key: "Git said: {detail}", params: { detail: reply.error || "" } };

export const useCodeberg = create<CodebergState>((set, get) => ({
  status: null,
  commits: [],
  branches: [],
  selected: new Set<string>(),
  message: "",
  busy: "",
  error: null,
  notice: null,
  signedIn: false,
  username: "",
  provider: providerFor(null),

  refresh: async () => {
    const where = root();
    const status = await bridge.codebergStatus(where);

    const provider = providerFor(status.remote);
    set({ provider });

    const present = new Set((status.files ?? []).map((file: CodebergFile) => file.path));
    set((state) => ({
      status,
      selected: new Set([...state.selected].filter((path) => present.has(path))),
    }));

    if (!status.installed || !status.repository) {
      set({ commits: [], branches: [] });
      return;
    }
    const [log, session, branchList] = await Promise.all([
      bridge.codebergLog(where, 12),
      bridge.codebergSignedIn(provider.host),
      bridge.codebergBranches(where),
    ]);
    set({
      commits: log.ok ? (log.commits ?? []) : [],
      signedIn: Boolean(session.ok && session.signedIn),
      username: session.ok ? (session.username ?? "") : "",
      branches: branchList.ok ? (branchList.branches ?? []) : [],
    });
  },

  setMessage: (message) => set({ message }),

  toggle: (path) =>
    set((state) => {
      const next = new Set(state.selected);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { selected: next };
    }),

  selectAll: (paths) => set({ selected: new Set(paths) }),
  clearSelection: () => set({ selected: new Set<string>() }),
  dismiss: () => set({ error: null, notice: null }),

  stage: async (paths) => {
    if (paths.length === 0) return;
    set({ busy: "staging", error: null, notice: null });
    const reply = await bridge.codebergStage(root(), paths);
    set({ busy: "", error: reply.ok ? null : failure(reply) });
    await get().refresh();
  },

  unstage: async (paths) => {
    if (paths.length === 0) return;
    set({ busy: "staging", error: null, notice: null });
    const reply = await bridge.codebergUnstage(root(), paths);
    set({ busy: "", error: reply.ok ? null : failure(reply) });
    await get().refresh();
  },

  discard: async (paths) => {
    if (paths.length === 0) return;
    set({ busy: "staging", error: null, notice: null });
    const reply = await bridge.codebergDiscard(root(), paths);
    set({ busy: "", error: reply.ok ? null : failure(reply) });
    await get().refresh();

    if (reply.ok) void useWorkspace.getState().refresh();
  },

  switchBranch: async (name, create) => {
    set({ busy: "staging", error: null, notice: null });
    const reply = await bridge.codebergSwitch(root(), name, create);
    if (!reply.ok) {
      set({ busy: "", error: failure(reply) });
      return false;
    }
    set({
      busy: "",
      notice: { key: "On {branch}", params: { branch: reply.branch ?? name } },
    });
    await get().refresh();

    void useWorkspace.getState().refresh();
    return true;
  },

  commit: async (amend) => {
    const message = get().message.trim();
    if (!message) {
      set({ error: { key: "A commit needs a message." } });
      return;
    }
    set({ busy: "committing", error: null, notice: null });
    const reply = await bridge.codebergCommit(root(), message, amend);
    if (reply.ok) {
      set({
        busy: "",
        message: "",
        notice: reply.head
          ? { key: "Committed {hash}", params: { hash: reply.head } }
          : { key: "Committed." },
      });
    } else {
      set({ busy: "", error: failure(reply) });
    }
    await get().refresh();
  },

  push: async (withTags) => {
    set({ busy: "pushing", error: null, notice: null });
    const reply = await bridge.codebergPush(root(), withTags);
    if (reply.ok) {
      set({
        busy: "",
        notice: reply.tagsFailed
          ? { key: "Pushed, but the tags did not go." }
          : { key: "Pushed to {branch}", params: { branch: reply.branch ?? "" } },
      });
    } else {
      set({ busy: "", error: failure(reply) });
    }
    await get().refresh();
  },

  stash: async (action) => {
    set({ busy: "stashing", error: null, notice: null });
    const reply = await bridge.codebergStash(root(), action);
    set({
      busy: "",
      error: reply.ok ? null : failure(reply),
      notice: reply.ok ? { key: action === "pop" ? "Stash popped." : "Changes stashed." } : null,
    });
    await get().refresh();
    if (reply.ok) void useWorkspace.getState().refresh();
  },

  pull: async () => {
    set({ busy: "pulling", error: null, notice: null });
    const reply = await bridge.codebergPull(root());
    set({
      busy: "",
      error: reply.ok ? null : failure(reply),
      notice: reply.ok
        ? { key: "Up to date with {provider}.", params: { provider: get().provider.name } }
        : null,
    });
    await get().refresh();

    if (reply.ok) void useWorkspace.getState().refresh();
  },

  init: async (branch) => {
    set({ busy: "staging", error: null, notice: null });
    const reply = await bridge.codebergInit(root(), branch);
    set({
      busy: "",
      error: reply.ok ? null : failure(reply),
      notice: reply.ok
        ? { key: "Repository created on {branch}", params: { branch: reply.branch ?? branch } }
        : null,
    });
    await get().refresh();
  },

  setRemote: async (url) => {
    set({ error: null, notice: null });
    const reply = await bridge.codebergSetRemote(root(), url);
    set({ error: reply.ok ? null : failure(reply), notice: reply.ok ? { key: "Remote set." } : null });
    await get().refresh();
  },

  setIdentity: async (name, email) => {
    set({ error: null, notice: null });
    const reply = await bridge.codebergIdentity(root(), name, email);
    set({
      error: reply.ok ? null : failure(reply),
      notice: reply.ok ? { key: "Identity saved." } : null,
    });
    await get().refresh();
  },

  signIn: async (username, token) => {
    set({ error: null, notice: null });
    const provider = get().provider;
    const reply = await bridge.codebergSignIn(username, token, provider.host);
    if (!reply.ok) {
      set({ error: failure(reply) });
      return false;
    }

    set({
      signedIn: true,
      username,
      notice: { key: "Signed in to {provider}.", params: { provider: provider.name } },
    });
    return true;
  },

  signOut: async () => {
    await bridge.codebergSignOut(get().username, get().provider.host);
    set({ signedIn: false, username: "", notice: { key: "Signed out." } });
  },

  tag: async (name, message, push) => {
    set({ error: null, notice: null });
    const reply = await bridge.codebergTag(root(), name, message, push);
    if (!reply.ok) {
      set({ error: failure(reply) });
      return;
    }
    const tagName = reply.tag ?? name;
    set({
      notice: reply.pushFailed
        ? { key: "Tag made, but it did not reach {provider}.", params: { provider: get().provider.name } }
        : push
          ? { key: "Tag {tag} pushed.", params: { tag: tagName } }
          : { key: "Tag {tag} made. It will not travel with an ordinary push.", params: { tag: tagName } },
    });
    await get().refresh();
  },
}));

export function partition(files: readonly CodebergFile[]) {
  const staged: CodebergFile[] = [];
  const unstaged: CodebergFile[] = [];
  for (const file of files) {

    if (file.index !== "." && file.index !== "?") staged.push(file);
    if (file.work !== "." || file.index === "?") unstaged.push(file);
  }
  return { staged, unstaged };
}

export function statusLetter(file: CodebergFile, staged: boolean): string {
  const code = staged ? file.index : file.work;
  return code === "." ? "M" : code;
}
