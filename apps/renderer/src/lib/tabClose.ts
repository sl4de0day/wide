import { t } from "@/lib/i18n";
import { confirm } from "@/stores/confirm";
import { useEditor, type Tab } from "@/stores/editor";

function isDirty(tab: Tab): boolean {
  return tab.kind === "file" && tab.content !== tab.savedContent;
}

async function confirmDiscard(count: number, name?: string): Promise<boolean> {
  const message =
    count === 1 && name
      ? t("“{name}” has unsaved changes that will be lost.", { name })
      : t("{count} tabs have unsaved changes that will be lost.", { count });
  return confirm({
    title: t("Close without saving?"),
    message,
    confirmLabel: t("Discard changes"),
    cancelLabel: t("Keep editing"),
    danger: true,
  });
}

export async function requestCloseTab(path: string): Promise<void> {
  const tab = useEditor.getState().tabs.find((x) => x.path === path);
  if (tab && isDirty(tab)) {
    if (!(await confirmDiscard(1, tab.name))) return;
  }
  useEditor.getState().closeTab(path);
}

export async function requestCloseOthers(path: string): Promise<void> {
  const dirty = useEditor.getState().tabs.filter((x) => x.path !== path && isDirty(x));
  if (dirty.length > 0) {
    if (!(await confirmDiscard(dirty.length, dirty[0].name))) return;
  }
  useEditor.getState().closeOthers(path);
}

export async function requestCloseRight(path: string): Promise<void> {
  const { tabs } = useEditor.getState();
  const idx = tabs.findIndex((x) => x.path === path);
  if (idx === -1) return;
  const dirty = tabs.slice(idx + 1).filter(isDirty);
  if (dirty.length > 0) {
    if (!(await confirmDiscard(dirty.length, dirty[0].name))) return;
  }
  useEditor.getState().closeRight(path);
}

export async function requestCloseAll(): Promise<void> {
  const dirty = useEditor.getState().tabs.filter(isDirty);
  if (dirty.length > 0) {
    if (!(await confirmDiscard(dirty.length, dirty[0].name))) return;
  }
  useEditor.getState().closeAll();
}
