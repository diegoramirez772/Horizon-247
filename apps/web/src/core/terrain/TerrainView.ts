// A real place in 3D (Monitoreo · «Ver esta zona en 3D real»): the actual relief (AWS Terrain Tiles, Terrarium
// encoding, open data) with the actual ground on top (Sentinel-2 cloudless 2020 by EOX, ~10 m). Unlike the generated
// scene, nothing here is invented: every vertex is a measured height and every pixel a satellite pixel.
// Plain WebGL 1, one mesh, one texture; drag to orbit, wheel / pinch / gestures to zoom.

import { DETAIL_EARTH, loadMosaic, type Mosaic } from "@/core/map/imagery";

const N = 160; // vertices per side
const HALF_KM = 6; // the zone is 12 km × 12 km
const TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

export interface TerrainStatus { phase: "loading" | "ready" | "error"; text: string; minM?: number; maxM?: number }

type Mat = Float32Array;

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

const VS = `attribute vec3 aP; attribute vec2 aT; attribute vec3 aN; uniform mat4 uM; varying vec2 vT; varying vec3 vN; varying float vD;
void main(){ vT=aT; vN=aN; vec4 p=uM*vec4(aP,1.0); vD=p.w; gl_Position=p; }`;
const FS = `precision mediump float; uniform sampler2D uTex; uniform float uHas; uniform vec3 uSun; varying vec2 vT; varying vec3 vN; varying float vD;
void main(){
  vec3 base = uHas>0.5 ? texture2D(uTex,vT).rgb : vec3(0.62,0.58,0.48);
  float l = 0.5 + 0.7*max(dot(normalize(vN),uSun),0.0);
  vec3 c = base*l;
  float fog = clamp((vD-2.2)/5.0,0.0,0.55);
  gl_FragColor = vec4(mix(c, vec3(0.80,0.86,0.93), fog),1.0);
}`;

