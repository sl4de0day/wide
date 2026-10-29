import { getActiveEditorView } from "@/editor/activeView";
import {
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  hexDecode,
  hexEncode,
  htmlDecode,
  htmlEncode,
  md5Hex,
  urlDecode,
  urlEncode,
} from "@/lib/codec";
import { toast } from "@/stores/toast";

export interface TransformAction {
  id: string;
  name: string;
  run: (input: string) => string;
}

export const TRANSFORMS_LIST: TransformAction[] = [
  { id: "urle", name: "URL Encode", run: urlEncode },
  { id: "urld", name: "URL Decode", run: urlDecode },
  { id: "b64e", name: "Base64 Encode", run: base64Encode },
  { id: "b64d", name: "Base64 Decode", run: base64Decode },
  { id: "b64ue", name: "Base64URL Encode", run: base64UrlEncode },
  { id: "b64ud", name: "Base64URL Decode", run: base64UrlDecode },
  { id: "hexe", name: "Hex Encode", run: hexEncode },
  { id: "hexd", name: "Hex Decode", run: hexDecode },
  { id: "htmle", name: "HTML Entity Encode", run: htmlEncode },
  { id: "htmld", name: "HTML Entity Decode", run: htmlDecode },
  { id: "md5", name: "MD5 Hash", run: md5Hex },
  { id: "lower", name: "To Lowercase", run: (s) => s.toLowerCase() },
  { id: "upper", name: "To Uppercase", run: (s) => s.toUpperCase() },
];

export function getSelectedTextAndHandler(): {
  text: string;
  apply: (transformed: string) => void;
} | null {
  const view = getActiveEditorView();
  if (view) {
    const sel = view.state.selection.main;
    if (!sel.empty) {
      const text = view.state.sliceDoc(sel.from, sel.to);
      return {
        text,
        apply: (transformed: string) => {
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: transformed },
            selection: { anchor: sel.from, head: sel.from + transformed.length },
          });
          view.focus();
        },
      };
    }
  }

  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== null && end !== null && start !== end) {
      const text = el.value.substring(start, end);
      return {
        text,
        apply: (transformed: string) => {
          el.setRangeText(transformed, start, end, "select");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.focus();
        },
      };
    }
  }

  return null;
}

export function transformSelection(transform: (text: string) => string): boolean {
  const target = getSelectedTextAndHandler();
  if (!target) {
    toast.info("Select text in the editor or input field first.");
    return false;
  }

  try {
    const result = transform(target.text);
    target.apply(result);
    return true;
  } catch (err) {
    toast.error("Transformation failed: " + (err instanceof Error ? err.message : String(err)));
    return false;
  }
}

