import { create } from "zustand";
import { bridge, type AiBrowserSessionState } from "@/lib/bridge";

export interface AiBrowserAction {
  id: string;
  action: string;
  url?: string;
  target?: string;
  timestamp: number;
}

export interface AiBrowserActionEvent {
  action: string;
  url?: string;
  title?: string;
  frame?: string;
  screenshot?: string;
  target?: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  proxyPort?: number;
  browserLabel?: string;
  installing?: boolean;
  status?: string;
  openPanel?: boolean;
  timestamp?: number;
}

export interface AiBrowserFrameEvent {
  url?: string;
  title?: string;
  loading?: boolean;
  screenshot?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  proxyPort?: number;
  browserLabel?: string;
}

export interface AiBrowserState {
  active: boolean;
  url: string;
  title: string;
  loading: boolean;
  lastAction: string;
  frame: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  proxyPort: number;
  browserLabel: string;
  installing: boolean;
  installStatus: string;
  takeover: boolean;
  history: AiBrowserAction[];
  status: "idle" | "launching" | "navigating" | "clicking" | "typing" | "extracting" | "ready";
  setTakeover: (on: boolean) => void;
  setInstallProgress: (status: string, installing: boolean) => void;
  syncSession: (session?: Partial<AiBrowserSessionState> | null) => void;
  recordAction: (event: AiBrowserActionEvent) => void;
  recordFrame: (event: AiBrowserFrameEvent) => void;
  clear: () => void;
}

function inferStatus(action: string, event?: { installing?: boolean; loading?: boolean }): AiBrowserState["status"] {
  if (event?.installing || action === "status") return "launching";
  if (action.includes("open")) return event?.loading ? "launching" : "ready";
  if (action.includes("navigate")) return event?.loading === false ? "ready" : "navigating";
  if (action.includes("click") || action.includes("hover") || action.includes("select")) return "clicking";
  if (action.includes("type") || action.includes("press")) return "typing";
  if (action.includes("extract") || action.includes("snapshot") || action.includes("eval")) return "extracting";
  return "ready";
}

export const useAiBrowser = create<AiBrowserState>((set) => ({
  active: false,
  url: "about:blank",
  title: "AI Browser Stream",
  loading: false,
  lastAction: "Idle",
  frame: null,
  canGoBack: false,
  canGoForward: false,
  proxyPort: 0,
  browserLabel: "",
  installing: false,
  installStatus: "",
  takeover: false,
  history: [],
  status: "idle",
  setTakeover: (on) => set({ takeover: on }),
  setInstallProgress: (status, installing) =>
    set({
      installStatus: status,
      installing,
      status: installing ? "launching" : "ready",
    }),
  syncSession: (session) =>
    set((state) => {
      if (!session) return state;
      return {
        active: typeof session.active === "boolean" ? session.active : state.active,
        url: session.url ?? state.url,
        title: session.title ?? state.title,
        loading: typeof session.loading === "boolean" ? session.loading : state.loading,
        frame: session.screenshot ? session.screenshot : state.frame,
        canGoBack: typeof session.canGoBack === "boolean" ? session.canGoBack : state.canGoBack,
        canGoForward: typeof session.canGoForward === "boolean" ? session.canGoForward : state.canGoForward,
        proxyPort: typeof session.proxyPort === "number" ? session.proxyPort : state.proxyPort,
        browserLabel: session.browserLabel ?? state.browserLabel,
        installing: typeof session.installing === "boolean" ? session.installing : state.installing,
        installStatus: session.installStatus ?? state.installStatus,
        lastAction: session.lastAction ?? state.lastAction,
      };
    }),
  recordAction: (event) =>
    set((state) => {
      const nextFrame =
        event.screenshot !== undefined && event.screenshot
          ? event.screenshot
          : event.frame !== undefined && event.frame
            ? event.frame
            : state.frame;
      const isStatusOnly = event.action === "status";
      const actionItem: AiBrowserAction | null = isStatusOnly
        ? null
        : {
            id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            action: event.action,
            url: event.url,
            target: event.target,
            timestamp: event.timestamp || Date.now(),
          };
      return {
        active: true,
        url: event.url || state.url,
        title: event.title || (event.url ? event.url : state.title),
        loading: typeof event.loading === "boolean" ? event.loading : state.loading,
        lastAction: isStatusOnly && event.status ? event.status : event.action,
        frame: nextFrame,
        canGoBack: typeof event.canGoBack === "boolean" ? event.canGoBack : state.canGoBack,
        canGoForward: typeof event.canGoForward === "boolean" ? event.canGoForward : state.canGoForward,
        proxyPort: typeof event.proxyPort === "number" ? event.proxyPort : state.proxyPort,
        browserLabel: event.browserLabel ?? state.browserLabel,
        installing: typeof event.installing === "boolean" ? event.installing : false,
        installStatus: typeof event.status === "string" ? event.status : state.installStatus,
        history: actionItem ? [actionItem, ...state.history].slice(0, 60) : state.history,
        status: inferStatus(event.action, event),
      };
    }),
  recordFrame: (event) =>
    set((state) => ({
      active: true,
      url: event.url || state.url,
      title: event.title || state.title,
      loading: typeof event.loading === "boolean" ? event.loading : state.loading,
      frame: event.screenshot ? event.screenshot : state.frame,
      canGoBack: typeof event.canGoBack === "boolean" ? event.canGoBack : state.canGoBack,
      canGoForward: typeof event.canGoForward === "boolean" ? event.canGoForward : state.canGoForward,
      proxyPort: typeof event.proxyPort === "number" ? event.proxyPort : state.proxyPort,
      browserLabel: event.browserLabel ?? state.browserLabel,
      installing: false,
      status: event.loading ? "navigating" : state.status === "idle" ? "ready" : state.status,
    })),
  clear: () =>
    set({
      active: false,
      url: "about:blank",
      title: "AI Browser Stream",
      loading: false,
      lastAction: "Session closed",
      frame: null,
      canGoBack: false,
      canGoForward: false,
      proxyPort: 0,
      installing: false,
      installStatus: "",
      takeover: false,
      history: [],
      status: "idle",
    }),
}));

export function mapViewportPoint(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  return {
    x: Math.max(0, Math.min(1280, Math.round(((clientX - rect.left) / w) * 1280))),
    y: Math.max(0, Math.min(800, Math.round(((clientY - rect.top) / h) * 800))),
  };
}

export function forwardBrowserMouse(
  type: "mousemove" | "mousedown" | "mouseup",
  rect: DOMRect,
  clientX: number,
  clientY: number,
  buttonIndex = 0,
  clickCount = 1,
): void {
  const pt = mapViewportPoint(rect, clientX, clientY);
  const button = buttonIndex === 2 ? "right" : buttonIndex === 1 ? "middle" : "left";
  void bridge.aiBrowserInput({ type, x: pt.x, y: pt.y, button, clickCount });
}

export function forwardBrowserKey(key: string, ctrlKey: boolean, altKey: boolean, metaKey: boolean): void {
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return;
  if (key.length === 1 && !ctrlKey && !altKey && !metaKey) {
    void bridge.aiBrowserInput({ type: "text", text: key });
    return;
  }
  const mods: string[] = [];
  if (ctrlKey) mods.push("Control");
  if (altKey) mods.push("Alt");
  if (metaKey) mods.push("Meta");
  const combo = mods.length > 0 ? `${mods.join("+")}+${key.length === 1 ? key.toLowerCase() : key}` : key;
  void bridge.aiBrowserInput({ type: "press", key: combo });
}

