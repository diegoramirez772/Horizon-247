// A real place in 3D (Monitoreo · «Ver esta zona en 3D real»): the actual relief (AWS Terrain Tiles, Terrarium
// encoding, open data) with the actual ground on top (Sentinel-2 cloudless 2020 by EOX, ~10 m). Unlike the generated
// scene, nothing here is invented: every vertex is a measured height and every pixel a satellite pixel.
// Plain WebGL 1, one mesh, one texture; drag to orbit, wheel / pinch / gestures to zoom.
//
// Quality pass (traspaso 3D, D3), all computed once on the CPU or in one fragment shader:
//   · sun at 10:30 local solar time of today, for this latitude (never below 12° so relief stays readable);
//   · ambient occlusion baked per vertex from the measured heights; sky/ground hemisphere light;
//   · aerial perspective (distance haze) and a sky gradient; ACES tone mapping with correct sRGB ↔ linear;
//   · HORI's verdict draped per cell (core/detect/drape.ts): solid tint = supported, dots = candidate,
//     stripes = not known yet, grey = no change > δ, with the cell edges drawn where HORI's cells are;
//   · zone size from 12 km up to a focus (≤ 900 km): the terrain and imagery levels follow the size;
//   · mesh density by device tier, and drawing only when something moved (the laptop rests when still).

import { DETAIL_EARTH, levelFor, loadMosaic, type Mosaic } from "@/core/map/imagery";
import { detectTier } from "@/core/map/tier";
import type { Drape } from "@/core/detect/drape";

const TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

export interface TerrainStatus { phase: "loading" | "ready" | "error"; text: string; minM?: number; maxM?: number; halfKm?: number }

type Mat = Float32Array;
type Box = [number, number, number, number];

