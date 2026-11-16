// Canvas map, equirectangular (x = longitude, y = latitude), no tiles.
// The grid is painted ONCE into grid-sized images (1 px = 1 cell) and only scaled on each frame
// (prototype: 31–48 ms first paint with 259 200 cells, goal < 100 ms).
//
// Reading aids: ocean and land are drawn under the data, a faint graticule gives position, uncertainty is a
// light "fog" of stripes instead of a heavy hatch, hover reports the cell under the pointer, a verdict filter
// dims everything else, and `flyTo` moves the camera when the assistant points somewhere.

import { type MapTheme, effectStep, hexToRgb, seqStep, stepColor } from "./palette";
import { pattern } from "./textures";
import { landPath } from "./world";
import { DETAIL_EARTH, type LayerDef, type Mosaic, baseLayer, degPerPx, layer as layerById, levelFor, loadMosaic } from "./imagery";

/** NASA imagery on the flat map: same plate carrée (EPSG:4326) as the GIBS tiles, so a mosaic is drawn as is. */
export interface FlatImagery { layer: string; date?: string }

export interface GridSpec { nlat: number; nlon: number; lat0: number; dlat: number; lon0: number; dlon: number }

export interface MapData {
  grid: GridSpec;
  verdict: Uint8Array;
  effect: Float32Array;
  scale: number;
  blueIsMore: boolean;
  /**
   * "descriptive" = colour by signed value, no textures and no verdict (year by year, SPEC §8.1; or the effect metric).
   * "sequential" = colour by magnitude within `range` (MDE, years still needed).
   */
  mode?: "verdict" | "descriptive" | "sequential";
  range?: [number, number];
}

export type BBox = [number, number, number, number]; // lonMin, latMin, lonMax, latMax

