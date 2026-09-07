import { selectedText } from "@/editor/activeView";
import { t } from "@/lib/i18n";
import { basename, extname } from "@/lib/utils";
import { useAi } from "@/stores/ai";
import { AI_CHAT_PATH, useEditor } from "@/stores/editor";
import { toast } from "@/stores/toast";

export async function sendSelectionToChat(prefix = ""): Promise<void> {
  const code = selectedText();
  if (!code.trim()) {
    toast.error(t("Select some code first."));
    return;
  }

  const editor = useEditor.getState();
  const path = editor.lastFilePath ?? "";
  const language = path ? extname(path).replace(/^\./, "") : "";

  const existing = editor.tabs.find((tab) => tab.path.startsWith(AI_CHAT_PATH));
  let id = existing ? existing.path.slice(AI_CHAT_PATH.length) : "";
  if (id) {
    editor.openAiChat(id, existing?.name ?? t("New conversation"));
  } else {
    id = await useAi.getState().newSession();
    if (!id) return;
    useEditor.getState().openAiChat(id, t("New conversation"));
  }

  const where = path ? `${basename(path)}\n` : "";
  const body = `${where}\`\`\`${language}\n${code}\n\`\`\``;
  useAi.getState().setPendingDraft(id, prefix ? `${prefix}\n\n${body}` : body);
}
