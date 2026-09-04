import { ChevronDown, ChevronRight, MessageSquarePlus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PanelHeader } from "@/components/SidePanel";
import type { AiSessionMeta } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AI_CHAT_PATH, useEditor } from "@/stores/editor";
import { useAi } from "@/stores/ai";
import { useWorkspace } from "@/stores/workspace";

function useWhen(): (at: number) => string {
  const t = useT();
  return useMemo(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 86_400_000;
    return (at: number) => {
      if (!at) return t("Earlier");
      if (at >= midnight) return t("Today");
      if (at >= midnight - day) return t("Yesterday");
      if (at >= midnight - 7 * day) return t("This week");
      if (at >= midnight - 30 * day) return t("This month");
      return t("Earlier");
    };
  }, [t]);
}

const clock = (at: number) => {
  if (!at) return "";
  const when = new Date(at);
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
};

function SessionRow({ session, open }: { session: AiSessionMeta; open: boolean }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const turns = useAi((state) => (expanded ? state.chats[session.id]?.turns : undefined));
  const loaded = useAi((state) => (expanded ? state.chats[session.id]?.loaded === true : false));
  const questions = useMemo(
    () => (turns ?? []).filter((turn) => turn.role === "user"),
    [turns],
  );

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) void useAi.getState().openChat(session.id);
  };

  return (
    <div>
    <div
      className={cn(
        "group relative flex items-center gap-2 border-b border-line px-3 py-2",
        open && "bg-selected",
      )}
    >
      {

}
      <button
        type="button"
        onClick={() => useEditor.getState().openAiChat(session.id, session.title || t("New conversation"))}
        aria-label={session.title || t("New conversation")}
        className="absolute inset-0 z-0 w-full transition-colors duration-100 hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {
}
      <button
        type="button"
        onClick={toggle}
        title={expanded ? t("Hide the questions") : t("Show the questions")}
        aria-label={expanded ? t("Hide the questions") : t("Show the questions")}
        className="relative z-10 -ml-1 shrink-0 rounded-sm p-0.5 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        {expanded ? (
          <ChevronDown className="size-3" strokeWidth={2} />
        ) : (
          <ChevronRight className="size-3" strokeWidth={2} />
        )}
      </button>
      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
        <span className="block truncate text-[12px] text-fg">
          {session.title || t("New conversation")}
        </span>
        <span className="block pt-0.5 text-[10px] text-fg-faint">
          {clock(session.updatedAt)}
          {session.count > 0 && ` · ${t("{count} messages", { count: session.count })}`}
        </span>
      </div>

      {

}
      <button
        type="button"
        onClick={() =>
          confirming ? void useAi.getState().deleteSession(session.id) : setConfirming(true)
        }
        onBlur={() => setConfirming(false)}
        title={confirming ? t("Delete for good") : t("Delete this conversation")}
        aria-label={confirming ? t("Delete for good") : t("Delete this conversation")}
        className={cn(
          "relative z-10 shrink-0 rounded-sm p-1 transition-colors duration-100",
          confirming
            ? "bg-status-error/15 text-status-error"
            : "text-fg-faint opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <Trash2 className="size-3.5" strokeWidth={1.5} />
      </button>
    </div>

      {expanded && (
        <div className="wide-enter-fade border-b border-line bg-panel/40">
          {!loaded ? (
            <p className="px-3 py-1.5 pl-8 text-[11px] text-fg-faint">{t("Reading…")}</p>
          ) : questions.length === 0 ? (
            <p className="px-3 py-1.5 pl-8 text-[11px] text-fg-faint">{t("Nothing asked yet.")}</p>
          ) : (
            questions.map((question, index) => (
              <button
                key={question.id}
                type="button"

                onClick={() => {
                  useEditor
                    .getState()
                    .openAiChat(session.id, session.title || t("New conversation"));
                  useAi.setState({ revealTurn: { session: session.id, index } });
                }}
                title={question.text}
                className="flex w-full items-start gap-2 px-3 py-1 pl-8 text-left transition-colors duration-100 hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-dim">
                  {question.text}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function AiPanel() {
  const t = useT();
  const when = useWhen();
  const root = useWorkspace((state) => state.root);
  const sessions = useAi((state) => state.sessions);
  const tabs = useEditor((state) => state.tabs);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void useAi.getState().load();
  }, [root]);

  const openIds = useMemo(
    () =>
      new Set(
        tabs
          .filter((tab) => tab.kind === "ai-chat")
          .map((tab) => tab.path.slice(AI_CHAT_PATH.length)),
      ),
    [tabs],
  );

  const shown = useMemo(() => {
    const raw = query.trim().toLowerCase();
    if (!raw) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(raw));
  }, [sessions, query]);

  const groups = useMemo(() => {
    const out: { label: string; rows: AiSessionMeta[] }[] = [];
    for (const session of shown) {
      const label = when(session.updatedAt || session.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(session);
      else out.push({ label, rows: [session] });
    }
    return out;
  }, [shown, when]);

  const start = async () => {
    const id = await useAi.getState().newSession();
    if (id) useEditor.getState().openAiChat(id, t("New conversation"));
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t("AI Assistant")}>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void start()}
          disabled={!root}
          title={t("New conversation")}
          aria-label={t("New conversation")}
          className="rounded-sm p-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <MessageSquarePlus className="size-3.5" strokeWidth={1.5} />
        </button>
      </PanelHeader>

      {}
      {sessions.length > 6 && (
        <div className="shrink-0 border-b border-line px-2 py-2">
          <div className="flex items-center gap-1 rounded-md border border-line bg-panel px-2">
            <Search className="size-3 shrink-0 text-fg-faint" strokeWidth={1.5} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search conversations")}
              aria-label={t("Search conversations")}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint"
            />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {!root ? (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-fg-faint">
            {t("Open a folder first.")}
          </p>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-4">
            <p className="text-[12px] leading-relaxed text-fg-faint">
              {t("No conversations yet. Start one and it will be kept here.")}
            </p>
            <button
              type="button"
              onClick={() => void start()}
              className="mt-2 rounded-md border border-accent px-2.5 py-1 text-[11px] text-accent transition-colors duration-100 hover:bg-accent hover:text-bg"
            >
              {t("New conversation")}
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-fg-faint">{t("Nothing matched that.")}</p>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1 pt-2.5 text-[10px] uppercase tracking-wide text-fg-faint">
                {group.label}
              </p>
              {group.rows.map((session) => (
                <SessionRow key={session.id} session={session} open={openIds.has(session.id)} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
