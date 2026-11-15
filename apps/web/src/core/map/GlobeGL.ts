// 3D globe on the GPU: the same per-pixel maths as GlobeView (orthographic, pixel → lat/lon), moved into one
// fragment shader that paints a single full-screen triangle. No library, no mesh, no 3D camera.
// Measured on Diego's laptop (Radeon R2): 9 ms per 1366×768 frame vs 118 ms for the Canvas loop at 800 px.
//
// Same public API as GlobeView and MapView, so MapCanvas can swap them. Extra over GlobeView:
//   · real imagery (imagery.ts): an undated base (Blue Marble / Viking / LRO) + a dated evidence layer, global and
//     as a sharper regional patch when zoomed in; the corner label always says kind · source · date · resolution;
//   · black swaths (no satellite pass that day) are shown as "no observation" stripes, not hidden (D2);
//   · lighting touches only the imagery: verdict colours stay exactly the legend's (doc v2, P4);
//   · Mars and the Moon use the same shader with another base (H7).
// Drawing is on demand: nothing runs while the view is still.

import type { BBox, MapData, Timing } from "./MapView";
import { type MapTheme, effectStep, hexToRgb, seqStep, stepColor } from "./palette";
import { landMask, landRings } from "./world";
import { type Body, type LayerDef, type Mosaic, baseLayer, degPerPx, imageryLabel, layer as layerById, levelFor, levelGeometry, loadMosaic } from "./imagery";
import { detectTier } from "./tier";

