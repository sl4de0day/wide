import { useState } from "react";

import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Preset {
  label: string;
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
  ua?: string;
}

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const PRESETS: Preset[] = [
  { label: "Responsive", width: 0, height: 0, scale: 0, mobile: false },
  { label: "iPhone", width: 390, height: 844, scale: 3, mobile: true, ua: IOS_UA },
  { label: "Pixel", width: 412, height: 915, scale: 2.6, mobile: true, ua: ANDROID_UA },
  { label: "iPad", width: 820, height: 1180, scale: 2, mobile: true, ua: IOS_UA },
  { label: "Desktop", width: 1280, height: 800, scale: 1, mobile: false },
];

export function DeviceBar({ tabId }: { tabId: string }) {
  const t = useT();
  const [active, setActive] = useState("Responsive");
  const [ua, setUa] = useState("");

  const apply = async (preset: Preset) => {
    setActive(preset.label);
    if (preset.width === 0) {
      await bridge.browserCdp(tabId, "Emulation.clearDeviceMetricsOverride");
      await bridge.browserCdp(tabId, "Emulation.setUserAgentOverride", { userAgent: ua || "" });
      return;
    }
    await bridge.browserCdp(tabId, "Emulation.setDeviceMetricsOverride", {
      width: preset.width,
      height: preset.height,
      deviceScaleFactor: preset.scale,
      mobile: preset.mobile,
    });
    await bridge.browserCdp(tabId, "Emulation.setUserAgentOverride", { userAgent: ua || preset.ua || "" });
  };

  const applyUa = async (value: string) => {
    setUa(value);
    await bridge.browserCdp(tabId, "Emulation.setUserAgentOverride", { userAgent: value });
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-chrome px-2 py-1">
      <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t("Device")}</span>
      {PRESETS.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => void apply(p)}
          className={cn(
            "rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors duration-100",
            active === p.label ? "border-accent bg-selected text-fg" : "border-line text-fg-faint hover:bg-hover hover:text-fg",
          )}
        >
          {t(p.label)}
        </button>
      ))}
      <span className="ml-1 text-[10px] uppercase tracking-wide text-fg-faint">{t("UA")}</span>
      <input
        value={ua}
        onChange={(e) => setUa(e.target.value)}
        onBlur={(e) => void applyUa(e.target.value)}
        placeholder={t("custom user-agent…")}
        spellCheck={false}
        className="min-w-0 flex-1 rounded-sm border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-fg outline-none focus:border-accent placeholder:text-fg-faint"
      />
    </div>
  );
}