function perspective(fovy: number, aspect: number, near: number, far: number): Mat {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(e: number[], c: number[], up: number[]): Mat {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
}
function mul(a: Mat, b: Mat): Mat {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}

/**
 * Sun direction in mesh space (+x east, +y up, +z south) at 10:30 local solar time on `date` at `lat`.
 * Declination by Cooper's formula; enough for shading (±1°).
 */
export function sunDir(lat: number, date = new Date()): [number, number, number] {
  const R = Math.PI / 180;
  const doy = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5);
  const dec = 23.44 * R * Math.sin((2 * Math.PI * (284 + doy)) / 365);
  const H = -22.5 * R, phi = lat * R;
  let el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const cosAz = (Math.sin(dec) - Math.sin(el) * Math.sin(phi)) / (Math.cos(el) * Math.cos(phi) || 1e-6);
  const az = Math.acos(Math.max(-1, Math.min(1, cosAz))); // morning: east of the meridian
  el = Math.max(12 * R, el);
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

const VS = `attribute vec3 aP; attribute vec2 aT; attribute vec3 aN; attribute float aO;
uniform mat4 uM; uniform vec4 uDrapeMap;
varying vec2 vT; varying vec2 vE; varying vec3 vN; varying float vD; varying float vO; varying float vH;
void main(){
  vT=aT; vN=aN; vO=aO; vH=aP.y;
  vE = (aP.xz*0.5+0.5)*uDrapeMap.xy + uDrapeMap.zw;
  vec4 p=uM*vec4(aP,1.0); vD=p.w; gl_Position=p;
}`;
const FS = `precision mediump float;
uniform sampler2D uTex; uniform float uHas; uniform vec3 uSun; uniform vec3 uSky; uniform vec3 uFogC; uniform float uFog;
uniform sampler2D uDrape; uniform float uHasDrape; uniform float uDrapeA; uniform vec2 uDrapeN; uniform vec3 uInk; uniform vec3 uGrey;
varying vec2 vT; varying vec2 vE; varying vec3 vN; varying float vD; varying float vO; varying float vH;
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
void main(){
  vec3 n = normalize(vN);
  vec3 base = lin(uHas>0.5 ? texture2D(uTex,vT).rgb : vec3(0.62,0.58,0.48));
  float diff = max(dot(n,uSun),0.0);
  vec3 amb = mix(vec3(0.30,0.27,0.22), lin(uSky), n.y*0.5+0.5) * 0.55;
  vec3 c = base * (vec3(1.0,0.96,0.88)*diff*1.55*(0.6+0.4*vO) + amb*vO);
  float haze = 1.0 - exp(-max(vD-0.6,0.0)*uFog);
  c = mix(c, lin(uFogC), clamp(haze,0.0,0.7));
  c = pow(aces(c*1.1), vec3(1.0/2.2));
  if (uHasDrape > 0.5 && vE.x >= 0.0 && vE.x <= 1.0 && vE.y >= 0.0 && vE.y <= 1.0) {
    vec4 e = texture2D(uDrape, vE);
    float code = floor(e.a*255.0+0.5);
    float shade = 0.72 + 0.28*diff;
    vec2 fc = gl_FragCoord.xy;
    if (code > 250.0) c = mix(c, e.rgb*shade, 0.58*uDrapeA);
    else if (code > 190.0) c = mix(c, uGrey*shade, 0.5*uDrapeA);
    else if (code > 100.0) { c = mix(c, uInk, 0.08*uDrapeA); if (mod(fc.x,7.0)<2.0 && mod(fc.y,7.0)<2.0) c = mix(c, uInk, 0.75*uDrapeA); }
    else if (code > 40.0) { c = mix(c, uInk, 0.12*uDrapeA); if (mod(fc.x-fc.y,10.0)<1.7) c = mix(c, uInk, 0.6*uDrapeA); }
    vec2 g = abs(fract(vE*uDrapeN)-0.5);
    float edge = 0.5 - 0.004*max(uDrapeN.x,uDrapeN.y);
    if (max(g.x,g.y) > edge) c = mix(c, vec3(1.0), 0.55*uDrapeA);
  }
  gl_FragColor = vec4(c,1.0);
}`;
const SKY_VS = `attribute vec2 a; varying float vY; void main(){ vY=a.y*0.5+0.5; gl_Position=vec4(a,0.999,1.0); }`;
const SKY_FS = `precision mediump float; uniform vec3 uTop; uniform vec3 uHor; uniform float uH; varying float vY;
void main(){ float t = clamp((vY-uH)/(1.0-uH), 0.0, 1.0); gl_FragColor = vec4(mix(uHor, uTop, pow(t,0.6)), 1.0); }`;

const SKY_TOP: [number, number, number] = [0.42, 0.6, 0.84];
const SKY_HOR: [number, number, number] = [0.8, 0.86, 0.93];

/** Lon/lat → Web-Mercator tile coordinates (fractional) at zoom z. */
function tileXY(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

/** Terrain level so the zone spans at most ~3 tiles per side (z 3 … 12; 12 ≈ 30 m). */
export function terrainLevel(lat: number, halfKm: number): number {
  const z = Math.floor(Math.log2((40075 * Math.cos((lat * Math.PI) / 180) * 3) / (2 * halfKm)));
  return Math.max(3, Math.min(12, z));
}

/** Half-side of the zone in km for a box (a focus): the box plus 10 %, between 6 km and 450 km. */
export function zoneHalfKm(lat: number, box?: Box): number {
  if (!box) return 6;
  const w = (box[2] - box[0]) * 111.32 * Math.cos((lat * Math.PI) / 180), h = (box[3] - box[1]) * 110.574;
  return Math.max(6, Math.min(450, (Math.max(w, h) / 2) * 1.1));
}

/** Base relief factor of a zone: 1 for 12 km, larger for a focus hundreds of km wide (it would look flat). */
export function reliefBase(halfKm: number): number { return Math.max(1, (halfKm / 6) ** 0.6); }

function img(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(url));
    signal.addEventListener("abort", () => rej(new Error("abort")));
    i.src = url;
  });
}

export class TerrainView {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private sky: WebGLProgram;
  private skyBuf: WebGLBuffer;
  private buf: { p: WebGLBuffer; t: WebGLBuffer; n: WebGLBuffer; o: WebGLBuffer; i: WebGLBuffer } | null = null;
  private count = 0;
  private tex: WebGLTexture | null = null;
  private hasTex = false;
  private drapeTex: WebGLTexture | null = null;
  private drape: Drape | null = null;
  private drapeAlpha = 1;
  private readonly N: number;
  private yaw = 0.6;
  private pitch = 0.55;
  private dist = 2.6;
  private spin = true;
  private dirty = true;
  private raf = 0;
  private abort: AbortController | null = null;
  private ro: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private heights: Float32Array | null = null;
  private exaggeration = 1.6;
  private box: Box | null = null;
  private halfKm = 6;
  private sun: [number, number, number] = [-0.45, 0.8, -0.4];
  private last: { lat: number; lon: number; minM: number; maxM: number } | null = null;
  onStatus: (s: TerrainStatus) => void = () => {};

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "block h-full w-full touch-none outline-none cursor-grab";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Relieve real con imagen satelital");
    host.appendChild(this.canvas);
    const tier = detectTier();
    // Denser mesh only where the GPU can take it; the laptop (tier 1) keeps 176 × 176.
    this.N = tier.tier >= 2 ? 256 : 176;
    const gl = this.canvas.getContext("webgl", { antialias: true });
    if (!gl) throw new Error("no-webgl");
    this.gl = gl;
    gl.getExtension("OES_element_index_uint");
    this.prog = this.program(VS, FS);
    this.sky = this.program(SKY_VS, SKY_FS);
    this.skyBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.bind();
    this.ro = new ResizeObserver(() => { this.dirty = true; });
    this.ro.observe(host);
    // Draw only when something changed or while it turns by itself: a still view costs nothing.
    const loop = () => {
      if (this.spin) { this.yaw += 0.0025; this.dirty = true; }
      if (this.dirty) { this.dirty = false; this.draw(); }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("shader");
    return p;
  }