/** Lon/lat → Web-Mercator tile coordinates (fractional) at zoom z. */
function tileXY(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

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
  private buf: { p: WebGLBuffer; t: WebGLBuffer; n: WebGLBuffer; i: WebGLBuffer } | null = null;
  private count = 0;
  private tex: WebGLTexture | null = null;
  private hasTex = false;
  private yaw = 0.6;
  private pitch = 0.55;
  private dist = 2.6;
  private spin = true;
  private raf = 0;
  private abort: AbortController | null = null;
  private ro: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private heights: Float32Array | null = null;
  private exaggeration = 1.6;
  private last: { lat: number; lon: number; minM: number; maxM: number } | null = null;
  onStatus: (s: TerrainStatus) => void = () => {};

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "block h-full w-full touch-none outline-none cursor-grab";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Relieve real con imagen satelital");
    host.appendChild(this.canvas);
    const gl = this.canvas.getContext("webgl", { antialias: true });
    if (!gl) throw new Error("no-webgl");
    this.gl = gl;
    gl.getExtension("OES_element_index_uint");
    this.prog = this.program();
    this.bind();
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(host);
    const loop = () => { if (this.spin) this.yaw += 0.0025; this.draw(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  private program(): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("shader");
    return p;
  }

  private bind(): void {
    let down: { x: number; y: number } | null = null;
    const c = this.canvas;
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; this.spin = false; c.setPointerCapture(e.pointerId); c.style.cursor = "grabbing"; };
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

  orbit(dx: number, dy: number): void { this.spin = false; this.yaw -= dx * 3.2; this.pitch = Math.max(0.12, Math.min(1.45, this.pitch + dy * 2.2)); }
  zoomBy(f: number): void { this.spin = false; this.dist = Math.max(0.7, Math.min(6, this.dist / f)); }
  reset(): void { this.yaw = 0.6; this.pitch = 0.55; this.dist = 2.6; this.spin = true; }
  setPlaying(on: boolean): void { this.spin = on; }
  isPlaying(): boolean { return this.spin; }

  /** Taller or flatter relief (1 = true scale). */
  setExaggeration(x: number): void {
    this.exaggeration = x;
    if (this.heights && this.last) this.buildMesh(this.heights, this.last.minM);
  }

  async load(lat: number, lon: number): Promise<void> {
    this.abort?.abort();
    const ctrl = new AbortController(); this.abort = ctrl;
    const dLat = HALF_KM / 110.574, dLon = HALF_KM / (111.32 * Math.cos((lat * Math.PI) / 180));
    const box: [number, number, number, number] = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
    this.onStatus({ phase: "loading", text: "Bajando el relieve y la imagen satelital…" });
    try {
      const [heights, mosaic] = await Promise.all([this.loadHeights(box, ctrl.signal), loadMosaic(DETAIL_EARTH, 13, box, { signal: ctrl.signal })]);
      if (ctrl.signal.aborted) return;
      let minM = Infinity, maxM = -Infinity;
      for (const h of heights) { if (h < minM) minM = h; if (h > maxM) maxM = h; }
      this.heights = heights;
      this.last = { lat, lon, minM, maxM };
      this.buildMesh(heights, minM, mosaic, box);
      this.upload(mosaic);
      this.onStatus({ phase: "ready", text: `Relieve de ${Math.round(minM)} a ${Math.round(maxM)} m`, minM, maxM });
    } catch (e) {
      if (!ctrl.signal.aborted) this.onStatus({ phase: "error", text: e instanceof Error && e.message === "no-webgl" ? "Sin gráfica 3D" : "No se pudo bajar el relieve o la imagen (¿sin internet?)." });
    }
  }

  /** Terrarium tiles (z 12, ~30 m) → a grid of heights in metres covering `box`. */
  private async loadHeights(box: [number, number, number, number], signal: AbortSignal): Promise<Float32Array> {
    const z = 12;
    const [x0, y1] = tileXY(box[1], box[0], z), [x1, y0] = tileXY(box[3], box[2], z);
    const tx0 = Math.floor(x0), tx1 = Math.floor(x1), ty0 = Math.floor(y0), ty1 = Math.floor(y1);
    const w = (tx1 - tx0 + 1) * 256, h = (ty1 - ty0 + 1) * 256;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d", { willReadFrequently: true })!;
    const jobs: Promise<void>[] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(img(`${TERRAIN}/${z}/${tx}/${ty}.png`, signal).then((i) => { g.drawImage(i, (tx - tx0) * 256, (ty - ty0) * 256); }));
    }
    await Promise.all(jobs);
    const px = g.getImageData(0, 0, w, h).data;
    const out = new Float32Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const lat = box[3] - ((box[3] - box[1]) * r) / (N - 1), lon = box[0] + ((box[2] - box[0]) * c) / (N - 1);
      const [fx, fy] = tileXY(lat, lon, z);
      const sx = Math.min(w - 1, Math.max(0, Math.round((fx - tx0) * 256))), sy = Math.min(h - 1, Math.max(0, Math.round((fy - ty0) * 256)));
      const k = (sy * w + sx) * 4;
      out[r * N + c] = px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768; // Terrarium encoding
    }
    return out;
  }

  private buildMesh(hs: Float32Array, minM: number, m?: Mosaic, box?: [number, number, number, number]): void {
    const gl = this.gl;
    const size = HALF_KM * 1000; // metres from centre to edge
    const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), nor = new Float32Array(N * N * 3);
    const mb = m?.bbox, bb = box;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c;
      pos[i * 3] = (c / (N - 1)) * 2 - 1;
      pos[i * 3 + 1] = ((hs[i] - minM) * this.exaggeration) / size;
      pos[i * 3 + 2] = (r / (N - 1)) * 2 - 1;
      if (mb && bb) {
        const lon = bb[0] + ((bb[2] - bb[0]) * c) / (N - 1), lat = bb[3] - ((bb[3] - bb[1]) * r) / (N - 1);
        uv[i * 2] = (lon - mb[0]) / (mb[2] - mb[0]);
        uv[i * 2 + 1] = (mb[3] - lat) / (mb[3] - mb[1]);
      } else if (this.buf) {
        // keep the previous texture coordinates when only the exaggeration changes
      }
    }
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const hl = pos[(r * N + Math.max(0, c - 1)) * 3 + 1], hr = pos[(r * N + Math.min(N - 1, c + 1)) * 3 + 1];
      const hu = pos[(Math.max(0, r - 1) * N + c) * 3 + 1], hd = pos[(Math.min(N - 1, r + 1) * N + c) * 3 + 1];
      const step = 2 / (N - 1);
      let nx = hl - hr, ny = 2 * step, nz = hu - hd;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      nor[i * 3] = nx; nor[i * 3 + 1] = ny; nor[i * 3 + 2] = nz;
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let k = 0;
    for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {
      const a = r * N + c, b = a + 1, d = a + N, e = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
    const mk = () => gl.createBuffer()!;
    const fresh = !this.buf;
    if (!this.buf) this.buf = { p: mk(), t: mk(), n: mk(), i: mk() };
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.p); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    if (mb || fresh) { gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.t); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW); }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.n); gl.bufferData(gl.ARRAY_BUFFER, nor, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.count = idx.length;
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
  }

  private draw(): void {
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.80, 0.86, 0.93, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.buf || !this.count) return;
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);
    const eye = [Math.cos(this.pitch) * Math.sin(this.yaw) * this.dist, Math.sin(this.pitch) * this.dist, Math.cos(this.pitch) * Math.cos(this.yaw) * this.dist];
    const mvp = mul(perspective(0.8, w / h, 0.05, 40), lookAt(eye, [0, 0.05, 0], [0, 1, 0]));
    const at = (name: string, b: WebGLBuffer, n: number) => {
      const loc = gl.getAttribLocation(this.prog, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    };
    at("aP", this.buf.p, 3); at("aT", this.buf.t, 2); at("aN", this.buf.n, 3);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, "uM"), false, mvp);
    gl.uniform3f(gl.getUniformLocation(this.prog, "uSun"), -0.45, 0.8, -0.4);
    gl.uniform1f(gl.getUniformLocation(this.prog, "uHas"), this.hasTex ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(gl.getUniformLocation(this.prog, "uTex"), 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.i);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.abort?.abort();
    this.ro.disconnect();
    for (const f of this.cleanup) f();
    this.canvas.remove();
  }
}
