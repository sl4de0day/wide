import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Tag,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import type { CodebergFile } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { partition, statusLetter, useCodeberg } from "@/stores/codeberg";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";

const LETTER_COLOUR: Record<string, string> = {
  M: "text-amber-400",
  A: "text-emerald-400",
  D: "text-rose-400",
  R: "text-sky-400",
  C: "text-sky-400",
  U: "text-rose-400",
  "?": "text-fg-faint",
};

function FileRow({
  file,
  staged,
  ticked,
  onTick,
  onOpen,
}: {
  file: CodebergFile;
  staged: boolean;
  ticked: boolean;
  onTick: () => void;
  onOpen: () => void;
}) {
  const letter = statusLetter(file, staged);
  return (
    <div className="group flex items-center gap-1.5 px-2 py-[3px] transition-colors duration-100 hover:bg-hover">
      <button
        type="button"
        onClick={onTick}
        role="checkbox"
        aria-checked={ticked}
        aria-label={file.path}
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-100",
          ticked ? "border-accent bg-accent text-bg" : "border-line text-transparent",
        )}
      >
        <Check className="size-2.5" strokeWidth={3} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 truncate text-left text-[12px] text-fg-dim hover:text-fg"
        title={file.from ? `${file.from} → ${file.path}` : file.path}
      >
        {file.path}
      </button>
      <span
        className={cn("shrink-0 font-mono text-[11px]", LETTER_COLOUR[letter] ?? "text-fg-faint")}
        aria-hidden="true"
      >
        {letter}
      </span>
    </div>
  );
}