  private bind(): void {
    let down: { x: number; y: number } | null = null;
    const c = this.canvas;
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; this.spin = false; try { c.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } c.style.cursor = "grabbing"; };
    const pm = (e: PointerEvent) => {
      if (!down) return;
      this.orbit((e.clientX - down.x) / c.clientWidth, (e.clientY - down.y) / c.clientHeight);
      down = { x: e.clientX, y: e.clientY };
    };
    const pu = () => { down = null; c.style.cursor = "grab"; };
    const wh = (e: WheelEvent) => { e.preventDefault(); this.spin = false; this.zoomBy(e.deltaY < 0 ? 1.12 : 0.89); };
    c.addEventListener("pointerdown", pd); c.addEventListener("pointermove", pm); c.addEventListener("pointerup", pu);
    c.addEventListener("pointercancel", pu); c.addEventListener("wheel", wh, { passive: false });
    this.cleanup.push(() => { c.removeEventListener("pointerdown", pd); c.removeEventListener("pointermove", pm); c.removeEventListener("pointerup", pu); c.removeEventListener("pointercancel", pu); c.removeEventListener("wheel", wh); });
  }

  orbit(dx: number, dy: number): void { this.spin = false; this.yaw -= dx * 3.2; this.pitch = Math.max(0.12, Math.min(1.45, this.pitch + dy * 2.2)); this.dirty = true; }
  zoomBy(f: number): void { this.spin = false; this.dist = Math.max(0.7, Math.min(6, this.dist / f)); this.dirty = true; }
  reset(): void { this.yaw = 0.6; this.pitch = 0.55; this.dist = 2.6; this.spin = true; this.dirty = true; }
  setPlaying(on: boolean): void { this.spin = on; this.dirty = true; }
  isPlaying(): boolean { return this.spin; }

  /** Taller or flatter relief (1 = true scale for a 12 km zone; larger zones get a base factor, see `reliefBase`). */
  setExaggeration(x: number): void {
    this.exaggeration = x;
    if (this.heights && this.last) this.buildMesh(this.heights, this.last.minM);
  }

  /** Large zones (a focus hundreds of km wide) would look flat at true scale: the relief is raised by this base. */
  reliefBase(): number { return reliefBase(this.halfKm); }

  /** HORI's verdict per cell over the relief (null = none) and how strongly it is painted (0…1). */
  setDrape(d: Drape | null, alpha = 1): void {
    const gl = this.gl;
    this.drape = d;
    this.drapeAlpha = alpha;
    if (d) {
      if (!this.drapeTex) this.drapeTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.drapeTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, d.w, d.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, d.rgba);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.dirty = true;
  }

  /** The zone as a lon/lat box (null until loaded): the owner builds the drape for exactly this box. */
  zoneBox(): Box | null { return this.box; }

  async load(lat: number, lon: number, focusBox?: Box): Promise<void> {
    this.abort?.abort();
    const ctrl = new AbortController(); this.abort = ctrl;
    const halfKm = zoneHalfKm(lat, focusBox);
    const dLat = halfKm / 110.574, dLon = halfKm / (111.32 * Math.cos((lat * Math.PI) / 180));
    const box: Box = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
    this.onStatus({ phase: "loading", text: "Bajando el relieve y la imagen satelital…" });
    try {
      const z = Math.min(DETAIL_EARTH.maxLevel, levelFor(DETAIL_EARTH, (2 * dLon) / detectTier().patchMax));
      const [heights, mosaic] = await Promise.all([this.loadHeights(box, terrainLevel(lat, halfKm), ctrl.signal), loadMosaic(DETAIL_EARTH, z, box, { signal: ctrl.signal })]);
      if (ctrl.signal.aborted) return;
      let minM = Infinity, maxM = -Infinity;
      for (const h of heights) { if (h < minM) minM = h; if (h > maxM) maxM = h; }
      this.heights = heights;
      this.box = box;
      this.halfKm = halfKm;
      this.sun = sunDir(lat);
      this.last = { lat, lon, minM, maxM };
      if (halfKm > 6) { this.dist = 2.4; this.pitch = 0.7; }
      this.buildMesh(heights, minM, mosaic, box);
      this.upload(mosaic);
      this.onStatus({ phase: "ready", text: `Relieve de ${Math.round(minM)} a ${Math.round(maxM)} m`, minM, maxM, halfKm });
    } catch (e) {
      if (!ctrl.signal.aborted) this.onStatus({ phase: "error", text: e instanceof Error && e.message === "no-webgl" ? "Sin gráfica 3D" : "No se pudo bajar el relieve o la imagen (¿sin internet?)." });
    }
  }

  /** Terrarium tiles → a grid of heights in metres covering `box` (bilinear between the tile pixels). */
  private async loadHeights(box: Box, z: number, signal: AbortSignal): Promise<Float32Array> {
    const N = this.N;
    const [x0, y1] = tileXY(box[1], box[0], z), [x1, y0] = tileXY(box[3], box[2], z);
    const tx0 = Math.floor(x0), tx1 = Math.floor(x1), ty0 = Math.floor(y0), ty1 = Math.floor(y1);
    const w = (tx1 - tx0 + 1) * 256, h = (ty1 - ty0 + 1) * 256;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d", { willReadFrequently: true })!;
    const jobs: Promise<void>[] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const wrapX = ((tx % 2 ** z) + 2 ** z) % 2 ** z;
      jobs.push(img(`${TERRAIN}/${z}/${wrapX}/${ty}.png`, signal).then((i) => { g.drawImage(i, (tx - tx0) * 256, (ty - ty0) * 256); }));
    }
    await Promise.all(jobs);
    const px = g.getImageData(0, 0, w, h).data;
    const at = (sx: number, sy: number) => {
      const k = (Math.min(h - 1, Math.max(0, sy)) * w + Math.min(w - 1, Math.max(0, sx))) * 4;
      return px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768; // Terrarium encoding
    };
    const out = new Float32Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const lat = box[3] - ((box[3] - box[1]) * r) / (N - 1), lon = box[0] + ((box[2] - box[0]) * c) / (N - 1);
      const [fx, fy] = tileXY(lat, lon, z);
      const gx = (fx - tx0) * 256 - 0.5, gy = (fy - ty0) * 256 - 0.5;
      const ix = Math.floor(gx), iy = Math.floor(gy), ax = gx - ix, ay = gy - iy;
      out[r * N + c] = (at(ix, iy) * (1 - ax) + at(ix + 1, iy) * ax) * (1 - ay) + (at(ix, iy + 1) * (1 - ax) + at(ix + 1, iy + 1) * ax) * ay;
    }
    return out;
  }

  private buildMesh(hs: Float32Array, minM: number, m?: Mosaic, box?: Box): void {
    const gl = this.gl, N = this.N;
    const size = this.halfKm * 1000; // metres from centre to edge
    const ex = this.exaggeration * this.reliefBase();
    const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), nor = new Float32Array(N * N * 3), ao = new Float32Array(N * N);
    const mb = m?.bbox, bb = box;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c;
      pos[i * 3] = (c / (N - 1)) * 2 - 1;
      pos[i * 3 + 1] = ((hs[i] - minM) * ex) / size;
      pos[i * 3 + 2] = (r / (N - 1)) * 2 - 1;
      if (mb && bb) {
        const lon = bb[0] + ((bb[2] - bb[0]) * c) / (N - 1), lat = bb[3] - ((bb[3] - bb[1]) * r) / (N - 1);
        uv[i * 2] = (lon - mb[0]) / (mb[2] - mb[0]);
        uv[i * 2 + 1] = (mb[3] - lat) / (mb[3] - mb[1]);
      }
    }
    const step = 2 / (N - 1);
    const H = (r: number, c: number) => pos[(Math.max(0, Math.min(N - 1, r)) * N + Math.max(0, Math.min(N - 1, c))) * 3 + 1];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c;
      let nx = H(r, c - 1) - H(r, c + 1), ny = 2 * step, nz = H(r - 1, c) - H(r + 1, c);
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      nor[i * 3] = nx; nor[i * 3 + 1] = ny; nor[i * 3 + 2] = nz;
      // Ambient occlusion: how much of the sky the neighbours hide (8 directions × 2 distances, horizon angle).
      const h0 = pos[i * 3 + 1];
      let occ = 0;
      for (let d = 0; d < 8; d++) {
        const a = (d * Math.PI) / 4, dx = Math.cos(a), dy = Math.sin(a);
        let best = 0;
        for (const k of [3, 9]) {
          const rise = H(Math.round(r + dy * k), Math.round(c + dx * k)) - h0;
          if (rise > 0) best = Math.max(best, Math.atan(rise / (k * step)));
        }
        occ += best;
      }
      ao[i] = Math.max(0.45, 1 - (occ / 8) * 1.1);
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let k = 0;
    for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {
      const a = r * N + c, b = a + 1, d = a + N, e = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
    const mk = () => gl.createBuffer()!;
    const fresh = !this.buf;
    if (!this.buf) this.buf = { p: mk(), t: mk(), n: mk(), o: mk(), i: mk() };
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.p); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    if (mb || fresh) { gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.t); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW); }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.n); gl.bufferData(gl.ARRAY_BUFFER, nor, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.o); gl.bufferData(gl.ARRAY_BUFFER, ao, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.count = idx.length;
    this.dirty = true;
  }

  private upload(m: Mosaic): void {
    const gl = this.gl;
    if (!this.tex) this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, m.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasTex = true;
    this.dirty = true;
  }

  private draw(): void {
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(detectTier().tier >= 2 ? 2 : 1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(SKY_HOR[0], SKY_HOR[1], SKY_HOR[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Sky: horizon haze to blue zenith; the horizon line moves with the camera pitch.
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.sky);
    const sa = gl.getAttribLocation(this.sky, "a");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf); gl.enableVertexAttribArray(sa); gl.vertexAttribPointer(sa, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(gl.getUniformLocation(this.sky, "uTop"), SKY_TOP);
    gl.uniform3fv(gl.getUniformLocation(this.sky, "uHor"), SKY_HOR);
    gl.uniform1f(gl.getUniformLocation(this.sky, "uH"), Math.min(0.9, 0.35 + this.pitch * 0.4));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(sa);
    if (!this.buf || !this.count) return;
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);
    const eye = [Math.cos(this.pitch) * Math.sin(this.yaw) * this.dist, Math.sin(this.pitch) * this.dist, Math.cos(this.pitch) * Math.cos(this.yaw) * this.dist];
    const mvp = mul(perspective(0.8, w / h, 0.05, 40), lookAt(eye, [0, 0.05, 0], [0, 1, 0]));
    const P = this.prog;
    const at = (name: string, b: WebGLBuffer, n: number) => {
      const loc = gl.getAttribLocation(P, name);
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    };
    at("aP", this.buf.p, 3); at("aT", this.buf.t, 2); at("aN", this.buf.n, 3); at("aO", this.buf.o, 1);
    const u = (n: string) => gl.getUniformLocation(P, n);
    gl.uniformMatrix4fv(u("uM"), false, mvp);
    gl.uniform3fv(u("uSun"), this.sun);
    gl.uniform3fv(u("uSky"), SKY_TOP);
    gl.uniform3fv(u("uFogC"), SKY_HOR);
    gl.uniform1f(u("uFog"), this.halfKm > 6 ? 0.22 : 0.12);
    gl.uniform1f(u("uHas"), this.hasTex ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(u("uTex"), 0);
    const d = this.drape, b = this.box;
    gl.uniform1f(u("uHasDrape"), d && b ? 1 : 0);
    if (d && b) {
      // zone uv (0…1, x east, y south) → drape uv: one affine map, exact because both are lon/lat grids.
      const sx = (b[2] - b[0]) / (d.box[2] - d.box[0]), sy = (b[3] - b[1]) / (d.box[3] - d.box[1]);
      gl.uniform4f(u("uDrapeMap"), sx, sy, (b[0] - d.box[0]) / (d.box[2] - d.box[0]), (d.box[3] - b[3]) / (d.box[3] - d.box[1]));
      gl.uniform2f(u("uDrapeN"), d.w, d.h);
      gl.uniform1f(u("uDrapeA"), this.drapeAlpha);
      gl.uniform3f(u("uInk"), 0.12, 0.15, 0.22);
      gl.uniform3f(u("uGrey"), 0.45, 0.49, 0.58);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.drapeTex);
      gl.uniform1i(u("uDrape"), 1);
    } else gl.uniform4f(u("uDrapeMap"), 0, 0, -1, -1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.i);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.abort?.abort();
    this.ro.disconnect();
    for (const f of this.cleanup) f();
    releaseGL(this.gl);
    this.canvas.remove();
  }
}

function releaseGL(gl: WebGLRenderingContext): void {
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}