const RAD = Math.PI / 180;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
type RGB = [number, number, number];

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uPx; uniform vec2 uCenter; uniform float uR;
uniform vec3 uBg; uniform vec3 uOcean; uniform vec3 uLand; uniform vec3 uInk; uniform float uInkAlpha;
uniform vec3 uAtmo; uniform float uAtmoK;
uniform sampler2D uMask; uniform float uHasMask;
uniform sampler2D uBase; uniform float uHasBase;
uniform sampler2D uDay; uniform float uHasDay;
uniform sampler2D uPatch; uniform float uHasPatch; uniform vec4 uPatchBox;
// 1 = PNG variable layer: transparent means «no value here» (ocean, outside the product), not a missed pass.
uniform float uAlphaLayer;
uniform sampler2D uFill; uniform sampler2D uCode; uniform float uHasData; uniform vec4 uGrid; uniform vec2 uGridN; uniform float uDataAlpha;
const float PI = 3.14159265;
const float R2D = 57.2957795;
float missing(vec3 c){ return step(c.r + c.g + c.b, 0.06); }
void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y * uPx - gl_FragCoord.y) / uPx;
  vec2 p = vec2((fc.x - uRes.x * 0.5) / uR, -(fc.y - uRes.y * 0.5) / uR);
  float r2 = dot(p, p);
  if (r2 > 1.0) {
    float h = clamp((1.18 - sqrt(r2)) / 0.18, 0.0, 1.0);
    gl_FragColor = vec4(mix(uBg, uAtmo, h * h * 0.45 * uAtmoK), 1.0);
    return;
  }
  float z = sqrt(1.0 - r2);
  float s0 = sin(uCenter.y), c0 = cos(uCenter.y);
  float lat = asin(clamp(z * s0 + p.y * c0, -1.0, 1.0));
  float lon = uCenter.x + atan(p.x, z * c0 - p.y * s0);
  lon = mod(lon + PI, 2.0 * PI) - PI;
  float latD = lat * R2D, lonD = lon * R2D;
  vec2 uv = vec2((lonD + 180.0) / 360.0, (90.0 - latD) / 180.0);

  // Fetch as few textures as possible (the Radeon R2 is bandwidth-bound): the sharpest valid layer wins and the
  // layers under it are only read where it has no observation.
  bool inPatch = uHasPatch > 0.5 && lonD >= uPatchBox.x && lonD <= uPatchBox.z && latD >= uPatchBox.y && latD <= uPatchBox.w;
  vec4 top = vec4(0.0);
  if (inPatch) top = texture2D(uPatch, vec2((lonD - uPatchBox.x) / (uPatchBox.z - uPatchBox.x), (uPatchBox.w - latD) / (uPatchBox.w - uPatchBox.y)));
  if (uHasDay > 0.5 && (!inPatch || top.a < 0.5 || (uAlphaLayer < 0.5 && missing(top.rgb) > 0.5))) {
    vec4 d = texture2D(uDay, uv);
    if (uAlphaLayer > 0.5 || top.a < 0.5 || missing(d.rgb) < 0.5) top = d;
  }
  bool hasTop = uHasDay > 0.5 || inPatch;
  float noObs = 0.0;
  vec3 col;
  if (hasTop && uAlphaLayer < 0.5 && top.a > 0.5 && missing(top.rgb) < 0.5) col = top.rgb;
  else {
    col = uOcean;
    if (uHasBase > 0.5) col = texture2D(uBase, uv).rgb;
    else if (uHasMask > 0.5) col = mix(uOcean, uLand, step(0.5, texture2D(uMask, uv).r));
    if (hasTop && uAlphaLayer > 0.5) col = mix(col, top.rgb, top.a * 0.85);
    else if (hasTop) noObs = 1.0;
  }
  // Soft light from the upper left + darker limb, on the picture only.
  float lambert = max(0.0, dot(vec3(p, z), normalize(vec3(-0.45, 0.5, 0.74))));
  float lit = uHasBase > 0.5 ? (0.72 + 0.28 * lambert) * (0.88 + 0.12 * z) : (0.58 + 0.42 * lambert) * (0.82 + 0.18 * z);
  col *= lit;
  if (noObs > 0.5) { col = mix(col, uBg, 0.45); if (mod(fc.x - fc.y, 9.0) < 1.2) col = mix(col, uInk, 0.35); }
  col = mix(col, uAtmo, pow(1.0 - z, 3.0) * 0.55 * uAtmoK);

  // Data on top, unlit: same colour as the legend everywhere on the disc.
  if (uHasData > 0.5) {
    float row = floor((latD - uGrid.x) / uGrid.y + 0.5);
    float cc = floor((lonD - uGrid.z) / uGrid.w + 0.5);
    cc = mod(cc, uGridN.y);
    if (row >= 0.0 && row < uGridN.x) {
      vec2 tuv = vec2((cc + 0.5) / uGridN.y, (row + 0.5) / uGridN.x);
      vec4 f = texture2D(uFill, tuv);
      float code = floor(texture2D(uCode, tuv).r * 255.0 + 0.5);
      if (f.a > 0.004) col = mix(col, f.rgb, f.a * uDataAlpha);
      else if (code == 3.0) {
        col = mix(col, uInk, 0.1 * uDataAlpha);
        if (mod(fc.x + fc.y, 10.0) < 1.4) col = mix(col, uInk, uInkAlpha * uDataAlpha);
      } else if (code == 2.0) {
        if (mod(fc.x, 6.0) < 2.0 && mod(fc.y, 6.0) < 2.0) col = mix(col, uInk, min(1.0, uInkAlpha + 0.3) * uDataAlpha);
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const ATMO: Record<Body, { rgb: RGB; k: number }> = {
  earth: { rgb: [120, 170, 255], k: 1 },
  mars: { rgb: [230, 160, 110], k: 0.55 },
  moon: { rgb: [0, 0, 0], k: 0 },
};

export interface ImageryChoice { layer: string; date?: string }

function nextPow2Below(n: number, max: number): number {
  let p = 1;
  while (p * 2 <= Math.min(n, max)) p *= 2;
  return Math.max(p, 64);
}

export class GlobeGL {
  readonly canvas: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private o2d: CanvasRenderingContext2D;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private tex: Record<"mask" | "base" | "day" | "patch" | "fill" | "code", WebGLTexture | null> = { mask: null, base: null, day: null, patch: null, fill: null, code: null };
  private has = { mask: 0, base: 0, day: 0, patch: 0, data: 0 };
  private patchBox: [number, number, number, number] = [0, 0, 0, 0];
  private theme: MapTheme;
  private data: MapData | null = null;
  private filter: Set<number> | null = null;
  private body: Body = "earth";
  private imagery: ImageryChoice | null = null;
  private dataAlpha: number | null = null;
  private lon0 = -60;
  private lat0 = 18;
  private zoom = 1;
  private w = 1;
  private h = 1;
  private px = 1;
  private selected = -1;
  private hovered = -1;
  private region: BBox | null = null;
  private raf = 0;
  private anim = 0;
  private settle = 0;
  private ro: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private aborts: { base?: AbortController; day?: AbortController; patch?: AbortController } = {};
  private patchKey = "";
  private lost = false;
  private status = { base: "", day: "", patch: "" };
  lastTiming: Timing = { buildMs: 0, drawMs: 0 };
  onCellClick: (index: number) => void = () => {};
  onHover: (index: number, x: number, y: number) => void = () => {};
  /** Corner label: what picture is on screen (kind · source · date · resolution). */
  onImagery: (label: string) => void = () => {};
  /** The GPU went away: the owner should fall back to the Canvas globe. */
  onLost: () => void = () => {};

  /** Throws when WebGL is not available; callers fall back to GlobeView. */
  constructor(parent: HTMLElement, theme: MapTheme, label: string) {
    this.theme = theme;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "absolute inset-0 block h-full w-full touch-none outline-none cursor-grab active:cursor-grabbing";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", label);
    const gl = this.canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true }) as WebGLRenderingContext | null;
    if (!gl) throw new Error("WebGL no disponible");
    this.gl = gl;
    this.prog = this.program();
    this.overlay = document.createElement("canvas");
    this.overlay.className = "pointer-events-none absolute inset-0 block h-full w-full";
    this.o2d = this.overlay.getContext("2d")!;
    parent.appendChild(this.canvas);
    parent.appendChild(this.overlay);
    this.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; this.onLost(); });
    this.uploadMask();
    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(parent);
    this.resize();
    this.loadBase();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.anim);
    clearTimeout(this.settle);
    for (const a of Object.values(this.aborts)) a?.abort();
    this.ro.disconnect();
    for (const f of this.cleanup) f();
    const gl = this.gl;
    for (const t of Object.values(this.tex)) if (t) gl.deleteTexture(t);
    gl.deleteProgram(this.prog);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.remove();
    this.overlay.remove();
  }

  // ---- same API as GlobeView ----

  setLabel(label: string): void { this.canvas.setAttribute("aria-label", label); }
  setTheme(theme: MapTheme): void { this.theme = theme; if (this.data) this.setData(this.data); else this.requestDraw(); }
  setFilter(verdicts: number[] | null): void {
    this.filter = verdicts && verdicts.length ? new Set(verdicts) : null;
    if (this.data) this.setData(this.data);
  }
  setRegion(b: BBox | null): void { this.region = b; this.requestOverlay(); }
  select(index: number): void { this.selected = index; this.requestOverlay(); }

  /** Pre-computes one colour (+ alpha) and one texture code per grid cell, as GlobeView does, into two textures. */
  setData(d: MapData): void {
    const t0 = performance.now();
    this.data = d;
    const n = d.grid.nlat * d.grid.nlon;
    const fill = new Uint8Array(n * 4);
    const code = new Uint8Array(n * 4);
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
      else if ((v === 2 || v === 3) && on) code[i * 4] = v;
    }
    this.tex.fill = this.upload(this.tex.fill, d.grid.nlon, d.grid.nlat, fill, false);
    this.tex.code = this.upload(this.tex.code, d.grid.nlon, d.grid.nlat, code, false);
    this.has.data = 1;
    this.lastTiming.buildMs = performance.now() - t0;
    this.draw();
  }

  // ---- extras over GlobeView ----

  /** Earth, Mars or the Moon: same globe, another base picture. Coastlines only on Earth. */
  setBody(body: Body): void {
    if (body === this.body) return;
    this.body = body;
    this.imagery = null;
    this.dropLayer("day");
    this.dropLayer("patch");
    this.loadBase();
  }

  /** Dated evidence imagery over the base (null = base only). */
  setImagery(choice: ImageryChoice | null): void {
    const same = choice && this.imagery && choice.layer === this.imagery.layer && choice.date === this.imagery.date;
    if (same || (!choice && !this.imagery)) return;
    this.imagery = choice;
    this.patchKey = "";
    if (!choice) { this.dropLayer("day"); this.dropLayer("patch"); this.announce(); this.requestDraw(); return; }
    this.loadDay();
    this.schedulePatch();
  }

  /** Opacity of the data grid over the picture (null = automatic: opaque when far, see-through when close). */
  setDataOpacity(a: number | null): void { this.dataAlpha = a; this.requestDraw(); }

  // ---- camera ----

  private R(): number { return Math.min(this.w, this.h) * 0.43 * this.zoom; }

  fitWorld(animate = false): void { this.moveTo(this.lon0, Math.max(-30, Math.min(30, this.lat0)), 1, animate); }

  flyTo(lat: number, lon: number, spanDeg: number): void {
    this.moveTo(lon, lat, Math.max(1.3, Math.min(2.4, 150 / spanDeg)), true);
  }

  flyToBox(b: BBox): void {
    const [x0, y0, x1, y1] = b;
    this.flyTo((y0 + y1) / 2, (x0 + x1) / 2, Math.max(x1 - x0, (y1 - y0) * 1.5) * 6);
  }

  /** Up to ×400: a Durango-sized view where the 30 m Sentinel-2/Landsat layer shows its real detail. */
  /** Interaction layer (doc «Interacción v2» §2.6): move as if dragged by (dx, dy) fractions of the view. */
  orbit(dx: number, dy: number): void {
    cancelAnimationFrame(this.anim);
    const k = 1 / RAD / this.R(); // degrees per pixel at the centre, as when dragging
    this.lon0 = ((this.lon0 - dx * this.w * k + 540) % 360) - 180;
    this.lat0 = Math.max(-85, Math.min(85, this.lat0 + dy * this.h * k));
    this.cameraMoved();
  }

  reset(): void { this.fitWorld(true); }

  zoomBy(f: number): void { this.zoom = Math.max(0.8, Math.min(400, this.zoom * f)); this.cameraMoved(); }

  private moveTo(lon: number, lat: number, zoom: number, animate: boolean): void {
    cancelAnimationFrame(this.anim);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce) { this.lon0 = lon; this.lat0 = lat; this.zoom = zoom; this.cameraMoved(); return; }
    const from = { lon: this.lon0, lat: this.lat0, z: Math.log(this.zoom) };
    let dl = ((lon - from.lon + 540) % 360) - 180;
    if (dl < -180) dl += 360;
    const start = performance.now(), dur = 900;
    const step = (now: number) => {
      const p = easeInOut(Math.min(1, (now - start) / dur));
      this.lon0 = from.lon + dl * p;
      this.lat0 = from.lat + (lat - from.lat) * p;
      this.zoom = Math.exp(from.z + (Math.log(zoom) - from.z) * p) * (1 - 0.25 * Math.sin(Math.PI * p));
      this.draw();
      if (p < 1) this.anim = requestAnimationFrame(step);
      else this.schedulePatch();
    };
    this.anim = requestAnimationFrame(step);
  }

  private cameraMoved(): void { this.requestDraw(); this.schedulePatch(); }

  private resize(): void {
    const r = this.canvas.parentElement?.getBoundingClientRect();
    if (!r || r.width < 2 || r.height < 2) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.px = Math.min(dpr, detectTier().renderScale);
    this.w = Math.round(r.width);
    this.h = Math.round(r.height);
    this.canvas.width = Math.round(this.w * this.px);
    this.canvas.height = Math.round(this.h * this.px);
    this.overlay.width = Math.round(this.w * dpr);
    this.overlay.height = Math.round(this.h * dpr);
    this.draw();
  }

  private requestDraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  /** Hover and selection only repaint the thin 2D layer, never the sphere (doc v2, P2). */
  private ovRaf = 0;
  private requestOverlay(): void {
    if (this.ovRaf || this.raf) return;
    this.ovRaf = requestAnimationFrame(() => { this.ovRaf = 0; this.drawOverlay(); });
  }

  // ---- projection (same formulas as GlobeView) ----

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
    col = ((col % d.nlon) + d.nlon) % d.nlon;
    if (row < 0 || row >= d.nlat) return -1;
    return row * d.nlon + col;
  }

  /** Visible lon/lat box, sampled on the screen; null when it wraps the antimeridian or a pole. */
  private visibleBox(): [number, number, number, number] | null {
    let x0 = 180, x1 = -180, y0 = 90, y1 = -90, hits = 0;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const ll = this.invert((this.w * i) / 8, (this.h * j) / 8);
      if (!ll) continue;
      hits++;
      x0 = Math.min(x0, ll.lon); x1 = Math.max(x1, ll.lon); y0 = Math.min(y0, ll.lat); y1 = Math.max(y1, ll.lat);
    }
    if (hits < 4 || x1 - x0 > 180) return null;
    const padX = (x1 - x0) * 0.1, padY = (y1 - y0) * 0.1;
    return [Math.max(-180, x0 - padX), Math.max(-90, y0 - padY), Math.min(180, x1 + padX), Math.min(90, y1 + padY)];
  }

  // ---- GL plumbing ----

  private program(): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(p, 0, "a");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["uRes", "uPx", "uCenter", "uR", "uBg", "uOcean", "uLand", "uInk", "uInkAlpha", "uAtmo", "uAtmoK", "uMask", "uHasMask", "uBase", "uHasBase", "uDay", "uHasDay", "uPatch", "uHasPatch", "uPatchBox", "uAlphaLayer", "uFill", "uCode", "uHasData", "uGrid", "uGridN", "uDataAlpha"]) this.u[n] = gl.getUniformLocation(p, n);
    const units: Record<string, number> = { uMask: 0, uBase: 1, uDay: 2, uPatch: 3, uFill: 4, uCode: 5 };
    for (const [n, k] of Object.entries(units)) gl.uniform1i(this.u[n], k);
    return p;
  }

  /** Raw pixels (grids): nearest, no mipmaps. */
  private upload(t: WebGLTexture | null, w: number, h: number, px: Uint8Array, linear: boolean): WebGLTexture {
    const gl = this.gl;
    const tex = t ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** Pictures: resampled to power-of-two sizes so mipmaps work on WebGL1 (no shimmer when zoomed out). */
  private uploadPicture(t: WebGLTexture | null, src: HTMLCanvasElement, maxW: number): WebGLTexture {
    const gl = this.gl;
    const w = nextPow2Below(src.width, maxW), h = nextPow2Below(src.height, maxW);
    let img: HTMLCanvasElement = src;
    if (w !== src.width || h !== src.height) {
      img = document.createElement("canvas");
      img.width = w; img.height = h;
      const g = img.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.drawImage(src, 0, 0, w, h);
    }
    const tex = t ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST); // bilinear: half the reads of trilinear
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private uploadMask(): void {
    const m = landMask();
    const px = new Uint8Array(m.w * m.h * 4);
    for (let i = 0; i < m.w * m.h; i++) px[i * 4] = m.data[i] ? 255 : 0;
    this.tex.mask = this.upload(this.tex.mask, m.w, m.h, px, true);
    this.has.mask = 1;
  }

  private dropLayer(k: "base" | "day" | "patch"): void {
    this.aborts[k]?.abort();
    this.has[k] = 0;
    this.status[k] = "";
  }

  // ---- imagery ----

  /** Level whose whole-world mosaic fits the tier's base texture. */
  private globalLevel(l: LayerDef): number {
    const max = detectTier().baseMax;
    let z = 0;
    while (z < l.maxLevel && 360 / degPerPx(l.provider, z + 1) <= max) z++;
    return z;
  }

  private async loadBase(): Promise<void> {
    const l = baseLayer(this.body);
    this.dropLayer("base");
    const ctrl = new AbortController();
    this.aborts.base = ctrl;
    const body = this.body;
    const z = this.globalLevel(l);
    const m = await loadMosaic(l, z, [-180, -90, 180, 90], { signal: ctrl.signal });
    if (ctrl.signal.aborted || this.lost || body !== this.body) return;
    if (m.missing === m.total) { this.status.base = ""; this.announce(); return; }
    this.tex.base = this.uploadPicture(this.tex.base, m.canvas, detectTier().baseMax);
    this.has.base = 1;
    this.status.base = imageryLabel(m);
    this.announce();
    this.requestDraw();
  }

  private async loadDay(): Promise<void> {
    const choice = this.imagery;
    if (!choice) return;
    const l = layerById(choice.layer);
    this.dropLayer("day");
    if (l.body !== this.body) return;
    const ctrl = new AbortController();
    this.aborts.day = ctrl;
    const z = Math.min(this.globalLevel(l), 3);
    const m = await loadMosaic(l, z, [-180, -90, 180, 90], { date: choice.date, signal: ctrl.signal });
    if (ctrl.signal.aborted || this.lost || choice !== this.imagery) return;
    if (m.missing === m.total) { this.status.day = `Sin observación de ${l.title} en ${choice.date ?? "esa fecha"}`; this.announce(); return; }
    this.tex.day = this.uploadPicture(this.tex.day, m.canvas, detectTier().baseMax);
    this.has.day = 1;
    this.status.day = imageryLabel(m);
    this.announce();
    this.requestDraw();
  }

  /** After the camera stops for 250 ms, fetch a sharper patch of the evidence layer for what is on screen. */
  private schedulePatch(): void {
    clearTimeout(this.settle);
    this.settle = window.setTimeout(() => this.loadPatch(), 250);
  }

  private async loadPatch(): Promise<void> {
    const choice = this.imagery;
    if (!choice || this.zoom < 1.8 || document.hidden) { if (this.has.patch && this.zoom < 1.8) { this.dropLayer("patch"); this.announce(); this.requestDraw(); } return; }
    const l = layerById(choice.layer);
    if (l.body !== this.body) return;
    const box = this.visibleBox();
    if (!box) return;
    const maxSide = detectTier().patchMax;
    const screenDegPerPx = 1 / RAD / this.R();
    let z = levelFor(l, screenDegPerPx);
    // Keep the patch inside its texture budget: drop a level until it fits.
    const fits = (zz: number) => {
      const g = levelGeometry(l.provider, zz);
      const ppd = g.px / g.tileDeg;
      return (box[2] - box[0] + g.tileDeg) * ppd <= maxSide * 2 && (box[3] - box[1] + g.tileDeg) * ppd <= maxSide * 2;
    };
    while (z > 0 && !fits(z)) z--;
    const key = `${choice.layer}|${choice.date}|${z}|${box.map((v) => Math.round(v / levelGeometry(l.provider, z).tileDeg)).join(",")}`;
    if (key === this.patchKey) return;
    this.patchKey = key;
    this.aborts.patch?.abort();
    const ctrl = new AbortController();
    this.aborts.patch = ctrl;
    const show = (m: Mosaic) => {
      if (ctrl.signal.aborted || this.lost) return;
      this.tex.patch = this.uploadPicture(this.tex.patch, m.canvas, maxSide);
      this.patchBox = m.bbox;
      this.has.patch = 1;
      this.status.patch = imageryLabel(m);
      this.announce();
      this.requestDraw();
    };
    const m = await loadMosaic(l, z, box, { date: choice.date, signal: ctrl.signal, onProgress: show });
    if (m.missing < m.total) show(m);
    else if (!ctrl.signal.aborted) { this.status.patch = `Sin observación aquí en ${choice.date ?? "esa fecha"}`; this.announce(); }
  }

  private announce(): void {
    const s = this.status;
    this.onImagery(s.patch || s.day || s.base || "");
  }

  // ---- drawing ----

  draw(): void {
    if (this.lost) return;
    const t0 = performance.now();
    const gl = this.gl, th = this.theme;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const css = (n: string, fb: string) => getComputedStyle(this.canvas).getPropertyValue(n).trim() || fb;
    const v3 = (hex: string) => hexToRgb(hex).map((c) => c / 255) as RGB;
    const bgHex = css("--surface-2", th.ocean);
    const u = this.u;
    gl.uniform2f(u.uRes, this.w, this.h);
    gl.uniform1f(u.uPx, this.px);
    gl.uniform2f(u.uCenter, this.lon0 * RAD, this.lat0 * RAD);
    gl.uniform1f(u.uR, this.R());
    gl.uniform3fv(u.uBg, bgHex.startsWith("#") ? v3(bgHex) : v3(th.ocean));
    gl.uniform3fv(u.uOcean, v3(this.body === "earth" ? th.ocean : this.body === "mars" ? "#9a5a3c" : "#8a8a8a"));
    gl.uniform3fv(u.uLand, v3(th.land));
    gl.uniform3fv(u.uInk, v3(th.ink));
    gl.uniform1f(u.uInkAlpha, th.inkAlpha);
    const atmo = ATMO[this.body];
    gl.uniform3fv(u.uAtmo, atmo.rgb.map((c) => c / 255));
    gl.uniform1f(u.uAtmoK, atmo.k);
    gl.uniform1f(u.uHasMask, this.body === "earth" ? this.has.mask : 0);
    gl.uniform1f(u.uHasBase, this.has.base);
    gl.uniform1f(u.uHasDay, this.has.day);
    gl.uniform1f(u.uHasPatch, this.has.patch);
    gl.uniform4f(u.uPatchBox, this.patchBox[0], this.patchBox[1], this.patchBox[2], this.patchBox[3]);
    gl.uniform1f(u.uAlphaLayer, this.imagery && layerById(this.imagery.layer).ext === "png" ? 1 : 0);
    const d = this.data?.grid;
    gl.uniform1f(u.uHasData, d ? this.has.data : 0);
    if (d) {
      gl.uniform4f(u.uGrid, d.lat0, d.dlat, d.lon0, d.dlon);
      gl.uniform2f(u.uGridN, d.nlat, d.nlon);
    }
    // Opaque when far (exact legend colours); see-through when the real picture becomes the point.
    const auto = this.has.day || this.has.patch ? Math.max(0.4, Math.min(1, 1.6 - this.zoom * 0.3)) : 1;
    gl.uniform1f(u.uDataAlpha, this.dataAlpha ?? auto);
    const bind = (unit: number, t: WebGLTexture | null) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
    bind(0, this.tex.mask); bind(1, this.tex.base); bind(2, this.tex.day); bind(3, this.tex.patch); bind(4, this.tex.fill); bind(5, this.tex.code);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawOverlay();
    this.lastTiming.drawMs = performance.now() - t0;
  }

  private drawOverlay(): void {
    const g = this.o2d, th = this.theme;
    const dpr = this.overlay.width / this.w;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.lineJoin = "round";
    this.strokeLines(this.graticule(), th.landLine, 0.5, this.has.base ? 0.2 : 0.35);
    if (this.body === "earth") this.strokeLines(landRings(), this.has.base ? "rgba(255,255,255,0.55)" : th.landLine, 0.8, this.has.base ? 0.5 : 0.9);
    this.drawRegion();
    this.drawCell(this.hovered, 1.25, 0.85);
    this.drawCell(this.selected, 2.5, 1);
  }

  private graticule(): [number, number][][] {
    const lines: [number, number][][] = [];
    for (let lon = -180; lon < 180; lon += 30) lines.push(Array.from({ length: 37 }, (_, k) => [lon, -90 + k * 5] as [number, number]));
    for (let lat = -60; lat <= 60; lat += 30) lines.push(Array.from({ length: 73 }, (_, k) => [-180 + k * 5, lat] as [number, number]));
    return lines;
  }

  private strokeLines(lines: [number, number][][], colour: string, width: number, alpha: number): void {
    const g = this.o2d;
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
    const g = this.o2d;
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
    const minDeg = (10 / this.R()) / RAD;
    const hw = Math.max(Math.abs(d.dlon), minDeg) / 2, hh = Math.max(Math.abs(d.dlat), minDeg) / 2;
    this.outline(this.box(lon - hw, lat - hh, lon + hw, lat + hh), width, alpha);
  }

  // ---- input (same gestures as GlobeView) ----

  private on<K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    this.canvas.addEventListener(type, fn as EventListener, opts);
    this.cleanup.push(() => this.canvas.removeEventListener(type, fn as EventListener, opts));
  }

  private setHover(i: number, x: number, y: number): void {
    if (i !== this.hovered) { this.hovered = i; this.requestOverlay(); }
    this.onHover(i, x, y);
  }

  private bindEvents(): void {
    let down: { x: number; y: number; lon: number; lat: number; moved: boolean } | null = null;
    this.on("pointerdown", (e) => {
      cancelAnimationFrame(this.anim);
      this.canvas.setPointerCapture(e.pointerId);
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
        const k = 1 / RAD / this.R();
        this.lon0 = down.lon - dx * k;
        this.lat0 = Math.max(-85, Math.min(85, down.lat + dy * k));
        this.setHover(-1, 0, 0);
        this.cameraMoved();
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
      else if (e.key === "ArrowLeft") { this.lon0 -= 10 / this.zoom; this.cameraMoved(); }
      else if (e.key === "ArrowRight") { this.lon0 += 10 / this.zoom; this.cameraMoved(); }
      else if (e.key === "ArrowUp") { this.lat0 = Math.min(85, this.lat0 + 10 / this.zoom); this.cameraMoved(); }
      else if (e.key === "ArrowDown") { this.lat0 = Math.max(-85, this.lat0 - 10 / this.zoom); this.cameraMoved(); }
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
