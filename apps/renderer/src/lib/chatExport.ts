import { bridge } from "@/lib/bridge";
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/utils";
import { useAi } from "@/stores/ai";
import { AI_CHAT_PATH, useEditor } from "@/stores/editor";
import { toast } from "@/stores/toast";
import { useWorkspace } from "@/stores/workspace";

export function activeChatId(): string {
  const path = useEditor.getState().activePath ?? "";
  return path.startsWith(AI_CHAT_PATH) ? path.slice(AI_CHAT_PATH.length) : "";
}

export function conversationMarkdown(sessionId: string): string {
  const chat = useAi.getState().chats[sessionId];
  if (!chat) return "";
  const parts: string[] = [];
  for (const turn of chat.turns) {
    const text = turn.text.trim();
    if (!text) continue;
    parts.push(`## ${turn.role === "user" ? t("You") : t("Assistant")}`, "", text, "");
  }
  const body = parts.join("\n").trim();
  return body ? `${body}\n\n---\n\n_${t("Generated with Wide")}_\n` : "";
}

export async function copyConversation(): Promise<void> {
  const id = activeChatId();
  const markdown = id ? conversationMarkdown(id) : "";
  if (!markdown) {
    toast.error(t("There is no conversation to copy."));
    return;
  }
  if (await copyText(markdown)) toast.success(t("Conversation copied to the clipboard."));
  else toast.error(t("The conversation could not be copied."));
}

export async function exportConversation(): Promise<void> {
  const id = activeChatId();
  const markdown = id ? conversationMarkdown(id) : "";
  if (!markdown) {
    toast.error(t("There is no conversation to export."));
    return;
  }
  const root = useWorkspace.getState().root;
  if (!root) {
    toast.error(t("Open a folder first."));
    return;
  }
  const separator = root.includes("\\") ? "\\" : "/";
  const target = `${root.replace(/[\\/]+$/, "")}${separator}wide-conversation.md`;
  const written = await bridge.writeFile(target, markdown);
  if (written.error) {
    toast.error(t(written.error));
    return;
  }
  await useEditor.getState().openFile(target);
  toast.success(t("Conversation saved to wide-conversation.md."));
}
