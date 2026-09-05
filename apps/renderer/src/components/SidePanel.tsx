import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { loadDockSize, saveDockSize } from "@/lib/dockSize";
import { useT } from "@/lib/i18n";

const MIN_WIDTH = 160;
const MAX_WIDTH = 640;
const SIDE_KEY = "wide.dock.side.width";

export function SidePanel({
  children,
  defaultWidth = 260,
}: {
  children: ReactNode;
  defaultWidth?: number;
}) {

  const [width, setWidth] = useState(() =>
    Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, loadDockSize(SIDE_KEY, defaultWidth))),
  );
  const [dragging, setDragging] = useState(false);
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveDockSize(SIDE_KEY, width);
  }, [width]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const left = panelRef.current?.getBoundingClientRect().left ?? 0;
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX - left)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = previousCursor;
    };
  }, [dragging, onPointerMove]);

  return (
    <div ref={panelRef} className="relative flex shrink-0" style={{ width }}>
      <div className="wide-enter-side min-w-0 flex-1 overflow-hidden">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Resize panel")}
        onPointerDown={() => setDragging(true)}
        onDoubleClick={() => setWidth(defaultWidth)}
        className="w-px cursor-col-resize bg-line transition-colors duration-100 hover:bg-line-strong"
      />
    </div>
  );
}

const MIN_HEIGHT = 80;
const BOTTOM_KEY = "wide.dock.bottom.height";

export function BottomDock({
  children,
  hidden = false,
  defaultHeight = 260,
}: {
  children: ReactNode;

  hidden?: boolean;
  defaultHeight?: number;
}) {
  const t = useT();
  const [height, setHeight] = useState(() => Math.max(MIN_HEIGHT, loadDockSize(BOTTOM_KEY, defaultHeight)));
  const [dragging, setDragging] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveDockSize(BOTTOM_KEY, height);
  }, [height]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const bottom = dockRef.current?.getBoundingClientRect().bottom ?? 0;

    setHeight(Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 120, bottom - event.clientY)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "row-resize";
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = previousCursor;
    };
  }, [dragging, onPointerMove]);

  return (
    <div
      ref={dockRef}
      className="flex shrink-0 flex-col"
      style={hidden ? { height: 0, overflow: "hidden" } : { height }}
      aria-hidden={hidden || undefined}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("Resize panel")}
        onPointerDown={() => setDragging(true)}
        onDoubleClick={() => setHeight(defaultHeight)}
        className="h-px cursor-row-resize bg-line transition-colors duration-100 hover:bg-line-strong"
      />
      <div className="wide-enter min-h-0 flex-1 overflow-hidden bg-chrome">{children}</div>
    </div>
  );
}

export function PanelHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-line px-2 text-fg-muted"
      style={{ height: "var(--h-tabbar)" }}
    >
      <span className="truncate text-[11px] uppercase tracking-wide">{title}</span>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}

export const panelButtonClass =
  "flex size-5 shrink-0 items-center justify-center rounded-md text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:opacity-40";