function Section({
  title,
  count,
  action,
  actionLabel,
  children,
}: {
  title: string;
  count: number;
  action?: () => void;
  actionLabel?: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="pb-1">
      <div className="flex items-center gap-1 px-2 pb-0.5 pt-2">
        <span className="text-[10px] uppercase tracking-wide text-fg-faint">{title}</span>
        <span className="text-[10px] tabular-nums text-fg-faint">{count}</span>
        <span className="flex-1" />
        {action && (
          <button
            type="button"
            onClick={action}
            title={actionLabel}
            aria-label={actionLabel}
            className="rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            {title.length > 0 && <Plus className="size-3" strokeWidth={1.75} />}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Setup({
  label,
  hint,
  value,
  onChange,
  placeholder,
  secret,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secret?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 px-2 py-1">
      <span className="text-[11px] text-fg-dim">{label}</span>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="rounded-sm border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
      />
      {hint && <span className="text-[10px] leading-snug text-fg-faint">{hint}</span>}
    </label>
  );
}

export function CodebergPanel({ builtin }: { builtin?: boolean; onOpenPanel?: (id: string) => void } = {}) {
  const t = useT();
  const root = useWorkspace((state) => state.root);
  const status = useCodeberg((state) => state.status);
  const commits = useCodeberg((state) => state.commits);
  const selected = useCodeberg((state) => state.selected);
  const message = useCodeberg((state) => state.message);
  const busy = useCodeberg((state) => state.busy);
  const error = useCodeberg((state) => state.error);
  const notice = useCodeberg((state) => state.notice);
  const signedIn = useCodeberg((state) => state.signedIn);
  const username = useCodeberg((state) => state.username);
  const branches = useCodeberg((state) => state.branches);

  const provider = useCodeberg((state) => state.provider);

  const [signInUser, setSignInUser] = useState("");
  const [signInToken, setSignInToken] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [tagName, setTagName] = useState("");
  const [showTag, setShowTag] = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [amend, setAmend] = useState(false);

  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    void useCodeberg.getState().refresh();
  }, [root]);

  const { staged, unstaged } = useMemo(
    () => partition(status?.files ?? []),
    [status?.files],
  );

  const act = useCodeberg.getState;

  const header = (
    <PanelHeader title={builtin ? t("Source Control") : provider.name}>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => void act().refresh()}
        title={t("Refresh")}
        aria-label={t("Refresh")}
        className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        <RefreshCw className="size-3.5" strokeWidth={1.5} />
      </button>
    </PanelHeader>
  );

  const banner = (error || notice) && (
    <button
      type="button"
      onClick={() => act().dismiss()}
      className={cn(
        "wide-enter-fade shrink-0 border-b border-line px-2 py-1.5 text-left text-[11px] leading-snug",
        error ? "text-rose-300" : "text-emerald-300",
      )}
    >
      {t((error ?? notice)!.key, (error ?? notice)!.params)}
    </button>
  );

  if (status && !status.installed) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <p className="px-3 py-4 text-[12px] text-fg-faint">
          {t("That extension is not installed.")}
        </p>
      </div>
    );
  }

  if (!root) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <p className="px-3 py-4 text-[12px] text-fg-faint">{t("Open a folder first.")}</p>
      </div>
    );
  }

  if (status && status.available === false) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <p className="px-3 py-4 text-[12px] leading-relaxed text-fg-faint">
          {status.reason === "no-git"
            ? t("Git is not installed on this machine. {provider} needs it.", { provider: provider.name })
            : t("Open a folder first.")}
        </p>
      </div>
    );
  }

  if (status && status.repository === false) {
    return (
      <div className="flex h-full flex-col">
        {header}
        {banner}
        <div className="min-h-0 flex-1 overflow-auto py-2">
          <p className="px-2 pb-2 text-[12px] leading-relaxed text-fg-dim">
            {t("This folder is not a repository yet.")}
          </p>
          <button
            type="button"
            onClick={() => void act().init("main")}
            className="mx-2 rounded-sm border border-line px-2 py-1 text-[12px] text-fg transition-colors duration-100 hover:bg-hover"
          >
            {t("Create a repository here")}
          </button>
          <p className="px-2 pt-3 text-[10px] leading-snug text-fg-faint">
            {t(
              "Create the repository on {provider} without a README or licence, then set it as the remote below. An empty repository usually has to exist there before your first push.",
              { provider: provider.name },
            )}
          </p>
        </div>
      </div>
    );
  }

  const branch = status?.branch;
  const identity = status?.identity;
  const needsIdentity = Boolean(identity && (!identity.name || !identity.email));

  return (
    <div className="flex h-full flex-col">
      {header}
      {banner}

      <div className="min-h-0 flex-1 overflow-auto">
        {
}
        <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2 py-1.5">
          <button
            type="button"
            onClick={() => setShowBranches((open) => !open)}
            disabled={branch?.detached}
            className="flex min-w-0 items-center gap-1 truncate text-[12px] text-fg transition-colors duration-100 hover:text-fg-bright disabled:cursor-default"
            title={t("Switch branch")}
          >
            <GitBranch className="size-3 shrink-0 text-fg-dim" strokeWidth={1.75} />
            <span className="truncate">{branch?.detached ? t("detached") : branch?.name || "—"}</span>
            {!branch?.detached && <ChevronDown className="size-3 shrink-0 text-fg-faint" strokeWidth={1.75} />}
          </button>
          {branch && (branch.ahead > 0 || branch.behind > 0) && (
            <span className="font-mono text-[11px] tabular-nums text-fg-faint">
              ↑{branch.ahead} ↓{branch.behind}
            </span>
          )}
          {status?.remote && provider.host && (
            <span
              className="rounded-sm bg-panel px-1 py-0.5 text-[10px] text-fg-faint"
              title={status.remote}
            >
              {provider.host}
            </span>
          )}

          {showBranches && (
            <div className="wide-enter-fade absolute left-2 top-full z-10 mt-0.5 w-[calc(100%-1rem)] rounded-md border border-line bg-raised p-1 shadow-lg">
              <div className="max-h-48 overflow-auto">
                {branches.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => {
                      setShowBranches(false);
                      if (!item.current) void act().switchBranch(item.name, false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[12px] transition-colors duration-100 hover:bg-hover",
                      item.current ? "text-fg-bright" : "text-fg-dim",
                    )}
                  >
                    <Check
                      className={cn("size-3 shrink-0", item.current ? "text-accent" : "text-transparent")}
                      strokeWidth={2.5}
                    />
                    <span className="truncate">{item.name}</span>
                  </button>
                ))}
              </div>
              <div className="mt-1 flex gap-1 border-t border-line pt-1">
                <input
                  value={newBranch}
                  onChange={(event) => setNewBranch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newBranch.trim()) {
                      const name = newBranch.trim();
                      setNewBranch("");
                      setShowBranches(false);
                      void act().switchBranch(name, true);
                    }
                  }}
                  placeholder={t("New branch…")}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
                />
                <button
                  type="button"
                  disabled={!newBranch.trim()}
                  onClick={() => {
                    const name = newBranch.trim();
                    setNewBranch("");
                    setShowBranches(false);
                    void act().switchBranch(name, true);
                  }}
                  title={t("Create branch")}
                  className="rounded-sm border border-line px-1.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40"
                >
                  <Plus className="size-3" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          )}
        </div>

        {}
        <div className="flex gap-1 border-b border-line px-2 py-1.5">
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => void act().pull()}
            className="flex flex-1 items-center justify-center gap-1 rounded-sm border border-line py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
          >
            <ArrowDownToLine className="size-3" strokeWidth={1.75} />
            {busy === "pulling" ? t("Pulling…") : t("Pull")}
          </button>
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => void act().push(false)}
            className="flex flex-1 items-center justify-center gap-1 rounded-sm border border-line py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
          >
            <ArrowUpFromLine className="size-3" strokeWidth={1.75} />
            {busy === "pushing" ? t("Pushing…") : t("Push")}
          </button>
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => void act().stash("push")}
            title={t("Stash your uncommitted changes")}
            className="flex items-center justify-center gap-1 rounded-sm border border-line px-2 py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
          >
            <Archive className="size-3" strokeWidth={1.75} />
            {busy === "stashing" ? t("Stashing…") : t("Stash")}
          </button>
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => void act().stash("pop")}
            title={t("Restore the most recent stash")}
            className="flex items-center justify-center gap-1 rounded-sm border border-line px-2 py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
          >
            <ArchiveRestore className="size-3" strokeWidth={1.75} />
            {t("Pop")}
          </button>
          <button
            type="button"
            onClick={() => setShowTag((open) => !open)}
            title={t("Tag this commit")}
            aria-label={t("Tag this commit")}
            className="rounded-sm border border-line px-1.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <Tag className="size-3" strokeWidth={1.75} />
          </button>
        </div>

        {showTag && (
          <div className="wide-enter-fade border-b border-line pb-2">
            <Setup
              label={t("Tag name")}
              hint={t("Tags do not travel with an ordinary push; this one is pushed on its own.")}
              value={tagName}
              onChange={setTagName}
              placeholder="v1.0.0"
            />
            <button
              type="button"
              disabled={!tagName.trim()}
              onClick={() => {
                void act().tag(tagName.trim(), tagName.trim(), true);
                setTagName("");
                setShowTag(false);
              }}
              className="mx-2 rounded-sm border border-line px-2 py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
            >
              {t("Make the tag and push it")}
            </button>
          </div>
        )}

        {}
        <div className="border-b border-line px-2 py-2">
          <textarea
            value={message}
            onChange={(event) => act().setMessage(event.target.value)}
            placeholder={t("What changed, and why")}
            rows={2}
            className="w-full resize-y rounded-sm border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint"
          />
          <button
            type="button"
            disabled={busy !== "" || (!amend && staged.length === 0) || !message.trim()}
            onClick={() => {
              void act().commit(amend);
              setAmend(false);
            }}
            className="mt-1 w-full rounded-sm border border-line py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
          >
            {busy === "committing"
              ? t("Committing…")
              : amend
                ? t("Amend last commit")
                : `${t("Commit")}${staged.length ? ` (${staged.length})` : ""}`}
          </button>
          <label className="mt-1 flex cursor-pointer items-center gap-1.5 px-0.5 text-[11px] text-fg-dim">
            <input
              type="checkbox"
              checked={amend}
              onChange={(event) => setAmend(event.target.checked)}
              className="size-3"
            />
            {t("Amend last commit")}
          </label>
        </div>

        <Section
          title={t("Staged")}
          count={staged.length}
          actionLabel={t("Unstage all")}
          action={() => void act().unstage(staged.map((file) => file.path))}
        >
          {staged.map((file) => (
            <FileRow
              key={`s:${file.path}`}
              file={file}
              staged
              ticked={selected.has(file.path)}
              onTick={() => act().toggle(file.path)}
              onOpen={() => useEditor.getState().openDiff(file.path, true)}
            />
          ))}
        </Section>

        <Section
          title={t("Changes")}
          count={unstaged.length}
          actionLabel={t("Stage all")}
          action={() => void act().stage(unstaged.map((file) => file.path))}
        >
          {unstaged.map((file) => (
            <FileRow
              key={`u:${file.path}`}
              file={file}
              staged={false}
              ticked={selected.has(file.path)}
              onTick={() => act().toggle(file.path)}
              onOpen={() => useEditor.getState().openDiff(file.path, false)}
            />
          ))}
        </Section>

        {}
        {selected.size > 0 && (
          <div className="wide-enter-fade sticky bottom-0 flex gap-1 border-t border-line bg-panel px-2 py-1.5">
            <button
              type="button"
              onClick={() => void act().stage([...selected])}
              className="flex flex-1 items-center justify-center gap-1 rounded-sm border border-line py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover"
            >
              <Plus className="size-3" strokeWidth={1.75} />
              {t("Stage")} ({selected.size})
            </button>
            <button
              type="button"
              onClick={() => void act().unstage([...selected])}
              className="flex flex-1 items-center justify-center gap-1 rounded-sm border border-line py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover"
            >
              <Minus className="size-3" strokeWidth={1.75} />
              {t("Unstage")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirmDiscard) {
                  void act().discard([...selected]);
                  setConfirmDiscard(false);
                } else {
                  setConfirmDiscard(true);
                }
              }}
              onMouseLeave={() => setConfirmDiscard(false)}
              title={t("Discard changes to the ticked files")}
              className={cn(
                "flex items-center justify-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition-colors duration-100",
                confirmDiscard
                  ? "border-rose-500/60 bg-rose-500/15 text-rose-300"
                  : "border-line text-fg-faint hover:bg-hover hover:text-rose-300",
              )}
            >
              <RotateCcw className="size-3" strokeWidth={1.75} />
              {confirmDiscard ? t("Sure?") : t("Discard")}
            </button>
          </div>
        )}

        {staged.length === 0 && unstaged.length === 0 && (
          <p className="px-2 py-3 text-[12px] text-fg-faint">{t("Nothing has changed.")}</p>
        )}

        {}
        {!status?.remote && (
          <div className="wide-enter-fade border-t border-line pb-2 pt-1">
            <Setup
              label={t("{provider} address", { provider: provider.name })}
              hint={t("The HTTPS or SSH address from your repository page.")}
              value={remoteUrl}
              onChange={setRemoteUrl}
              placeholder={provider.addressExample}
            />
            <button
              type="button"
              disabled={!remoteUrl.trim()}
              onClick={() => {
                void act().setRemote(remoteUrl.trim());
                setRemoteUrl("");
              }}
              className="mx-2 rounded-sm border border-line px-2 py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
            >
              {t("Set as origin")}
            </button>
          </div>
        )}

        {needsIdentity && (
          <div className="wide-enter-fade border-t border-line pb-2 pt-1">
            <p className="px-2 pt-1 text-[11px] leading-snug text-fg-dim">
              {t("Git does not know who you are yet. Set a name and email address.")}
            </p>
            <Setup label={t("Name")} value={identityName} onChange={setIdentityName} />
            <Setup
              label={t("Email")}
              hint={t("Use the address on your account. Many hosts also offer a no-reply address to keep your email out of commits.")}
              value={identityEmail}
              onChange={setIdentityEmail}
            />
            <button
              type="button"
              disabled={!identityName.trim() || !identityEmail.trim()}
              onClick={() => void act().setIdentity(identityName.trim(), identityEmail.trim())}
              className="mx-2 rounded-sm border border-line px-2 py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
            >
              {t("Save")}
            </button>
          </div>
        )}

        {}
        <div className="border-t border-line pb-2 pt-1">
          {signedIn ? (
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-dim">
                {t("Signed in as {name}", { name: username })}
              </span>
              <button
                type="button"
                onClick={() => void act().signOut()}
                className="shrink-0 rounded-sm border border-line px-2 py-0.5 text-[11px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
              >
                {t("Sign out")}
              </button>
            </div>
          ) : (
            <>
              <Setup
                label={t("{provider} username", { provider: provider.name })}
                value={signInUser}
                onChange={setSignInUser}
              />
              <Setup
                label={t("Access token")}
                secret
                hint={t(
                  "{provider} takes an access token where a password would go, and it is the only thing that works with two-factor authentication. Wide does not keep it — Git's credential manager does.",
                  { provider: provider.name },
                )}
                value={signInToken}
                onChange={setSignInToken}
              />
              <button
                type="button"
                disabled={!signInUser.trim() || !signInToken}
                onClick={() => {
                  void act()
                    .signIn(signInUser.trim(), signInToken)
                    .then(() => setSignInToken(""));
                }}
                className="mx-2 rounded-sm border border-line px-2 py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40"
              >
                {t("Sign in")}
              </button>
            </>
          )}
        </div>

        {commits.length > 0 && (
          <div className="border-t border-line pb-2">
            <p className="px-2 pb-0.5 pt-2 text-[10px] uppercase tracking-wide text-fg-faint">
              {t("History")}
            </p>
            {commits.map((commit) => (
              <div key={commit.hash} className="px-2 py-[3px]">
                <p className="truncate text-[12px] text-fg-dim" title={commit.subject}>
                  {commit.subject}
                </p>
                <p className="truncate text-[10px] text-fg-faint">
                  <code className="font-mono">{commit.hash}</code> · {commit.author} · {commit.when}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
