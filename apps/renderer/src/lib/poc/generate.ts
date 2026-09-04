import { bridge } from "@/lib/bridge";
import { copyText } from "@/lib/utils";
import { useWorkspace } from "@/stores/workspace";

import { buildClickjackingPoc } from "./clickjacking";
import { buildCsrfPoc } from "./csrf";

let seq = 0;

async function save(name: string, html: string): Promise<{ path: string | null }> {
  const root = useWorkspace.getState().root;
  if (!root) {
    void copyText(html);
    return { path: null };
  }
  const path = `${root}/.wide/poc/${name}`;
  await bridge.writeFile(path, html);
  void bridge.reveal(path);
  return { path };
}

export async function csrfPocFromRequest(requestText: string): Promise<{ path: string | null } | null> {
  const poc = buildCsrfPoc(requestText);
  if (!poc) return null;
  return save(`csrf-${(seq += 1)}.html`, poc.html);
}

export async function clickjackingPocForUrl(url: string): Promise<{ path: string | null }> {
  return save(`clickjacking-${(seq += 1)}.html`, buildClickjackingPoc(url));
}
