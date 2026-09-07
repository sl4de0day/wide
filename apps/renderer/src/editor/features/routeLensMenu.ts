import { t } from "@/lib/i18n";
import { sendRouteToPitcher, sendRouteToRepeater } from "@/lib/trafficBridge";

import type { RouteRequest } from "./routeLens";

let openMenu: HTMLElement | null = null;
let returnFocus: HTMLElement | null = null;

function items(): HTMLElement[] {
  return openMenu ? Array.from(openMenu.querySelectorAll<HTMLElement>('[role="menuitem"]')) : [];
}

function closeMenu(restore = true): void {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onKey, true);
  if (restore) returnFocus?.focus?.();
  returnFocus = null;
}

function onOutside(event: MouseEvent): void {
  if (openMenu && !openMenu.contains(event.target as Node)) closeMenu(false);
}

function onKey(event: KeyboardEvent): void {
  if (!openMenu) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu();
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    closeMenu();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;

  const list = items();
  if (list.length === 0) return;
  event.preventDefault();
  const at = list.indexOf(document.activeElement as HTMLElement);
  let next = 0;
  if (event.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % list.length;
  else if (event.key === "ArrowUp") next = at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length;
  else if (event.key === "End") next = list.length - 1;
  list[next].focus();
}

export function openRouteMenu(request: RouteRequest, anchor: HTMLElement): void {
  closeMenu(false);
  returnFocus = document.activeElement as HTMLElement | null;

  const menu = document.createElement("div");
  menu.className = "wide-pop-up";
  menu.setAttribute("role", "menu");
  menu.style.position = "fixed";
  menu.style.zIndex = "400";
  menu.style.minWidth = "220px";
  menu.style.overflow = "hidden";
  menu.style.borderRadius = "6px";
  menu.style.border = "1px solid var(--line)";
  menu.style.background = "var(--panel)";
  menu.style.boxShadow = "0 10px 30px rgba(0,0,0,0.45)";
  menu.style.padding = "4px";

  const title = document.createElement("div");
  title.textContent = `${request.method} ${request.path}`;
  title.style.padding = "2px 6px 4px";
  title.style.fontSize = "10px";
  title.style.color = "var(--fg-faint)";
  title.style.whiteSpace = "nowrap";
  title.style.overflow = "hidden";
  title.style.textOverflow = "ellipsis";
  menu.appendChild(title);

  const add = (label: string, run: () => void) => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.textContent = label;
    item.style.display = "block";
    item.style.width = "100%";
    item.style.textAlign = "left";
    item.style.background = "transparent";
    item.style.border = "0";
    item.style.borderRadius = "4px";
    item.style.color = "var(--fg-dim)";
    item.style.cursor = "pointer";
    item.style.fontSize = "12px";
    item.style.padding = "4px 6px";
    item.style.outline = "none";
    item.addEventListener("focus", () => {
      item.style.background = "var(--hover)";
      item.style.color = "var(--fg)";
    });
    item.addEventListener("blur", () => {
      item.style.background = "transparent";
      item.style.color = "var(--fg-dim)";
    });
    item.addEventListener("mouseenter", () => {
      item.style.background = "var(--hover)";
      item.style.color = "var(--fg)";
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = "transparent";
      item.style.color = "var(--fg-dim)";
    });
    item.addEventListener("click", () => {
      closeMenu();
      run();
    });
    menu.appendChild(item);
  };

  add(t("Send to Repeater"), () => sendRouteToRepeater(request));
  add(t("Save to Pitcher"), () => sendRouteToPitcher(request));

  document.body.appendChild(menu);

  const box = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = `${Math.min(box.left, window.innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(box.bottom + 4, window.innerHeight - height - 8)}px`;

  openMenu = menu;
  items()[0]?.focus();
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
}
