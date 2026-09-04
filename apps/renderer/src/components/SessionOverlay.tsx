import { useEffect } from "react";

import { useT } from "@/lib/i18n";
import { useEditor } from "@/stores/editor";
import { useSession } from "@/stores/session";
import { useSettings } from "@/stores/settings";

export function SessionOverlay() {
  const resume = useSession((state) => state.resume);
  const trail = useSession((state) => state.trail);
  const dismiss = useSession((state) => state.dismissResume);
  const cursorTrail = useSettings((state) => state.cursorTrail);
  const revealAt = useEditor((state) => state.revealAt);
  const t = useT();

  useEffect(() => {
    if (!cursorTrail) return;
    const away = () => useSession.getState().markAway();
    const back = () => useSession.getState().markBack();
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    return () => {
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
    };
  }, [cursorTrail]);

  if (!resume || !cursorTrail) return null;

  const minutes = Math.round(resume.awayMs / 60_000);

  return (
    <div className="wide-enter absolute bottom-8 right-4 z-40 w-[320px] rounded-md border border-line-strong bg-raised p-3 shadow-xl">
      <p className="text-[12px] text-fg-bright">{t("Welcome back")}</p>
      <p className="pt-1 text-[11px] text-fg-muted">
        {t(minutes === 1 ? "Away for one minute. {summary}" : "Away for {minutes} minutes. {summary}", {
          minutes,
          summary: resume.summary,
        })}
      </p>

      {trail.length > 0 && (
        <div className="flex flex-col pt-2">
          {trail.map((entry) => (
            <button
              key={`${entry.path}:${entry.line}`}
              type="button"
              onClick={() => {
                void revealAt(entry.path, entry.line);
                dismiss();
              }}
              className="truncate rounded-sm px-2 py-1 text-left text-[11px] text-fg-dim transition-colors duration-100 hover:bg-hover hover:text-fg"
            >
              {t("{name} · line {line}", {
                name: entry.path.split("/").pop() ?? entry.path,
                line: entry.line,
              })}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={dismiss}
        className="mt-2 rounded-sm px-2 py-1 text-[11px] text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        {t("Dismiss")}
      </button>
    </div>
  );
}
