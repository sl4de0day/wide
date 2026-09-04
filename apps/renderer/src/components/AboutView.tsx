import { Download, Github, RefreshCw } from "lucide-react";
import { useEffect } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useUpdate } from "@/stores/update";
import logo from "@/assets/wide-logo.png";

const REPO_URL = "https://github.com/sl4de0day/wide";
const DESCRIPTION =
  "Wide is an IDE that unifies web development and web security in a single ecosystem. It detects vulnerabilities in real time as you code, enabling secure development from line one, while providing built-in tools to execute full-scale, professional web penetration tests. Whether you are a web pentester, bug bounty hunter, or web developer, Wide is the only tool you need.";

export function AboutView() {
  const t = useT();
  const current = useUpdate((s) => s.current);
  const checking = useUpdate((s) => s.checking);
  const available = useUpdate((s) => s.available);
  const latest = useUpdate((s) => s.latest);
  const installing = useUpdate((s) => s.installing);
  const error = useUpdate((s) => s.error);

  useEffect(() => {
    if (!current) void useUpdate.getState().check();
  }, [current]);

  const button =
    "flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-[12px] text-fg transition-colors duration-100 hover:bg-hover disabled:opacity-50";

  return (
    <div className="h-full overflow-auto bg-canvas">
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-6 px-6 py-14">
        <img src={logo} alt="Wide" width={96} height={96} className="size-24 select-none" draggable={false} />
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-[28px] font-semibold leading-none text-fg-bright">{t("Wide")}</h1>
          <p className="text-[13px] italic text-fg-muted">{t("The IDE for building and testing the web")}</p>
        </div>

        <p className="text-center text-[13px] leading-relaxed text-fg-dim">{DESCRIPTION}</p>

        <div className="flex w-full flex-col divide-y divide-line rounded-md border border-line">
          <Line label={t("Version")} value={current || "…"} />
          <Line label={t("Maker")} value="sl4de" />
          <Line label={t("License")} value="GPLv3" />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" className={button} onClick={() => void bridge.openExternal(REPO_URL)}>
            <Github className="size-4" strokeWidth={1.75} />
            {t("GitHub repository")}
          </button>
          <button type="button" className={button} disabled={checking || installing !== "idle"} onClick={() => void useUpdate.getState().check()}>
            <RefreshCw className={cn("size-4", checking && "animate-spin")} strokeWidth={1.75} />
            {checking ? t("Checking…") : t("Check for updates")}
          </button>
          {available && (
            <button type="button" className={button} disabled={installing !== "idle"} onClick={() => void useUpdate.getState().install()}>
              <Download className={cn("size-4", installing !== "idle" && "wide-pulse")} strokeWidth={1.75} />
              {installing === "download"
                ? t("Downloading…")
                : installing === "install"
                  ? t("Installing…")
                  : t("Install {version}", { version: latest })}
            </button>
          )}
        </div>

        {error && <p className="text-[11px] text-status-error">{error}</p>}
        {!available && !checking && current && <p className="text-[11px] text-fg-faint">{t("You are on the latest version.")}</p>}

        <p className="pt-4 text-center text-[11px] leading-relaxed text-fg-faint">
          {t("Wide is free software under the GNU General Public License v3. Made by sl4de.")}
        </p>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-[12px]">
      <span className="text-fg-dim">{label}</span>
      <span className="font-mono text-fg">{value}</span>
    </div>
  );
}
