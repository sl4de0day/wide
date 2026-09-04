import { create } from "zustand";

import { bridge, type HttpResponse } from "@/lib/bridge";
import type { HttpRequest } from "@/editor/features/httpFile";

interface HttpState {
  request: HttpRequest | null;
  response: HttpResponse | null;
  sending: boolean;

  sentAt: number | null;

  send(request: HttpRequest): Promise<void>;
  clear(): void;
}

export const useHttp = create<HttpState>((set) => ({
  request: null,
  response: null,
  sending: false,
  sentAt: null,

  send: async (request) => {
    set({ request, response: null, sending: true, sentAt: Date.now() });
    let response: HttpResponse;
    try {
      response = await bridge.httpSend(request.url, request.method, request.headers, request.body);
    } catch (error) {

      response = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    set({ response, sending: false });
  },

  clear: () => set({ request: null, response: null, sending: false, sentAt: null }),
}));
