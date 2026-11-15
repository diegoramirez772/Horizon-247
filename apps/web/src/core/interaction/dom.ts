// The live list of what can be operated on screen (doc «Interacción v2» §2.2): every visible control with its
// accessible name. Voice says the name or the number, the gamepad / keys / hand move the focus among them, so
// ANY control works with ANY device without each screen being rewritten. Controls without a name are reported by
// audit() (the coverage check: Label in Name, WCAG 2.5.3).

import { nearestTo, nextInDirection, type Box, type Dir } from "./spatial";

const SELECTOR = [
  "button", "a[href]", "input:not([type=hidden])", "textarea", "select", "summary",
  "[role=button]", "[role=link]", "[role=tab]", "[role=checkbox]", "[role=switch]", "[role=radio]", "[role=option]", "[role=menuitem]", "[role=slider]",
  "[tabindex]:not([tabindex='-1'])", "canvas[tabindex]",
].join(",");

/** Our own overlay (badges, cursor) never counts as a control. */
const OVERLAY = "[data-h247-overlay]";

export interface Target { el: HTMLElement; name: string; box: Box }

function hidden(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled || el.closest("[aria-hidden=true],[inert]") || el.closest(OVERLAY)) return true;
  const s = getComputedStyle(el);
  return s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0;
}

function textOf(id: string): string {
  return document.getElementById(id)?.textContent?.trim() ?? "";
}

/** Accessible name, simplified: aria-label → aria-labelledby → <label> → title → text → placeholder. */
export function accessibleName(el: HTMLElement): string {
  const a = el.getAttribute("aria-label");
  if (a?.trim()) return a.trim();
  const by = el.getAttribute("aria-labelledby");
  if (by) { const t = by.split(/\s+/).map(textOf).join(" ").trim(); if (t) return t; }
  if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim(); if (l) return l; }
  const wrap = el.closest("label")?.textContent?.trim();
  if (wrap && el instanceof HTMLInputElement) return wrap;
  const title = el.getAttribute("title");
  const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? "" : (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text && text.length <= 60) return text;
  if (title?.trim()) return title.trim();
  const ph = el.getAttribute("placeholder");
  if (ph?.trim()) return ph.trim();
  return text.slice(0, 60);
}

/** Visible controls inside the viewport, in reading order (top → bottom, left → right). */
export function targets(root: ParentNode = document): Target[] {
  const out: Target[] = [];
  const seen = new Set<Element>();
  for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) {
    if (seen.has(el)) continue;
    // a control inside a button or link (an icon inside a row link) counts once: the outer one
    if (el.parentElement?.closest("button,a[href],[role=button],[role=link]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    if (hidden(el)) continue;
    seen.add(el);
    out.push({ el, name: accessibleName(el), box: { x: r.left, y: r.top, w: r.width, h: r.height } });
  }
  return out.sort((a, b) => (Math.abs(a.box.y - b.box.y) < 12 ? a.box.x - b.box.x : a.box.y - b.box.y));
}

export function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return (el as HTMLElement | null)?.isContentEditable ?? false;
  return ["text", "search", "email", "url", "tel", "number", "password", ""].includes(el.type);
}

/** Activates a control the way its kind expects: fields get the focus, everything else a click. */
export function activate(el: HTMLElement): void {
  el.focus({ preventScroll: false });
  if (isTextField(el) || el instanceof HTMLSelectElement) return;
  if (el instanceof HTMLCanvasElement) return;
  el.click();
}

/** Synthetic tap at a screen point: on a canvas it is a pick (pointerdown + pointerup), elsewhere a click. */
export function tapAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el || el.closest(OVERLAY)) return null;
  if (el instanceof HTMLCanvasElement) {
    const init = { clientX: x, clientY: y, bubbles: true, pointerId: 77, pointerType: "touch", isPrimary: true, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", init));
    el.dispatchEvent(new PointerEvent("pointerup", init));
    el.focus({ preventScroll: true });
    return el;
  }
  const t = el.closest<HTMLElement>(SELECTOR) ?? el;
  activate(t);
  return t;
}

/** Moves the focus to the nearest control in a direction (TV-style). Returns the new focus. */
export function moveFocus(dir: Dir): HTMLElement | null {
  const list = targets();
  if (!list.length) return null;
  const cur = document.activeElement as HTMLElement | null;
  const i = list.findIndex((t) => t.el === cur);
  if (i < 0) { list[0].el.focus(); return list[0].el; }
  const j = nextInDirection(list.map((t) => t.box), list[i].box, dir);
  if (j < 0) return null;
  list[j].el.focus();
  list[j].el.scrollIntoView({ block: "nearest", inline: "nearest" });
  return list[j].el;
}

/** Next / previous control in reading order («siguiente campo»). */
export function stepFocus(delta: 1 | -1, onlyFields = false): HTMLElement | null {
  const list = targets().filter((t) => !onlyFields || isTextField(t.el) || t.el instanceof HTMLSelectElement);
  if (!list.length) return null;
  const i = list.findIndex((t) => t.el === document.activeElement);
  const t = list[(i + delta + list.length) % list.length];
  t.el.focus();
  return t.el;
}

/** The control nearest to a point within `radius` px (magnet for the hand pointer). */
export function magnet(x: number, y: number, radius = 36): Target | null {
  const list = targets();
  const i = nearestTo(list.map((t) => t.box), x, y, radius);
  return i < 0 ? null : list[i];
}

/** Scrolls the scrollable area under the focus (or the page). */
export function scrollBy(dy: number): void {
  let el: HTMLElement | null = (document.activeElement as HTMLElement | null) ?? null;
  while (el && el !== document.body) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) { el.scrollBy({ top: dy, behavior: "smooth" }); return; }
    el = el.parentElement;
  }
  const main = document.querySelector<HTMLElement>("main [data-scroll], main");
  if (main && main.scrollHeight > main.clientHeight) { main.scrollBy({ top: dy, behavior: "smooth" }); return; }
  window.scrollBy({ top: dy, behavior: "smooth" });
}

/** Coverage check: visible controls nobody can name by voice. Empty = every control is reachable by name. */
export function audit(): { el: HTMLElement; html: string }[] {
  return targets().filter((t) => !t.name && !(t.el instanceof HTMLCanvasElement && t.el.getAttribute("aria-label"))).map((t) => ({ el: t.el, html: t.el.outerHTML.slice(0, 120) }));
}

/** Escape, as if the key was pressed: closes whatever the app closes with Esc. */
export function pressEscape(): void {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  for (const type of ["keydown", "keyup"] as const) target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", bubbles: true }));
}
