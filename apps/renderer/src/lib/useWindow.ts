import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface WindowRange {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

export function useWindowedRows(
  scrollRef: RefObject<HTMLElement | null>,
  count: number,
  estimate: number,
  overscan = 10,
): WindowRange {
  const [rowHeight, setRowHeight] = useState(estimate);
  const [range, setRange] = useState<WindowRange>({
    start: 0,
    end: Math.min(count, Math.ceil(600 / estimate) + overscan),
    padTop: 0,
    padBottom: 0,
  });
  const frame = useRef(0);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const row = element?.querySelector<HTMLElement>("[data-vrow]");
    if (row) {
      const measured = row.offsetHeight;
      if (measured > 0 && Math.abs(measured - rowHeight) > 0.5) setRowHeight(measured);
    }
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const compute = () => {
      const height = element.clientHeight || 1;
      const top = element.scrollTop;
      const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
      const visible = Math.ceil(height / rowHeight) + overscan * 2;
      const last = Math.min(count, first + visible);
      setRange({
        start: first,
        end: last,
        padTop: first * rowHeight,
        padBottom: Math.max(0, (count - last) * rowHeight),
      });
    };
    compute();
    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        compute();
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [scrollRef, count, rowHeight, overscan]);

  return range;
}
