// 3D globe (orthographic projection), drawn pixel by pixel on a canvas — no WebGL, no library, no network.
// Same data, same verdict textures and same public API as MapView, so the rest of the app does not care which
// one is on screen. Each screen pixel is projected back to (lat, lon), looked up in the grid, and shaded
// with a soft light so the planet reads as a sphere.

import type { BBox, MapData, Timing } from "./MapView";
import { type MapTheme, effectStep, hexToRgb, seqStep, stepColor } from "./palette";
import { landMask, landRings } from "./world";

const RAD = Math.PI / 180;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
type RGB = [number, number, number];

export class GlobeView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private off = document.createElement("canvas");
  private octx = this.off.getContext("2d")!;
  private theme: MapTheme;
  private data: MapData | null = null;
  private filter: Set<number> | null = null;
  // Per-cell colour and texture masks, built once per data/theme/filter.
  private fill: Uint8ClampedArray = new Uint8ClampedArray(0);
  private tex: Uint8Array = new Uint8Array(0); // 0 none, 2 dots, 3 fog
  // Camera: centre of the view (degrees) and zoom (1 = whole hemisphere).
  private lon0 = -60;
  private lat0 = 18;
  private zoom = 1;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private selected = -1;
  private hovered = -1;
  private region: BBox | null = null;
  private raf = 0;
  private anim = 0;
  private ro: ResizeObserver;
  /** Coarse rendering while the globe moves. */
  private fast = false;
  private settle = 0;
  private cleanup: (() => void)[] = [];
  lastTiming: Timing = { buildMs: 0, drawMs: 0 };
  onCellClick: (index: number) => void = () => {};
  onHover: (index: number, x: number, y: number) => void = () => {};

  constructor(parent: HTMLElement, theme: MapTheme, label: string) {
    this.theme = theme;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "block h-full w-full touch-none outline-none cursor-grab active:cursor-grabbing";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", label);
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(parent);
    this.resize();
  }

  destroy(): void {
    window.clearTimeout(this.settle);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.anim);
    this.ro.disconnect();
    for (const f of this.cleanup) f();
    this.canvas.remove();
  }

  setLabel(label: string): void { this.canvas.setAttribute("aria-label", label); }
  setTheme(theme: MapTheme): void { this.theme = theme; if (this.data) this.setData(this.data); else this.requestDraw(); }
  setFilter(verdicts: number[] | null): void {
    this.filter = verdicts && verdicts.length ? new Set(verdicts) : null;
    if (this.data) this.setData(this.data);
  }
  setRegion(b: BBox | null): void { this.region = b; this.requestDraw(); }
  select(index: number): void { this.selected = index; this.requestDraw(); }

  /** Pre-computes one colour (+ alpha) and one texture code per grid cell. */
  setData(d: MapData): void {
    const t0 = performance.now();
    this.data = d;
    const n = d.grid.nlat * d.grid.nlon;
    const fill = new Uint8ClampedArray(n * 4);
    const tex = new Uint8Array(n);
    const rgb = new Map<number, RGB>();
    for (const s of [-3, -2, -1, 1, 2, 3]) rgb.set(s, hexToRgb(stepColor(this.theme, s, d.blueIsMore)!));
    const grey = hexToRgb(this.theme.noChange);
    const seq = this.theme.seq.map(hexToRgb) as RGB[];
    const [lo, hi] = d.range ?? [0, 1];
    const descriptive = d.mode === "descriptive", sequential = d.mode === "sequential";
    const filter = descriptive || sequential ? null : this.filter;
    const put = (i: number, c: RGB, a: number) => { const p = i * 4; fill[p] = c[0]; fill[p + 1] = c[1]; fill[p + 2] = c[2]; fill[p + 3] = a; };
    for (let i = 0; i < n; i++) {
      if (descriptive) { const s = effectStep(d.effect[i], d.scale); if (s) put(i, rgb.get(s)!, 255); continue; }
      if (sequential) { const s = seqStep(d.effect[i], lo, hi); if (s >= 0) put(i, seq[s], 255); continue; }
      const v = d.verdict[i];
      const on = !filter || filter.has(v);
      if (v === 1) { const s = effectStep(d.effect[i], d.scale); if (s) put(i, rgb.get(s)!, on ? 255 : 38); }
      else if (v === 4) put(i, grey, on ? 255 : 30);
      else if ((v === 2 || v === 3) && on) tex[i] = v;
    }
    this.fill = fill;
    this.tex = tex;
    this.lastTiming.buildMs = performance.now() - t0;
    this.draw();
  }

  // ---- camera ----

  private R(): number { return Math.min(this.w, this.h) * 0.43 * this.zoom; }

  fitWorld(animate = false): void { this.moveTo(this.lon0, Math.max(-30, Math.min(30, this.lat0)), 1, animate); }

  /** Flights keep the planet's curve in view (zoom ≤ 2.4): the user can still zoom in by hand. */
  flyTo(lat: number, lon: number, spanDeg: number): void {
    this.moveTo(lon, lat, Math.max(1.3, Math.min(2.4, 150 / spanDeg)), true);
  }

  flyToBox(b: BBox): void {
    const [x0, y0, x1, y1] = b;
    this.flyTo((y0 + y1) / 2, (x0 + x1) / 2, Math.max(x1 - x0, (y1 - y0) * 1.5) * 6);
  }

  /** Interaction layer (doc «Interacción v2» §2.6): move as if dragged by (dx, dy) fractions of the view. */
  orbit(dx: number, dy: number): void {
    cancelAnimationFrame(this.anim);
    const k = 1 / RAD / this.R(); // degrees per pixel at the centre, as when dragging
    this.lon0 = ((this.lon0 - dx * this.w * k + 540) % 360) - 180;
    this.lat0 = Math.max(-85, Math.min(85, this.lat0 + dy * this.h * k));
    this.moving();
    this.requestDraw();
  }

  reset(): void { this.fitWorld(true); }

  zoomBy(f: number): void { this.zoom = Math.max(0.8, Math.min(12, this.zoom * f)); this.moving(); this.requestDraw(); }

  private moveTo(lon: number, lat: number, zoom: number, animate: boolean): void {
    cancelAnimationFrame(this.anim);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce) { this.lon0 = lon; this.lat0 = lat; this.zoom = zoom; this.requestDraw(); return; }
    const from = { lon: this.lon0, lat: this.lat0, z: Math.log(this.zoom) };
    let dl = ((lon - from.lon + 540) % 360) - 180; // shortest way around
    if (dl < -180) dl += 360;
    const start = performance.now(), dur = 900;
    const step = (now: number) => {
      const p = easeInOut(Math.min(1, (now - start) / dur));
      this.lon0 = from.lon + dl * p;
      this.lat0 = from.lat + (lat - from.lat) * p;
      // A gentle "pull back then dive" so the flight reads as a camera move.
      this.zoom = Math.exp(from.z + (Math.log(zoom) - from.z) * p) * (1 - 0.25 * Math.sin(Math.PI * p));
      this.moving();
      this.draw();
      if (p < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  private resize(): void {
    const r = this.canvas.parentElement?.getBoundingClientRect();
    if (!r || r.width < 2 || r.height < 2) return;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.w = Math.round(r.width);
    this.h = Math.round(r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.off.width = this.w;
    this.off.height = this.h;
    this.draw();
  }

  /** Draw coarse now, and full detail once the motion has stopped for a moment. */
  private moving(): void {
    this.fast = true;
    window.clearTimeout(this.settle);
    this.settle = window.setTimeout(() => { this.fast = false; this.draw(); }, 140);
  }

  private requestDraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  // ---- projection ----

  /** Screen → (lat, lon), or null outside the disc. */
  private invert(x: number, y: number): { lat: number; lon: number } | null {
    const R = this.R();
    const px = (x - this.w / 2) / R, py = -(y - this.h / 2) / R;
    const rho2 = px * px + py * py;
    if (rho2 > 1) return null;
    const z = Math.sqrt(1 - rho2);
    const s0 = Math.sin(this.lat0 * RAD), c0 = Math.cos(this.lat0 * RAD);
    const lat = Math.asin(Math.max(-1, Math.min(1, z * s0 + py * c0))) / RAD;
    let lon = this.lon0 + Math.atan2(px, z * c0 - py * s0) / RAD;
    lon = ((lon + 540) % 360) - 180;
    return { lat, lon };
  }

  /** (lat, lon) → screen, or null on the far side. */
  private project(lat: number, lon: number): [number, number] | null {
    const R = this.R();
    const p = lat * RAD, l = (lon - this.lon0) * RAD;
    const s0 = Math.sin(this.lat0 * RAD), c0 = Math.cos(this.lat0 * RAD);
    const cosc = s0 * Math.sin(p) + c0 * Math.cos(p) * Math.cos(l);
    if (cosc < 0) return null;
    const x = Math.cos(p) * Math.sin(l);
    const y = c0 * Math.sin(p) - s0 * Math.cos(p) * Math.cos(l);
    return [this.w / 2 + x * R, this.h / 2 - y * R];
  }

  private cellOf(lat: number, lon: number): number {
    const d = this.data?.grid;
    if (!d) return -1;
    const row = Math.round((lat - d.lat0) / d.dlat);
    let col = Math.round((lon - d.lon0) / d.dlon);
    if (d.nlon * Math.abs(d.dlon) > 359) col = ((col % d.nlon) + d.nlon) % d.nlon; // only a global grid wraps
    else if (col < 0 || col >= d.nlon) return -1;
    if (row < 0 || row >= d.nlat) return -1;
    return row * d.nlon + col;
  }

  // ---- drawing ----

  draw(): void {
    const t0 = performance.now();
    const th = this.theme, w = this.w, h = this.h, R = this.R();
    const cx = w / 2, cy = h / 2;
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Transparent around the planet: the container provides the background (panel or start screen).
    g.clearRect(0, 0, w, h);

    // Atmosphere halo.
    const halo = g.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.18);
    halo.addColorStop(0, "rgba(120,170,255,0.45)");
    halo.addColorStop(1, "rgba(120,170,255,0)");
    g.fillStyle = halo;
    g.beginPath(); g.arc(cx, cy, R * 1.18, 0, Math.PI * 2); g.fill();

    // The sphere, pixel by pixel.
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(h, Math.ceil(cy + R));
    const img = this.octx.createImageData(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    const out = img.data;
    const ocean = hexToRgb(th.ocean), landC = hexToRgb(th.land), ink = hexToRgb(th.ink);
    const lm = landMask();
    const d = this.data?.grid;
    const s0 = Math.sin(this.lat0 * RAD), c0 = Math.cos(this.lat0 * RAD);
    const fill = this.fill, tex = this.tex;
    const lightX = -0.45, lightY = 0.5, lightZ = 0.74; // light from the upper left
    // Softer textures when cells are tiny on screen (see MapView.drawTexture).
    const cellPx = d ? R * Math.abs(d.dlon) * RAD : 10;
    const soft = cellPx < 3 ? 0.5 : cellPx < 6 ? 0.75 : 1;
    const kFog = th.inkAlpha * soft, kDot = Math.min(1, th.inkAlpha + 0.3) * soft;
    // While dragging or flying, paint 2×2 blocks: half the work, smooth motion; full detail when it stops.
    const step = this.fast ? 2 : 1;
    for (let y = y0; y < y1; y += step) {
      const py = -(y + 0.5 - cy) / R;
      for (let x = x0; x < x1; x += step) {
        const px = (x + 0.5 - cx) / R;
        const rho2 = px * px + py * py;
        if (rho2 > 1) continue;
        const z = Math.sqrt(1 - rho2);
        const lat = Math.asin(z * s0 + py * c0) / RAD;
        let lon = this.lon0 + Math.atan2(px, z * c0 - py * s0) / RAD;
        lon = ((lon + 540) % 360) - 180;
        // base: land or ocean
        const mi = Math.min(lm.h - 1, Math.max(0, Math.floor((90 - lat) * 4))) * lm.w + Math.min(lm.w - 1, Math.max(0, Math.floor((lon + 180) * 4)));
        let r = lm.data[mi] ? landC[0] : ocean[0], gg = lm.data[mi] ? landC[1] : ocean[1], b = lm.data[mi] ? landC[2] : ocean[2];
        if (d) {
          const row = Math.round((lat - d.lat0) / d.dlat);
          let col = Math.round((lon - d.lon0) / d.dlon);
          const wraps = d.nlon * Math.abs(d.dlon) > 359;
          if (wraps) col = ((col % d.nlon) + d.nlon) % d.nlon;
          if (row >= 0 && row < d.nlat && col >= 0 && col < d.nlon) {
            const i = row * d.nlon + col, p4 = i * 4, a = fill[p4 + 3] / 255;
            if (a > 0) { r += (fill[p4] - r) * a; gg += (fill[p4 + 1] - gg) * a; b += (fill[p4 + 2] - b) * a; }
            else if (tex[i] === 3) {
              r += (ink[0] - r) * 0.1; gg += (ink[1] - gg) * 0.1; b += (ink[2] - b) * 0.1;
              if ((x + y) % 10 < 1.4 * step) { r += (ink[0] - r) * kFog; gg += (ink[1] - gg) * kFog; b += (ink[2] - b) * kFog; }
            } else if (tex[i] === 2) {
              if (x % 6 < 2 && y % 6 < 2) { r += (ink[0] - r) * kDot; gg += (ink[1] - gg) * kDot; b += (ink[2] - b) * kDot; }
            }
          }
        }
        // Soft light: diffuse from the upper left + a darker limb, so it reads as a sphere.
        const lambert = Math.max(0, px * lightX + py * lightY + z * lightZ);
        const shade = 0.58 + 0.42 * lambert;
        const rim = 0.82 + 0.18 * z;
        const k = shade * rim;
        const W0 = x1 - x0;
        for (let dy = 0; dy < step && y + dy < y1; dy++) {
          for (let dx = 0; dx < step && x + dx < x1; dx++) {
            const o = ((y + dy - y0) * W0 + (x + dx - x0)) * 4;
            out[o] = r * k; out[o + 1] = gg * k; out[o + 2] = b * k; out[o + 3] = 255;
          }
        }
      }
    }
    this.octx.putImageData(img, x0, y0);
    g.drawImage(this.off, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);

    // Graticule and coastlines on the visible side.
    g.lineJoin = "round";
    this.strokeLines(this.graticule(), th.landLine, 0.5, 0.35);
    this.strokeLines(landRings(), th.landLine, 0.9, 0.9);

    // Specular highlight.
    const spec = g.createRadialGradient(cx - R * 0.42, cy - R * 0.46, 0, cx - R * 0.42, cy - R * 0.46, R * 0.9);
    spec.addColorStop(0, "rgba(255,255,255,0.18)");
    spec.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = spec;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

    this.drawRegion();
    this.drawCell(this.hovered, 1.25, 0.85);
    this.drawCell(this.selected, 2.5, 1);
    this.lastTiming.drawMs = performance.now() - t0;
  }

  private graticule(): [number, number][][] {
    const lines: [number, number][][] = [];
    for (let lon = -180; lon < 180; lon += 30) lines.push(Array.from({ length: 37 }, (_, k) => [lon, -90 + k * 5] as [number, number]));
    for (let lat = -60; lat <= 60; lat += 30) lines.push(Array.from({ length: 73 }, (_, k) => [-180 + k * 5, lat] as [number, number]));
    return lines;
  }

  private strokeLines(lines: [number, number][][], colour: string, width: number, alpha: number): void {
    const g = this.ctx;
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.globalAlpha = alpha;
    g.beginPath();
    for (const line of lines) {
      let pen = false;
      for (const [lon, lat] of line) {
        const p = this.project(lat, lon);
        if (!p) { pen = false; continue; }
        if (pen) g.lineTo(p[0], p[1]); else { g.moveTo(p[0], p[1]); pen = true; }
      }
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  private outline(points: [number, number][], width: number, alpha: number): void {
    const g = this.ctx;
    const pts = points.map(([lon, lat]) => this.project(lat, lon));
    if (pts.some((p) => !p)) return;
    for (const [colour, wd] of [[this.theme.halo, width + 3], [this.theme.focus, width]] as const) {
      g.globalAlpha = alpha;
      g.strokeStyle = colour;
      g.lineWidth = wd;
      g.beginPath();
      pts.forEach((p, k) => (k ? g.lineTo(p![0], p![1]) : g.moveTo(p![0], p![1])));
      g.closePath();
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  private box(x0: number, y0: number, x1: number, y1: number): [number, number][] {
    const pts: [number, number][] = [];
    const n = 8;
    for (let k = 0; k <= n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y1]);
    for (let k = 0; k <= n; k++) pts.push([x1, y1 - ((y1 - y0) * k) / n]);
    for (let k = 0; k <= n; k++) pts.push([x1 - ((x1 - x0) * k) / n, y0]);
    for (let k = 0; k <= n; k++) pts.push([x0, y0 + ((y1 - y0) * k) / n]);
    return pts;
  }

  private drawRegion(): void {
    if (!this.region) return;
    const [x0, y0, x1, y1] = this.region;
    this.outline(this.box(x0, y0, x1, y1), 2.5, 1);
  }

  private drawCell(index: number, width: number, alpha: number): void {
    const d = this.data?.grid;
    if (index < 0 || !d) return;
    const row = Math.floor(index / d.nlon), col = index % d.nlon;
    const lat = d.lat0 + row * d.dlat, lon = d.lon0 + col * d.dlon;
    // Never smaller than ~10 px on screen, so a selection is always visible.
    const minDeg = (10 / this.R()) / RAD;
    const hw = Math.max(Math.abs(d.dlon), minDeg) / 2, hh = Math.max(Math.abs(d.dlat), minDeg) / 2;
    this.outline(this.box(lon - hw, lat - hh, lon + hw, lat + hh), width, alpha);
  }

  // ---- input ----

  private on<K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    this.canvas.addEventListener(type, fn as EventListener, opts);
    this.cleanup.push(() => this.canvas.removeEventListener(type, fn as EventListener, opts));
  }

  private setHover(i: number, x: number, y: number): void {
    if (i !== this.hovered) { this.hovered = i; this.requestDraw(); }
    this.onHover(i, x, y);
  }

  private bindEvents(): void {
    let down: { x: number; y: number; lon: number; lat: number; moved: boolean } | null = null;
    this.on("pointerdown", (e) => {
      cancelAnimationFrame(this.anim);
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer (hand, voice): nothing to capture */ }
      down = { x: e.offsetX, y: e.offsetY, lon: this.lon0, lat: this.lat0, moved: false };
    });
    this.on("pointermove", (e) => {
      if (!down) {
        if (e.pointerType === "mouse") {
          const ll = this.invert(e.offsetX, e.offsetY);
          this.setHover(ll ? this.cellOf(ll.lat, ll.lon) : -1, e.offsetX, e.offsetY);
        }
        return;
      }
      const dx = e.offsetX - down.x, dy = e.offsetY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
      if (down.moved) {
        const k = 1 / RAD / this.R(); // degrees per pixel at the centre
        this.lon0 = down.lon - dx * k;
        this.lat0 = Math.max(-85, Math.min(85, down.lat + dy * k));
        this.setHover(-1, 0, 0);
        this.moving();
        this.requestDraw();
      }
    });
    this.on("pointerup", (e) => {
      if (down && !down.moved) {
        const ll = this.invert(e.offsetX, e.offsetY);
        const i = ll ? this.cellOf(ll.lat, ll.lon) : -1;
        if (i >= 0) this.onCellClick(i);
      }
      down = null;
    });
    this.on("pointerleave", () => this.setHover(-1, 0, 0));
    this.on("pointercancel", () => { down = null; });
    this.on("wheel", (e) => { e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    this.on("keydown", (e) => {
      if (e.key === "+" || e.key === "=") this.zoomBy(1.25);
      else if (e.key === "-") this.zoomBy(0.8);
      else if (e.key === "ArrowLeft") { this.lon0 -= 10 / this.zoom; this.requestDraw(); }
      else if (e.key === "ArrowRight") { this.lon0 += 10 / this.zoom; this.requestDraw(); }
      else if (e.key === "ArrowUp") { this.lat0 = Math.min(85, this.lat0 + 10 / this.zoom); this.requestDraw(); }
      else if (e.key === "ArrowDown") { this.lat0 = Math.max(-85, this.lat0 - 10 / this.zoom); this.requestDraw(); }
      else if (e.key === "0") this.fitWorld(true);
      else if (e.key === "Enter" || e.key === " ") {
        const ll = this.invert(this.w / 2, this.h / 2);
        const i = ll ? this.cellOf(ll.lat, ll.lon) : -1;
        if (i >= 0) this.onCellClick(i);
      } else return;
      e.preventDefault();
    });
  }
}
