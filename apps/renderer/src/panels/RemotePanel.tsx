import { Pencil, Plug, PlugZap, Plus, TerminalSquare, Trash2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import { bridge, type RemoteProfile } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useRemote } from "@/stores/remote";
import { toast } from "@/stores/toast";

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
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RemoteProfile | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    void useRemote.getState().load();
  }, []);

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
              </div>
            );
          })
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
