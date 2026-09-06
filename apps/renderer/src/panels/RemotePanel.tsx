import { ChevronDown, ChevronRight, Container, FilePlus, FileText, Folder, FolderPlus, FolderTree, Pencil, Plug, PlugZap, Plus, Search, TerminalSquare, Trash2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import { bridge, type RemoteProfile } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { confirm } from "@/stores/confirm";
import { useEditor, remoteTabPath } from "@/stores/editor";
import { promptText } from "@/stores/prompt";
import { useRemote } from "@/stores/remote";
import { toast } from "@/stores/toast";

const dirJoin = (path: string, child: string) => (path.endsWith("/") ? path + child : path + "/" + child);

function RemoteDir({ profile, path, name, depth }: { profile: RemoteProfile; path: string; name: string; depth: number }) {
  const t = useT();
  const [open, setOpen] = useState(depth === 0);
  const [entries, setEntries] = useState<{ name: string; dir: boolean }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    void bridge.remoteListDir(profile, path).then((reply) => {
      if (!alive) return;
      setLoading(false);
      if (reply.ok) setEntries(reply.entries ?? []);
      else setError(reply.error ?? t("Could not list that directory."));
    });
    return () => {
      alive = false;
    };
  }, [open, profile, path, t, nonce]);

  const reload = () => setNonce((n) => n + 1);

  const newFile = async () => {
    const child = await promptText({ title: t("New file"), placeholder: t("name.ext") });
    if (!child) return;
    const reply = await bridge.remoteNewFile(profile, dirJoin(path, child.trim()));
    if (reply.ok) {
      setOpen(true);
      reload();
    } else toast.error(reply.error ? t(reply.error) : t("Could not create the file."));
  };

  const newFolder = async () => {
    const child = await promptText({ title: t("New folder"), placeholder: t("name") });
    if (!child) return;
    const reply = await bridge.remoteMkdir(profile, dirJoin(path, child.trim()));
    if (reply.ok) {
      setOpen(true);
      reload();
    } else toast.error(reply.error ? t(reply.error) : t("Could not create the directory."));
  };

  const renameEntry = async (child: string) => {
    const next = await promptText({ title: t("Rename"), label: child, placeholder: child });
    if (!next || next.trim() === child) return;
    const reply = await bridge.remoteRename(profile, dirJoin(path, child), dirJoin(path, next.trim()));
    if (reply.ok) reload();
    else toast.error(reply.error ? t(reply.error) : t("Could not rename that path."));
  };

  const deleteEntry = async (child: string) => {
    const ok = await confirm({ title: t("Delete {name}?", { name: child }), message: t("This permanently deletes it on the remote host."), confirmLabel: t("Delete"), danger: true });
    if (!ok) return;
    const reply = await bridge.remoteDelete(profile, dirJoin(path, child));
    if (reply.ok) reload();
    else toast.error(reply.error ? t(reply.error) : t("Could not delete that path."));
  };

  const iconBtn = "shrink-0 rounded-sm p-0.5 text-fg-faint opacity-0 transition-all duration-100 hover:bg-hover hover:text-fg group-hover:opacity-100";

  return (
    <div>
      <div className="group flex items-center gap-1 pr-1" style={{ paddingLeft: depth * 10 + 8 }}>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-[12px] text-fg-dim transition-colors duration-100 hover:text-fg">
          {open ? <ChevronDown className="size-3 shrink-0 text-fg-faint" strokeWidth={2} /> : <ChevronRight className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />}
          <Folder className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
          <span className="truncate">{name}</span>
        </button>
        <button type="button" onClick={() => void newFile()} title={t("New file")} aria-label={t("New file")} className={iconBtn}>
          <FilePlus className="size-3" strokeWidth={1.75} />
        </button>
        <button type="button" onClick={() => void newFolder()} title={t("New folder")} aria-label={t("New folder")} className={iconBtn}>
          <FolderPlus className="size-3" strokeWidth={1.75} />
        </button>
      </div>
      {open && (
        <div>
          {loading && !entries && <p className="py-0.5 text-[10px] text-fg-faint" style={{ paddingLeft: depth * 10 + 26 }}>{t("Loading…")}</p>}
          {error && <p className="py-0.5 text-[10px] text-status-error" style={{ paddingLeft: depth * 10 + 26 }}>{t(error)}</p>}
          {entries?.map((entry) =>
            entry.dir ? (
              <div key={entry.name} className="group/entry flex items-center">
                <div className="min-w-0 flex-1">
                  <RemoteDir profile={profile} path={dirJoin(path, entry.name)} name={entry.name} depth={depth + 1} />
                </div>
              </div>
            ) : (
              <div key={entry.name} className="group flex items-center gap-1 pr-1" style={{ paddingLeft: (depth + 1) * 10 + 8 }}>
                <button
                  type="button"
                  onClick={() => void useEditor.getState().openFile(remoteTabPath(profile.id, dirJoin(path, entry.name)))}
                  className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-[12px] text-fg-dim transition-colors duration-100 hover:text-fg"
                >
                  <FileText className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />
                  <span className="truncate">{entry.name}</span>
                </button>
                <button type="button" onClick={() => void renameEntry(entry.name)} title={t("Rename")} aria-label={t("Rename")} className={iconBtn}>
                  <Pencil className="size-3" strokeWidth={1.75} />
                </button>
                <button type="button" onClick={() => void deleteEntry(entry.name)} title={t("Remove")} aria-label={t("Remove")} className={iconBtn}>
                  <Trash2 className="size-3" strokeWidth={1.75} />
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function RemoteSearch({ profile }: { profile: RemoteProfile }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ file: string; line: number; text: string }[] | null>(null);

  const run = async () => {
    if (!query.trim() || busy) return;
    setBusy(true);
    const reply = await bridge.remoteGrep(profile, profile.cwd || ".", query.trim());
    setBusy(false);
    if (reply.ok) setResults(reply.matches ?? []);
    else {
      setResults([]);
      toast.error(reply.error ? t(reply.error) : t("The remote search failed."));
    }
  };

  return (
    <div className="border-b border-line px-2 py-1.5">
      <div className="flex items-center gap-1">
        <Search className="size-3 shrink-0 text-fg-faint" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()}
          placeholder={t("Search the remote host…")}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-2 py-0.5 font-mono text-[11px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
        />
      </div>
      {results && (
        <div className="mt-1 max-h-48 overflow-auto">
          {results.length === 0 ? (
            <p className="py-1 text-[10px] text-fg-faint">{busy ? t("Searching…") : t("No matches.")}</p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.file}:${r.line}:${i}`}
                type="button"
                onClick={() => void useEditor.getState().revealAt(remoteTabPath(profile.id, r.file), r.line)}
                className="flex w-full items-baseline gap-1 py-0.5 text-left transition-colors duration-100 hover:bg-hover"
                title={`${r.file}:${r.line}`}
              >
                <span className="shrink-0 font-mono text-[10px] text-fg-faint">{(r.file.split("/").pop() || r.file)}:{r.line}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg-dim">{r.text.trim()}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const field =
  "w-full rounded-sm border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none transition-colors duration-100 focus:border-accent placeholder:text-fg-faint";

function ProfileForm({ initial, onClose }: { initial: RemoteProfile | null; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [user, setUser] = useState(initial?.user ?? "");
  const [keyPath, setKeyPath] = useState(initial?.keyPath ?? "");
  const [cwd, setCwd] = useState(initial?.cwd ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!host.trim() || busy) return;
    setBusy(true);
    const saved = await useRemote.getState().save({
      id: initial?.id,
      name: name.trim(),
      host: host.trim(),
      port: Number(port) || 22,
      user: user.trim(),
      keyPath: keyPath.trim(),
      cwd: cwd.trim(),
    });
    setBusy(false);
    if (saved) onClose();
    else toast.error(t("Could not save the remote profile."));
  };

  return (
    <div className="wide-enter-fade shrink-0 border-b border-line px-2 py-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Name (optional)")} className={field} spellCheck={false} />
      <div className="mt-1 flex gap-1">
        <input value={host} onChange={(e) => setHost(e.target.value)} placeholder={t("Host")} className={cn(field, "flex-1")} spellCheck={false} />
        <input value={port} onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))} placeholder={t("Port")} className={cn(field, "w-16")} spellCheck={false} />
      </div>
      <input value={user} onChange={(e) => setUser(e.target.value)} placeholder={t("User")} className={cn(field, "mt-1")} spellCheck={false} />
      <input value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder={t("Private key path (optional)")} className={cn(field, "mt-1 font-mono")} spellCheck={false} />
      <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={t("Start directory (optional)")} className={cn(field, "mt-1 font-mono")} spellCheck={false} />
      <div className="mt-1 flex gap-1">
        <button type="button" onClick={() => void submit()} disabled={!host.trim() || busy} className="flex-1 rounded-sm border border-line py-1 text-[11px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-40">
          {t("Save")}
        </button>
        <button type="button" onClick={onClose} className="rounded-sm border border-line px-2 py-1 text-[11px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

export function RemotePanel({ onOpenPanel }: { onOpenPanel?: (id: string) => void }) {
  const t = useT();
  const profiles = useRemote((state) => state.profiles);
  const activeId = useRemote((state) => state.activeId);
  const containers = useRemote((state) => state.containers);
  const activeContainer = useRemote((state) => state.activeContainer);
  const dockerError = useRemote((state) => state.dockerError);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RemoteProfile | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [browsingId, setBrowsingId] = useState<string | null>(null);
  const [showContainers, setShowContainers] = useState(false);

  useEffect(() => {
    void useRemote.getState().load();
  }, []);

  useEffect(() => {
    if (showContainers) void useRemote.getState().loadContainers();
  }, [showContainers]);

  const test = async (profile: RemoteProfile) => {
    setTesting(profile.id);
    const reply = await bridge.remoteTest(profile);
    setTesting(null);
    if (reply.ok) toast.success(t("Connected to {host}.", { host: profile.host }));
    else toast.error(reply.error ? t(reply.error) : t("The connection failed."));
  };

  const activate = (profile: RemoteProfile) => {
    const next = activeId === profile.id ? null : profile.id;
    useRemote.getState().setActive(next);
    if (next) onOpenPanel?.("terminal");
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("Remote")}>
        <span className="flex-1" />
        <button type="button" onClick={() => { setEditing(null); setAdding((v) => !v); }} title={t("Add a remote host")} aria-label={t("Add a remote host")} className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
          <Plus className="size-3.5" strokeWidth={1.5} />
        </button>
      </PanelHeader>

      {(adding || editing) && <ProfileForm initial={editing} onClose={() => { setAdding(false); setEditing(null); }} />}

      {activeId && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-accent/10 px-3 py-1.5">
          <PlugZap className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-dim">{t("Terminal runs on the active host.")}</span>
          <button type="button" onClick={() => onOpenPanel?.("terminal")} className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg">
            {t("Terminal")}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {profiles.length === 0 ? (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-fg-faint">
            {t("No remote hosts yet. Add an SSH host to open a remote terminal and run commands over the connection.")}
          </p>
        ) : (
          profiles.map((profile) => {
            const on = activeId === profile.id;
            return (
              <div key={profile.id} className="border-b border-line px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => activate(profile)} title={on ? t("Disconnect") : t("Make active")} aria-label={on ? t("Disconnect") : t("Make active")} className={cn("shrink-0 rounded-sm p-0.5 transition-colors duration-100 hover:bg-hover", on ? "text-accent" : "text-fg-faint hover:text-fg")}>
                    {on ? <PlugZap className="size-3.5" strokeWidth={1.75} /> : <Plug className="size-3.5" strokeWidth={1.75} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-fg">{profile.name || profile.host}</p>
                    <p className="truncate font-mono text-[10px] text-fg-faint">{profile.user ? `${profile.user}@` : ""}{profile.host}{profile.port !== 22 ? `:${profile.port}` : ""}</p>
                  </div>
                  <button type="button" onClick={() => setBrowsingId((v) => (v === profile.id ? null : profile.id))} aria-pressed={browsingId === profile.id} title={t("Browse files")} aria-label={t("Browse files")} className={cn("shrink-0 rounded-sm p-0.5 transition-colors duration-100 hover:bg-hover hover:text-fg", browsingId === profile.id ? "text-fg" : "text-fg-faint")}>
                    <FolderTree className="size-3.5" strokeWidth={1.75} />
                  </button>
                  <button type="button" onClick={() => void test(profile)} disabled={testing === profile.id} title={t("Test connection")} aria-label={t("Test connection")} className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40">
                    <Wifi className="size-3.5" strokeWidth={1.75} />
                  </button>
                  <button type="button" onClick={() => { setAdding(false); setEditing(profile); }} title={t("Edit")} aria-label={t("Edit")} className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
                    <Pencil className="size-3.5" strokeWidth={1.75} />
                  </button>
                  <button type="button" onClick={() => void useRemote.getState().remove(profile.id)} title={t("Remove")} aria-label={t("Remove")} className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-rose-300">
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </button>
                </div>
                {browsingId === profile.id && (
                  <div className="mt-1 border-t border-line pt-1">
                    <RemoteSearch profile={profile} />
                    <RemoteDir profile={profile} path={profile.cwd || "."} name={profile.cwd || t("Home")} depth={0} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0 border-t border-line">
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button type="button" onClick={() => setShowContainers((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1 text-left text-[10px] uppercase tracking-wide text-fg-faint transition-colors duration-100 hover:text-fg">
            {showContainers ? <ChevronDown className="size-3 shrink-0" strokeWidth={2} /> : <ChevronRight className="size-3 shrink-0" strokeWidth={2} />}
            <Container className="size-3 shrink-0" strokeWidth={1.75} />
            {t("Docker containers")}
          </button>
          {showContainers && (
            <button type="button" onClick={() => void useRemote.getState().loadContainers()} title={t("Refresh containers")} aria-label={t("Refresh containers")} className="shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg">
              <Wifi className="size-3" strokeWidth={1.75} />
            </button>
          )}
        </div>
        {showContainers && (
          <div className="max-h-40 overflow-auto pb-1">
            {dockerError ? (
              <p className="px-3 pb-1 text-[10px] text-fg-faint">{t(dockerError)}</p>
            ) : containers.length === 0 ? (
              <p className="px-3 pb-1 text-[10px] text-fg-faint">{t("No running containers.")}</p>
            ) : (
              containers.map((c) => {
                const on = activeContainer === c.id;
                return (
                  <div key={c.id} className="flex items-center gap-2 px-2 py-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const next = on ? null : c.id;
                        useRemote.getState().setActiveContainer(next);
                        if (next) onOpenPanel?.("terminal");
                      }}
                      title={on ? t("Disconnect") : t("Open a terminal in this container")}
                      aria-label={on ? t("Disconnect") : t("Open a terminal in this container")}
                      className={cn("shrink-0 rounded-sm p-0.5 transition-colors duration-100 hover:bg-hover", on ? "text-accent" : "text-fg-faint hover:text-fg")}
                    >
                      {on ? <PlugZap className="size-3.5" strokeWidth={1.75} /> : <TerminalSquare className="size-3.5" strokeWidth={1.75} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-fg">{c.name}</p>
                      <p className="truncate font-mono text-[10px] text-fg-faint">{c.image}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-3 py-1.5">
        <p className="flex items-center gap-1.5 text-[10px] text-fg-faint">
          <TerminalSquare className="size-3 shrink-0" strokeWidth={1.75} />
          {t("Uses the system SSH client and your keys.")}
        </p>
      </div>
    </div>
  );
}
