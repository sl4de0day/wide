import { useEffect, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { formatBytes } from "@/lib/utils";
import { useSettings } from "@/stores/settings";

interface Sample {
  fps: number;
  processMemory?: number;
  processCpu?: number;
  systemCpu?: number;
}

export function PerfOverlay() {
  const enabled = useSettings((state) => state.perfOverlay);
  const [sample, setSample] = useState<Sample>({ fps: 0 });
  const frames = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let stopped = false;

    const tick = () => {
      frames.current += 1;
      if (!stopped) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const timer = window.setInterval(async () => {
      const fps = frames.current;
      frames.current = 0;
      const counters = await bridge.perfSample().catch(() => ({ available: false }) as const);
      setSample({
        fps,
        processMemory: (counters as Record<string, number>).processMemory,
        processCpu: (counters as Record<string, number>).processCpu,
        systemCpu: (counters as Record<string, number>).systemCpu,
      });
    }, 1000);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none absolute right-3 top-11 z-40 rounded-md border border-line-strong bg-raised/90 px-3 py-2 font-mono text-[11px] text-fg-muted">
      <p>{sample.fps} fps</p>
      {sample.processCpu !== undefined && <p>cpu {sample.processCpu.toFixed(1)}%</p>}
      {sample.processMemory !== undefined && <p>mem {formatBytes(sample.processMemory)}</p>}
      {sample.systemCpu !== undefined && <p>sys {sample.systemCpu.toFixed(1)}%</p>}
    </div>
  );
}