export interface Timing { buildMs: number; drawMs: number }

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scratch = document.createElement("canvas");
  private sctx = this.scratch.getContext("2d")!;
  private fill = document.createElement("canvas");
  private maskCand = document.createElement("canvas");
  private maskNC = document.createElement("canvas");
  private data: MapData | null = null;
  private theme: MapTheme;
  private filter: Set<number> | null = null;
  private insufficient: number[] = [];
  private k = 1;
  private tx = 0;
  private ty = 0;
  private dpr = 1;
  private selected = -1;
  private hovered = -1;
  private region: BBox | null = null;
  private raf = 0;
  private anim = 0;
  private ro: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private lastSize = "";
  private userMoved = false;
  lastTiming: Timing = { buildMs: 0, drawMs: 0 };
  // real imagery: Blue Marble under everything, an optional dated/live layer, and a sharp patch of what is on screen
  private base: Mosaic | null = null;
  private img: Mosaic | null = null;
  private patch: Mosaic | null = null;
  private imagery: FlatImagery | null = null;
  private patchKey = "";
  private lastBox = "";
  private settle = 0;
  private aborts: Record<"base" | "img" | "patch", AbortController | null> = { base: null, img: null, patch: null };
  /** Called with a short line saying what picture is under the data (for the caption). */
  onImagery: (label: string) => void = () => {};
  onCellClick: (index: number, at?: { lat: number; lon: number }) => void = () => {};
  onHover: (index: number, x: number, y: number) => void = () => {};

  constructor(parent: HTMLElement, theme: MapTheme, label: string) {
    this.theme = theme;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas = document.createElement("canvas");
    this.canvas.className = "block h-full w-full touch-none outline-none cursor-crosshair";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", label);
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(parent);
    this.resize();
    void this.loadBase();
  }

  // ---- imagery ----

  private async loadBase(): Promise<void> {
    const l = baseLayer("earth");
    const ctrl = new AbortController(); this.aborts.base = ctrl;
    let z = 0;
    while (z < l.maxLevel && 360 / degPerPx(l.provider, z + 1) <= 4096) z++;
    try {
      const m = await loadMosaic(l, z, [-180, -90, 180, 90], { signal: ctrl.signal });
      if (ctrl.signal.aborted || m.missing === m.total) return;
      this.base = m; this.requestDraw();
    } catch { /* offline: land and ocean colours stay */ }
  }

  /** Dated or live NASA layer under the data (null = Blue Marble only). */
  setImagery(choice: FlatImagery | null): void {
    if (choice?.layer === this.imagery?.layer && choice?.date === this.imagery?.date) return;
    this.imagery = choice; this.img = null; this.patch = null; this.patchKey = "";
    this.aborts.img?.abort(); this.aborts.patch?.abort();
    if (!choice) { this.onImagery(""); this.requestDraw(); return; }
    const l = layerById(choice.layer);
    const ctrl = new AbortController(); this.aborts.img = ctrl;
    this.onImagery(`${l.title} · cargando…`);
    loadMosaic(l, Math.min(2, l.maxLevel), [-180, -90, 180, 90], { date: choice.date, signal: ctrl.signal }).then((m) => {
      if (ctrl.signal.aborted) return;
      if (m.missing === m.total) { this.onImagery(`Sin imagen de ${l.title} para ${choice.date ?? "esa fecha"}`); return; }
      this.img = m;
      this.onImagery(`${l.title}${m.servedDate ? ` · ${m.servedDate}` : ""} · NASA GIBS`);
      this.requestDraw();
      this.schedulePatch();
    }).catch(() => this.onImagery(`No se pudo cargar ${l.title}`));
  }

  /** After the view stops, fetch a sharper mosaic of exactly what is on screen («mapa de calidad»). */
  private schedulePatch(): void {
    clearTimeout(this.settle);
    this.settle = window.setTimeout(() => void this.loadPatch(), 300);
  }

  private visibleBox(): [number, number, number, number] {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    const lon0 = -this.tx / this.k, lon1 = (w - this.tx) / this.k;
    const lat1 = this.ty / this.k, lat0 = -(h - this.ty) / this.k;
    return [Math.max(-180, lon0), Math.max(-90, lat0), Math.min(180, lon1), Math.min(90, lat1)];
  }

  private async loadPatch(): Promise<void> {
    const box = this.visibleBox();
    // Without a chosen layer, close views read Sentinel-2 (10 m) instead of Blue Marble: a map you can recognise.
    const l: LayerDef = this.imagery ? layerById(this.imagery.layer) : box[2] - box[0] <= 60 ? DETAIL_EARTH : baseLayer("earth");
    if (box[2] - box[0] > 200 || document.hidden) { if (this.patch) { this.patch = null; this.requestDraw(); } return; }
    const want = 1 / (this.k * this.dpr); // degrees per screen pixel
    let z = levelFor(l, want);
    // Keep the patch to at most ~4 × 4 tiles of 512 px.
    while (z > 0 && ((box[2] - box[0]) / degPerPx(l.provider, z)) * ((box[3] - box[1]) / degPerPx(l.provider, z)) > 2048 * 2048) z--;
    const key = `${l.id}|${this.imagery?.date ?? ""}|${z}|${box.map((v) => Math.round(v)).join(",")}`;
    if (key === this.patchKey) return;
    this.patchKey = key;
    this.aborts.patch?.abort();
    const ctrl = new AbortController(); this.aborts.patch = ctrl;
    try {
      const m = await loadMosaic(l, z, box, { date: this.imagery?.date, signal: ctrl.signal });
      if (ctrl.signal.aborted || m.missing === m.total) return;
      this.patch = m; this.requestDraw();
    } catch { /* keep the coarse picture */ }
  }

  private drawMosaic(g: CanvasRenderingContext2D, m: Mosaic): void {
    const [x0, y0, x1, y1] = m.bbox;
    g.drawImage(m.canvas, x0, -y1, x1 - x0, y1 - y0);
  }

  destroy(): void {
    clearTimeout(this.settle);
    for (const a of Object.values(this.aborts)) a?.abort();
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.anim);
    this.ro.disconnect();
    for (const f of this.cleanup) f();
    this.canvas.remove();
  }

  setLabel(label: string): void { this.canvas.setAttribute("aria-label", label); }

  setTheme(theme: MapTheme): void {
    this.theme = theme;
    if (this.data) this.setData(this.data); else this.requestDraw();
  }

  /** Show only these verdicts at full strength (null = all). */
  setFilter(verdicts: number[] | null): void {
    this.filter = verdicts && verdicts.length ? new Set(verdicts) : null;
    if (this.data) this.setData(this.data);
  }

  setRegion(b: BBox | null): void {
    this.region = b;
    this.requestDraw();
  }

  setData(d: MapData): void {
    const t0 = performance.now();
    this.data = d;
    const { nlat, nlon } = d.grid;
    for (const c of [this.fill, this.maskCand, this.maskNC]) { c.width = nlon; c.height = nlat; }
    const fillImg = new ImageData(nlon, nlat);
    const candImg = new ImageData(nlon, nlat);
    const ncImg = new ImageData(nlon, nlat);
    const f = fillImg.data, ca = candImg.data, nc = ncImg.data;
    const rgb = new Map<number, [number, number, number]>();
    for (const s of [-3, -2, -1, 1, 2, 3]) rgb.set(s, hexToRgb(stepColor(this.theme, s, d.blueIsMore)!));
    const grey = hexToRgb(this.theme.noChange);
    const ins: number[] = [];
    const n = nlat * nlon;
    const descriptive = d.mode === "descriptive";
    const sequential = d.mode === "sequential";
    const filter = descriptive || sequential ? null : this.filter;
    const seq = this.theme.seq.map(hexToRgb) as [number, number, number][];
    const [lo, hi] = d.range ?? [0, 1];
    const put = (p: number, c: [number, number, number], a: number) => { f[p] = c[0]; f[p + 1] = c[1]; f[p + 2] = c[2]; f[p + 3] = a; };
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      if (descriptive) {
        const s = effectStep(d.effect[i], d.scale);
        if (s !== 0) put(p, rgb.get(s)!, 255);
        continue;
      }
      if (sequential) {
        const s = seqStep(d.effect[i], lo, hi);
        if (s >= 0) put(p, seq[s], 255);
        continue;
      }
      const v = d.verdict[i];
      const on = !filter || filter.has(v);
      const a = on ? 255 : 38;
      if (v === 1) {
        const s = effectStep(d.effect[i], d.scale);
        if (s !== 0) put(p, rgb.get(s)!, a);
      } else if (v === 4) put(p, grey, on ? 255 : 30);
      else if (v === 2) { if (on) ca[p + 3] = 255; }
      else if (v === 3) { if (on) nc[p + 3] = 255; }
      else ins.push(i);
    }
    this.fill.getContext("2d")!.putImageData(fillImg, 0, 0);
    this.maskCand.getContext("2d")!.putImageData(candImg, 0, 0);
    this.maskNC.getContext("2d")!.putImageData(ncImg, 0, 0);
    this.insufficient = ins;
    this.lastTiming.buildMs = performance.now() - t0;
    this.draw();
  }

  select(index: number): void { this.selected = index; this.requestDraw(); }

  // ---- camera ----

  private worldFit(): { k: number; tx: number; ty: number } {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    const k = Math.min(w / 360, h / 180);
    return { k, tx: (w - 360 * k) / 2 + 180 * k, ty: (h - 180 * k) / 2 + 90 * k };
  }

  /** Where a place lands on screen: the centre (nothing floats over the map any more). */
  private anchor(): { x: number; y: number } {
    return { x: this.canvas.width / this.dpr / 2, y: this.canvas.height / this.dpr / 2 };
  }

  private target(lat: number, lon: number, spanDeg: number): { k: number; tx: number; ty: number } {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    const k = Math.max(this.worldFit().k, Math.min(400, Math.min(w / spanDeg, h / (spanDeg / 2))));
    const a = this.anchor();
    return { k, tx: a.x - lon * k, ty: this.clampY(a.y + lat * k, k, h) };
  }

  /** Never show beyond the poles: if the whole world fits vertically, centre it; otherwise keep ±90° in view. */
  private clampY(ty: number, k: number, h: number): number {
    if (180 * k <= h) return h / 2;
    return Math.min(90 * k, Math.max(h - 90 * k, ty));
  }

  fitWorld(animate = false): void {
    this.userMoved = false;
    this.moveTo(this.worldFit(), animate);
  }

  /** Centre on (lat, lon) showing about `spanDeg` degrees across; animated unless reduced motion is on. */
  flyTo(lat: number, lon: number, spanDeg: number): void {
    this.userMoved = true;
    this.moveTo(this.target(lat, lon, spanDeg), true);
  }

  flyToBox(b: BBox): void {
    const [x0, y0, x1, y1] = b;
    const span = Math.max(x1 - x0, (y1 - y0) * 2) * 6; // the region plus its surroundings
    this.flyTo((y0 + y1) / 2, (x0 + x1) / 2, Math.max(span, 70));
  }

  private moveTo(t: { k: number; tx: number; ty: number }, animate: boolean): void {
    cancelAnimationFrame(this.anim);
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce) { this.k = t.k; this.tx = t.tx; this.ty = t.ty; this.requestDraw(); return; }
    // Interpolate in "world centre + log zoom" so the flight looks natural.
    const w = this.canvas.width / this.dpr / 2, h = this.canvas.height / this.dpr / 2;
    const from = { lon: (w - this.tx) / this.k, lat: (this.ty - h) / this.k, z: Math.log(this.k) };
    const to = { lon: (w - t.tx) / t.k, lat: (t.ty - h) / t.k, z: Math.log(t.k) };
    const start = performance.now(), dur = 750;
    const step = (now: number) => {
      const p = easeInOut(Math.min(1, (now - start) / dur));
      const k = Math.exp(from.z + (to.z - from.z) * p);
      const lon = from.lon + (to.lon - from.lon) * p, lat = from.lat + (to.lat - from.lat) * p;
      this.k = k; this.tx = w - lon * k; this.ty = h + lat * k;
      this.draw();
      if (p < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  /** Interaction layer (doc «Interacción v2» §2.6): pan as if dragged by (dx, dy) fractions of the view. */
  orbit(dx: number, dy: number): void {
    cancelAnimationFrame(this.anim);
    this.userMoved = true;
    this.tx += dx * (this.canvas.width / this.dpr);
    this.ty += dy * (this.canvas.height / this.dpr);
    this.requestDraw();
  }

  reset(): void { this.fitWorld(true); }

  zoomBy(factor: number): void {
    this.zoomAt(this.canvas.width / this.dpr / 2, this.canvas.height / this.dpr / 2, factor);
  }

  private zoomAt(x: number, y: number, factor: number): void {
    cancelAnimationFrame(this.anim);
    const k2 = Math.max(this.worldFit().k * 0.9, Math.min(400, this.k * factor));
    const f = k2 / this.k;
    this.userMoved = true;
    this.tx = x - (x - this.tx) * f;
    this.ty = y - (y - this.ty) * f;
    this.k = k2;
    this.requestDraw();
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const r = parent.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    const size = `${Math.round(r.width)}x${Math.round(r.height)}@${this.dpr}`;
    if (size === this.lastSize) return;
    const first = this.lastSize === "";
    this.lastSize = size;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.scratch.width = this.canvas.width;
    this.scratch.height = this.canvas.height;
    if (first || !this.userMoved) this.fitWorld();
    else this.draw();
  }

  private requestDraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  private setWorldTransform(g: CanvasRenderingContext2D): void {
    g.setTransform(this.k * this.dpr, 0, 0, this.k * this.dpr, this.tx * this.dpr, this.ty * this.dpr);
  }

  private drawGridImage(g: CanvasRenderingContext2D, img: HTMLCanvasElement): void {
    const d = this.data!.grid;
    g.drawImage(img, d.lon0 - d.dlon / 2, -(d.lat0 - d.dlat / 2), d.nlon * d.dlon, d.nlat * Math.abs(d.dlat));
  }

  // ---- drawing ----

  draw(): void {
    const t0 = performance.now();
    const g = this.ctx;
    const th = this.theme;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = th.ocean;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // The real Earth first (Blue Marble, then the chosen NASA layer and its sharp patch); flat land when offline.
    this.setWorldTransform(g);
    g.imageSmoothingEnabled = true;
    if (this.base) this.drawMosaic(g, this.base); else { g.fillStyle = th.land; g.fill(landPath()); }
    if (this.img) this.drawMosaic(g, this.img);
    if (this.patch && (this.imagery ? this.patch.layer.id === this.imagery.layer : this.patch.layer.role !== "live")) this.drawMosaic(g, this.patch);
    this.drawGraticule(g);
    const live = this.imagery ? layerById(this.imagery.layer).live : false;

    if (this.data) {
      g.imageSmoothingEnabled = false;
      this.setWorldTransform(g);
      // Over a live satellite picture the trend colours step back to a veil, so the clouds can be seen.
      g.globalAlpha = live ? 0.15 : this.base ? 0.88 : 1;
      this.drawGridImage(g, this.fill);
      g.globalAlpha = 1;
      if (this.data.mode !== "descriptive" && this.data.mode !== "sequential") {
        this.drawTexture(this.maskNC, "fog");
        this.drawTexture(this.maskCand, "dots");
        this.drawInsufficientBorders();
      }
    }
    this.setWorldTransform(g);
    g.strokeStyle = th.landLine;
    g.lineWidth = 0.9 / this.k;
    g.stroke(landPath());
    this.drawRegion();
    this.drawCell(this.hovered, 1.25, 0.8);
    this.drawCell(this.selected, 2.5, 1);
    this.lastTiming.drawMs = performance.now() - t0;
    // A changed view asks for a sharper picture of what is now on screen.
    const box = this.visibleBox();
    if (box[2] - box[0] <= 200 && `${Math.round(box[0])},${Math.round(box[1])},${Math.round(this.k)}` !== this.lastBox) {
      this.lastBox = `${Math.round(box[0])},${Math.round(box[1])},${Math.round(this.k)}`;
      this.schedulePatch();
    }
  }

  private drawGraticule(g: CanvasRenderingContext2D): void {
    g.strokeStyle = this.theme.graticule;
    g.lineWidth = 1 / this.k;
    g.beginPath();
    for (let lon = -180; lon <= 180; lon += 30) { g.moveTo(lon, -90); g.lineTo(lon, 90); }
    for (let lat = -60; lat <= 60; lat += 30) { g.moveTo(-180, -lat); g.lineTo(180, -lat); }
    g.stroke();
  }

  /** «Aún no» = light fog (a faint veil + thin stripes); «posible» = dots. Drawn only where the mask says. */
  private drawTexture(mask: HTMLCanvasElement, which: "fog" | "dots"): void {
    const s = this.sctx;
    const th = this.theme;
    const dpr = this.dpr;
    // Far away, cells are a few pixels wide and full-strength textures read as static noise:
    // soften them, then bring them back as the user zooms in. They never disappear (meaning is not colour alone).
    const px = this.k * Math.abs(this.data!.grid.dlon);
    const soft = px < 3 ? 0.5 : px < 6 ? 0.75 : 1;
    s.globalCompositeOperation = "source-over";
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, this.scratch.width, this.scratch.height);
    s.globalAlpha = 1;
    if (which === "fog") {
      s.fillStyle = th.ink;
      s.globalAlpha = 0.1;
      s.fillRect(0, 0, this.scratch.width, this.scratch.height);
      s.globalAlpha = th.inkAlpha * soft;
      s.strokeStyle = th.ink;
      s.lineWidth = 1.25 * dpr;
      const gap = 7 * Math.SQRT2 * dpr, W = this.scratch.width, H = this.scratch.height;
      s.beginPath();
      for (let x = -H; x < W; x += gap) { s.moveTo(x, H); s.lineTo(x + H, 0); }
      s.stroke();
    } else {
      s.fillStyle = pattern(s, "dot", th.ink, dpr);
      s.globalAlpha = Math.min(1, th.inkAlpha + 0.3) * soft;
      s.fillRect(0, 0, this.scratch.width, this.scratch.height);
    }
    s.globalAlpha = 1;
    s.globalCompositeOperation = "destination-in";
    s.imageSmoothingEnabled = false;
    this.setWorldTransform(s);
    this.drawGridImage(s, mask);
    s.globalCompositeOperation = "source-over";
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.scratch, 0, 0);
  }

  private drawInsufficientBorders(): void {
    const d = this.data!.grid;
    if (this.k * Math.abs(d.dlon) < 8) return;
    const g = this.ctx;
    this.setWorldTransform(g);
    g.strokeStyle = this.theme.ink;
    g.globalAlpha = 0.6;
    g.lineWidth = 0.75 / this.k;
    g.beginPath();
    for (const i of this.insufficient) {
      const row = Math.floor(i / d.nlon), col = i % d.nlon;
      const lat = d.lat0 + row * d.dlat, lon = d.lon0 + col * d.dlon;
      g.rect(lon - Math.abs(d.dlon) / 2 + 0.1, -lat - Math.abs(d.dlat) / 2 + 0.1, Math.abs(d.dlon) - 0.2, Math.abs(d.dlat) - 0.2);
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  private drawRegion(): void {
    if (!this.region) return;
    const [x0, y0, x1, y1] = this.region;
    const g = this.ctx;
    this.setWorldTransform(g);
    g.lineJoin = "round";
    g.lineWidth = 6 / this.k;
    g.strokeStyle = this.theme.halo;
    g.strokeRect(x0, -y1, x1 - x0, y1 - y0);
    g.lineWidth = 2.5 / this.k;
    g.strokeStyle = this.theme.focus;
    g.strokeRect(x0, -y1, x1 - x0, y1 - y0);
  }

  private drawCell(index: number, width: number, alpha: number): void {
    if (index < 0 || !this.data) return;
    const d = this.data.grid;
    const row = Math.floor(index / d.nlon), col = index % d.nlon;
    const lat = d.lat0 + row * d.dlat, lon = d.lon0 + col * d.dlon;
    const g = this.ctx;
    this.setWorldTransform(g);
    const min = 10 / this.k;
    const sw = Math.max(Math.abs(d.dlon), min), sh = Math.max(Math.abs(d.dlat), min);
    g.globalAlpha = alpha;
    g.lineWidth = (width + 3) / this.k;
    g.strokeStyle = this.theme.halo;
    g.strokeRect(lon - sw / 2, -lat - sh / 2, sw, sh);
    g.lineWidth = width / this.k;
    g.strokeStyle = this.theme.focus;
    g.strokeRect(lon - sw / 2, -lat - sh / 2, sw, sh);
    g.globalAlpha = 1;
  }

  // ---- input ----

  screenToLatLon(x: number, y: number): { lat: number; lon: number } {
    return { lon: (x - this.tx) / this.k, lat: (this.ty - y) / this.k };
  }

  private cellAt(x: number, y: number): number {
    if (!this.data) return -1;
    const { lat, lon } = this.screenToLatLon(x, y);
    const d = this.data.grid;
    const row = Math.round((lat - d.lat0) / d.dlat);
    const col = Math.round((lon - d.lon0) / d.dlon);
    if (row < 0 || row >= d.nlat || col < 0 || col >= d.nlon) return -1;
    return row * d.nlon + col;
  }

  private on<K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    this.canvas.addEventListener(type, fn as EventListener, opts);
    this.cleanup.push(() => this.canvas.removeEventListener(type, fn as EventListener, opts));
  }

  private setHover(i: number, x: number, y: number): void {
    if (i !== this.hovered) { this.hovered = i; this.requestDraw(); }
    this.onHover(i, x, y);
  }

  private bindEvents(): void {
    let down: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
    this.on("pointerdown", (e) => {
      cancelAnimationFrame(this.anim);
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer (hand, voice): nothing to capture */ }
      down = { x: e.offsetX, y: e.offsetY, tx: this.tx, ty: this.ty, moved: false };
    });
    this.on("pointermove", (e) => {
      if (!down) {
        if (e.pointerType === "mouse") this.setHover(this.cellAt(e.offsetX, e.offsetY), e.offsetX, e.offsetY);
        return;
      }
      const dx = e.offsetX - down.x, dy = e.offsetY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
      if (down.moved) {
        this.userMoved = true;
        this.tx = down.tx + dx; this.ty = down.ty + dy;
        this.setHover(-1, 0, 0);
        this.requestDraw();
      }
    });
    this.on("pointerup", (e) => {
      if (down && !down.moved) {
        const i = this.cellAt(e.offsetX, e.offsetY);
        if (i >= 0) this.onCellClick(i);
      }
      down = null;
    });
    this.on("pointerleave", () => this.setHover(-1, 0, 0));
    this.on("pointercancel", () => { down = null; });
    this.on("wheel", (e) => {
      e.preventDefault();
      this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    this.on("keydown", (e) => {
      const step = 40;
      if (e.key.startsWith("Arrow")) this.userMoved = true;
      if (e.key === "+" || e.key === "=") this.zoomBy(1.25);
      else if (e.key === "-") this.zoomBy(0.8);
      else if (e.key === "ArrowLeft") { this.tx += step; this.requestDraw(); }
      else if (e.key === "ArrowRight") { this.tx -= step; this.requestDraw(); }
      else if (e.key === "ArrowUp") { this.ty += step; this.requestDraw(); }
      else if (e.key === "ArrowDown") { this.ty -= step; this.requestDraw(); }
      else if (e.key === "0") this.fitWorld(true);
      else if (e.key === "Enter" || e.key === " ") {
        const i = this.cellAt(this.canvas.width / this.dpr / 2, this.canvas.height / this.dpr / 2);
        if (i >= 0) this.onCellClick(i);
      } else return;
      e.preventDefault();
    });
  }
}
