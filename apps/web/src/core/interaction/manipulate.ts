// Anything you can move — the 2D map, the globe, a 3D scene, a 2D figure — registers here once and then obeys voice,
// hand, gamepad and keys alike (doc «Interacción v2» §2.6). Views only implement a tiny interface; they do not know
// which device moved them. The ACTIVE view is the last one used or focused, else the last one mounted and visible.

export interface Manipulable {
  /** What the user calls it («globo», «escena»): shown in the palette and spoken back. */
  label: { es: string; en: string };
  /** The element, for visibility, focus and pointing. */
  element: HTMLElement;
  /** Rotate (globe/scene) or pan (flat map). Units: fraction of the view per call; +x = right, +y = down. */
  orbit(dx: number, dy: number): void;
  zoomBy(factor: number): void;
  reset(): void;
  /** Optional: animated scenes. */
  setPlaying?(on: boolean): void;
  isPlaying?(): boolean;
}

interface Entry { id: number; m: Manipulable; usedAt: number }

const entries: Entry[] = [];
const listeners = new Set<() => void>();
let uid = 1;
let spinning: { raf: number; id: number } | null = null;

function emit(): void { for (const l of listeners) l(); }

export function registerManipulable(m: Manipulable): () => void {
  const e: Entry = { id: uid++, m, usedAt: 0 };
  entries.push(e);
  const mark = () => touch(m);
  m.element.addEventListener("pointerdown", mark);
  m.element.addEventListener("focus", mark);
  emit();
  return () => {
    m.element.removeEventListener("pointerdown", mark);
    m.element.removeEventListener("focus", mark);
    const i = entries.indexOf(e);
    if (i >= 0) entries.splice(i, 1);
    if (spinning?.id === e.id) stopSpin();
    emit();
  };
}

export function touch(m: Manipulable): void {
  const e = entries.find((x) => x.m === m);
  if (e) e.usedAt = performance.now();
}

function visible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
}

export function activeManipulable(): Manipulable | null {
  const vis = entries.filter((e) => visible(e.m.element));
  if (!vis.length) return null;
  return vis.reduce((a, b) => (b.usedAt > a.usedAt || (b.usedAt === a.usedAt && b.id > a.id) ? b : a)).m;
}

/** The view under a screen point (hand or pointer), if any. */
export function manipulableAt(x: number, y: number): Manipulable | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const r = entries[i].m.element.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && visible(entries[i].m.element)) return entries[i].m;
  }
  return null;
}

export function subscribeManipulables(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** «gira»: turns slowly until «para» or any other input. Respects reduced motion (one step instead). */
export function startSpin(): boolean {
  const m = activeManipulable();
  if (!m) return false;
  stopSpin();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { m.orbit(0.12, 0); return true; }
  const id = entries.find((e) => e.m === m)!.id;
  let last = performance.now();
  const step = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    m.orbit(0.05 * dt, 0);
    spinning = { raf: requestAnimationFrame(step), id };
  };
  spinning = { raf: requestAnimationFrame(step), id };
  return true;
}

export function stopSpin(): boolean {
  if (!spinning) return false;
  cancelAnimationFrame(spinning.raf);
  spinning = null;
  return true;
}

export function isSpinning(): boolean { return spinning !== null; }

/** What a view class must expose to be moved by every device: the globe, the flat map, a 3D scene, a 2D figure. */
export interface Movable {
  readonly canvas: HTMLCanvasElement;
  orbit(dx: number, dy: number): void;
  zoomBy(factor: number): void;
  reset(): void;
  setPlaying?(on: boolean): void;
  isPlaying?(): boolean;
}

/** One line per view: `const off = registerView(view, { es: "escena", en: "scene" })`; call `off()` on destroy. */
export function registerView(v: Movable, label: Manipulable["label"]): () => void {
  return registerManipulable({
    label,
    element: v.canvas,
    orbit: (dx, dy) => v.orbit(dx, dy),
    zoomBy: (f) => v.zoomBy(f),
    reset: () => v.reset(),
    setPlaying: v.setPlaying ? (on) => v.setPlaying!(on) : undefined,
    isPlaying: v.isPlaying ? () => v.isPlaying!() : undefined,
  });
}
