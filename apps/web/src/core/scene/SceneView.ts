// Draws a generated Scene with WebGL1: one sky pass (full-screen triangle), one opaque pass, one transparent pass.
// All motion (wind, rain, fire, smoke, water, dust) is computed in the vertex shader from the time uniform, so the CPU
// does nothing per frame. It only animates while playing and visible, caps the frame rate by device tier, and rests
// after 40 s without interaction (doc «Motor de visualización v2» §3.1: zero draws when still).

import { type M4, lookAt, mul4, perspective } from "./math";
import { STRIDE } from "./mesh";
import type { Scene } from "./compose";
import { FrameMeter, detectTier } from "../map/tier";

const SKY_V = `attribute vec2 a; varying vec2 vP; void main(){ vP = a; gl_Position = vec4(a, 0.9999, 1.0); }`;
const SKY_F = `
precision highp float;
varying vec2 vP;
uniform vec3 uRight, uUp, uFwd; uniform float uTanH, uAspect;
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunCol; uniform float uSunSize, uStars, uTime;
uniform vec3 uEarthDir; uniform float uHasEarth; uniform float uEarthCos; uniform float uEarthKind;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  vec3 d = normalize(uFwd + vP.x * uTanH * uAspect * uRight + vP.y * uTanH * uUp);
  float h = d.y;
  vec3 c = h > 0.0 ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uGround, clamp(-h * 6.0, 0.0, 1.0));
  float s = dot(d, normalize(uSunDir));
  c += uSunCol * (smoothstep(uSunSize, uSunSize + 0.0004, s) * 2.0 + pow(max(s, 0.0), 64.0) * 0.35 + pow(max(s, 0.0), 6.0) * 0.08);
  if (uStars > 0.01 && h > 0.0) {
    vec3 q = floor(d * 220.0);
    float st = step(0.9965, hash(q));
    c += vec3(st * uStars * (0.6 + 0.4 * sin(uTime * 2.0 + hash(q + 3.0) * 30.0)));
  }
  if (uHasEarth > 0.5) {
    float e = dot(d, normalize(uEarthDir));
    if (e > uEarthCos) {
      vec3 ed = normalize(d - uEarthDir * e);
      float rr = sqrt(max(0.0, 1.0 - e * e)) / sqrt(max(1e-6, 1.0 - uEarthCos * uEarthCos)); // 0 centre … 1 edge
      vec3 ec;
      if (uEarthKind > 0.5) {
        // Jupiter: cream zones and brown belts across its disc, and the Great Red Spot
        vec3 up = normalize(uUp - uEarthDir * dot(uUp, uEarthDir));
        float lat = dot(ed, up) * rr;
        float band = sin(lat * 26.0) * 0.5 + 0.5;
        ec = mix(vec3(0.62, 0.45, 0.30), vec3(0.93, 0.86, 0.74), smoothstep(0.35, 0.75, band));
        vec3 rt = normalize(cross(up, uEarthDir));
        vec2 q = vec2(dot(ed, rt) * rr - 0.25, lat + 0.35);
        ec = mix(ec, vec3(0.75, 0.38, 0.25), smoothstep(0.012, 0.004, q.x * q.x * 0.6 + q.y * q.y * 2.4));
      } else {
        float sw = sin(ed.x * 900.0 + ed.y * 600.0) * 0.5 + 0.5;
        ec = mix(vec3(0.12, 0.32, 0.72), vec3(0.95), smoothstep(0.55, 0.9, sw));
      }
      float lit = smoothstep(-0.2, 0.6, dot(ed, normalize(uSunDir)));
      float edgeSoft = (1.0 - uEarthCos) * 0.08;
      c = mix(c, ec * (0.15 + 0.85 * lit) * (1.0 - 0.35 * rr * rr), smoothstep(uEarthCos, uEarthCos + edgeSoft, e));
    }
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const OBJ_V = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec4 aCol; attribute vec3 aAnim;
uniform mat4 uVP; uniform float uTime; uniform vec2 uWind; uniform float uFallH;
varying vec3 vNrm; varying vec4 vCol; varying vec3 vWorld; varying float vEmit; varying float vSoft;
void main(){
  vec3 p = aPos; float t = uTime; float ph = aAnim.y; float am = aAnim.z; int k = int(aAnim.x + 0.5);
  vEmit = 0.0;
  if (k == 1) { float hgt = max(p.y, 0.0); float w = sin(t * 1.9 + ph + p.x * 0.3) * am + am * 0.6; p.x += w * uWind.x * 0.08 * hgt * 0.4 + w * 0.03 * hgt; p.z += w * uWind.y * 0.08 * hgt * 0.4; }
  else if (k == 2) { p.x += sin(t * 0.07 + ph) * am * 2.0 + uWind.x * 0.15 * sin(t * 0.03); p.z += cos(t * 0.05 + ph) * am; }
  // Particles: the normal carries the particle's top height, so every vertex of one drop moves by the same offset.
  else if (k == 3) { float off = mod(t * am + ph, aNrm.y + 0.6); p.y -= off; p.x += off * uWind.x * 0.03; p.z += off * uWind.y * 0.03; }
  else if (k == 4) { float off = mod(t * am + ph, aNrm.y + 0.3); p.y -= off; p.x += sin(t * 1.3 + ph) * 0.4 + off * uWind.x * 0.05; p.z += cos(t * 1.1 + ph) * 0.4; }
  else if (k == 5) { float f = 0.75 + 0.25 * sin(t * 11.0 + ph) * sin(t * 7.3 + ph * 2.0); p.y += (f - 1.0) * am * 2.0; vEmit = 1.0; }
  else if (k == 6) { float off = mod(t * am * 1.2 + ph, 12.0); p.y += off; p.x += off * (0.25 + uWind.x * 0.06); p.z += off * uWind.y * 0.06; }
  else if (k == 7) { p.y += sin(p.x * 0.7 + t * 1.6) * am + cos(p.z * 0.6 + t * 1.2) * am; }
  else if (k == 8) { p.y += sin(t * 2.2 + ph) * am; }
  else if (k == 9) { float cx = aNrm.x; p.x += (mod(cx + t * am + ph + 24.0, 48.0) - 24.0) - cx; p.y += sin(t * 2.0 + ph) * 0.3; }
  else if (k == 10) { vEmit = 1.0; if (fract(t * 0.23 + ph) > 0.03) p.y = -80.0; }
  else if (k == 11) { vEmit = 1.0; }
  vNrm = (k == 3 || k == 4 || k == 9) ? vec3(0.0, 1.0, 0.0) : aNrm; vCol = aCol; vWorld = p;
  vSoft = (k == 2) ? 1.0 : (k == 7) ? 2.0 : 0.0;
  gl_Position = uVP * vec4(p, 1.0);
}`;

const OBJ_F = `
precision mediump float;
varying vec3 vNrm; varying vec4 vCol; varying vec3 vWorld; varying float vEmit; varying float vSoft;
uniform vec3 uCam, uSunDir, uSunCol, uAmbTop, uAmbBot, uFogCol; uniform float uFogDen;
void main(){
  vec3 n = normalize(vNrm);
  if (dot(n, uCam - vWorld) < 0.0) n = -n;
  vec3 L = normalize(uSunDir);
  float dif = max(dot(n, L), 0.0);
  vec3 amb = mix(uAmbBot, uAmbTop, n.y * 0.5 + 0.5);
  // Clouds: wrapped light and sky ambient, so they read as soft volumes, not grey rocks.
  if (vSoft > 0.5 && vSoft < 1.5) { dif = dot(n, L) * 0.4 + 0.6; amb = uAmbTop * 1.15; }
  vec3 c = vCol.rgb * (amb + uSunCol * dif);
  // Water: a little sun glint.
  if (vSoft > 1.5) { vec3 v = normalize(uCam - vWorld); c += uSunCol * pow(max(dot(reflect(-L, n), v), 0.0), 40.0) * 0.6; }
  c = mix(c, vCol.rgb * 1.25, vEmit);
  float dist = length(uCam - vWorld);
  float fog = 1.0 - exp(-dist * uFogDen);
  c = mix(c, uFogCol, clamp(fog, 0.0, 1.0) * (1.0 - vEmit * 0.6));
  gl_FragColor = vec4(c, vCol.a);
}`;

export interface SceneStats { tier: number; fps: number; frameMs: number; vertices: number; playing: boolean; resting: boolean }

export class SceneView {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private sky: WebGLProgram;
  private obj: WebGLProgram;
  private us: Record<string, WebGLUniformLocation | null> = {};
  private uo: Record<string, WebGLUniformLocation | null> = {};
  private quad: WebGLBuffer;
  private bufs: { solid: WebGLBuffer | null; clear: WebGLBuffer | null; nSolid: number; nClear: number } = { solid: null, clear: null, nSolid: 0, nClear: 0 };
  private scene: Scene | null = null;
  private yaw = 0.75;
  private pitch = 0.42;
  private dist = 62;
  private w = 1;
  private h = 1;
  private px = 1;
  private raf = 0;
  private playing = true;
  private resting = false;
  private lastInput = performance.now();
  private lastFrame = 0;
  private t0 = performance.now();
  private timeOffset = 0;
  private meter = new FrameMeter(40, 30);
  private ro: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private lost = false;
  onStats: (s: SceneStats) => void = () => {};

  /** Throws when WebGL is unavailable. */
  constructor(parent: HTMLElement, label: string) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "block h-full w-full touch-none outline-none cursor-grab active:cursor-grabbing";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", label);
    const gl = this.canvas.getContext("webgl", { antialias: detectTier().tier === 2, alpha: false, failIfMajorPerformanceCaveat: true }) as WebGLRenderingContext | null;
    if (!gl) throw new Error("WebGL no disponible");
    this.gl = gl;
    this.sky = this.program(SKY_V, SKY_F, ["a"]);
    this.obj = this.program(OBJ_V, OBJ_F, ["aPos", "aNrm", "aCol", "aAnim"]);
    for (const n of ["uRight", "uUp", "uFwd", "uTanH", "uAspect", "uZenith", "uHorizon", "uGround", "uSunDir", "uSunCol", "uSunSize", "uStars", "uTime", "uEarthDir", "uHasEarth", "uEarthCos", "uEarthKind"]) this.us[n] = gl.getUniformLocation(this.sky, n);
    for (const n of ["uVP", "uTime", "uWind", "uFallH", "uCam", "uSunDir", "uSunCol", "uAmbTop", "uAmbBot", "uFogCol", "uFogDen"]) this.uo[n] = gl.getUniformLocation(this.obj, n);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    parent.appendChild(this.canvas);
    this.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
    this.bindEvents();
    const vis = () => { if (document.hidden) this.stop(); else this.kick(); };
    document.addEventListener("visibilitychange", vis);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", vis));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(parent);
    this.resize();
  }

  destroy(): void {
    this.stop();
    this.ro.disconnect();
    for (const f of this.cleanup) f();
    const gl = this.gl;
    if (this.bufs.solid) gl.deleteBuffer(this.bufs.solid);
    if (this.bufs.clear) gl.deleteBuffer(this.bufs.clear);
    gl.deleteBuffer(this.quad);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.remove();
  }

  setScene(s: Scene): void {
    const gl = this.gl;
    this.scene = s;
    const up = (b: WebGLBuffer | null, data: Float32Array) => {
      const buf = b ?? gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return buf;
    };
    this.bufs.solid = up(this.bufs.solid, s.solid);
    this.bufs.clear = up(this.bufs.clear, s.clear);
    this.bufs.nSolid = s.solid.length / STRIDE;
    this.bufs.nClear = s.clear.length / STRIDE;
    if (this.scene?.pitch !== undefined && !this.touched) this.pitch = s.pitch;
    this.kick();
    this.draw();
  }

  // Interaction layer (doc «Interacción v2» §2.6): the same moves as dragging / wheel, for voice, hand, gamepad.
  /** Orbit as if dragged by (dx, dy) fractions of the view. */
  orbit(dx: number, dy: number): void {
    this.yaw -= dx * Math.PI;
    this.pitch = Math.max(0.08, Math.min(1.35, this.pitch + dy * 1.2));
    this.moved();
  }
  zoomBy(f: number): void { this.dist = Math.max(18, Math.min(130, this.dist / f)); this.moved(); }
  reset(): void { this.yaw = 0.75; this.pitch = this.scene?.pitch ?? 0.42; this.dist = 62; this.moved(); }

  setPlaying(on: boolean): void { this.playing = on; if (on) this.kick(); else { this.stop(); this.draw(); } this.report(); }
  isPlaying(): boolean { return this.playing; }

  // ---- loop ----

  private now(): number { return (performance.now() - this.t0) / 1000 + this.timeOffset; }

  private kick(): void {
    this.lastInput = performance.now();
    this.resting = false;
    if (this.raf || !this.playing || !this.scene?.animated || document.hidden) { if (!this.raf) this.requestDraw(); return; }
    const loop = (ts: number) => {
      this.raf = 0;
      if (!this.playing || document.hidden) return;
      if (performance.now() - this.lastInput > 40_000) { this.resting = true; this.report(); this.draw(); return; }
      const minGap = 1000 / detectTier().fpsCap - 2;
      if (ts - this.lastFrame >= minGap) {
        if (this.lastFrame) this.meter.add(ts - this.lastFrame);
        this.lastFrame = ts;
        this.draw();
        if ((Math.round(ts) & 31) < 2) this.report();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.lastFrame = 0;
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    // Freeze the clock where it is so playing again continues smoothly.
    this.timeOffset = this.now();
    this.t0 = performance.now();
  }

  private pending = 0;
  private requestDraw(): void {
    if (this.raf || this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = 0; this.draw(); });
  }

  private report(): void {
    const med = this.meter.median();
    this.onStats({ tier: detectTier().tier, fps: med ? Math.round(1000 / med) : 0, frameMs: med, vertices: this.scene?.vertices ?? 0, playing: this.playing, resting: this.resting });
  }

  private resize(): void {
    const r = this.canvas.parentElement?.getBoundingClientRect();
    if (!r || r.width < 2 || r.height < 2) return;
    this.px = Math.min(Math.max(1, window.devicePixelRatio || 1), detectTier().renderScale);
    this.w = Math.round(r.width);
    this.h = Math.round(r.height);
    this.canvas.width = Math.round(this.w * this.px);
    this.canvas.height = Math.round(this.h * this.px);
    this.draw();
  }

  // ---- drawing ----

  private program(vs: string, fs: string, attrs: string[]): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    return p;
  }

  private camera(): { eye: number[]; vp: M4; right: number[]; up: number[]; fwd: number[]; tanH: number; aspect: number } {
    const target = [0, 1.5, 0];
    const eye = [
      target[0] + Math.cos(this.pitch) * Math.sin(this.yaw) * this.dist,
      target[1] + Math.sin(this.pitch) * this.dist,
      target[2] + Math.cos(this.pitch) * Math.cos(this.yaw) * this.dist,
    ];
    const fov = 0.75, aspect = this.w / this.h;
    const view = lookAt(eye, target, [0, 1, 0]);
    const proj = perspective(fov, aspect, 0.5, 400);
    const fwd = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const l = Math.hypot(fwd[0], fwd[1], fwd[2]);
    fwd[0] /= l; fwd[1] /= l; fwd[2] /= l;
    const right = [view[0], view[4], view[8]], up = [view[1], view[5], view[9]];
    return { eye, vp: mul4(proj, view), right, up, fwd, tanH: Math.tan(fov / 2), aspect };
  }

  draw(): void {
    if (this.lost) return;
    const gl = this.gl, s = this.scene;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (!s) { gl.clearColor(0.1, 0.12, 0.16, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const cam = this.camera();
    const t = this.now();
    const k = s.sky;
    // sky
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.sky);
    const u = this.us;
    gl.uniform3fv(u.uRight, cam.right); gl.uniform3fv(u.uUp, cam.up); gl.uniform3fv(u.uFwd, cam.fwd);
    gl.uniform1f(u.uTanH, cam.tanH); gl.uniform1f(u.uAspect, cam.aspect);
    gl.uniform3fv(u.uZenith, k.zenith); gl.uniform3fv(u.uHorizon, k.horizon); gl.uniform3fv(u.uGround, k.ground);
    gl.uniform3fv(u.uSunDir, k.sunDir); gl.uniform3fv(u.uSunCol, k.sunColor); gl.uniform1f(u.uSunSize, k.sunSize);
    gl.uniform1f(u.uStars, k.stars); gl.uniform1f(u.uTime, t);
    gl.uniform3fv(u.uEarthDir, k.earthDir ?? [0, 1, 0]); gl.uniform1f(u.uHasEarth, k.earthDir ? 1 : 0);
    gl.uniform1f(u.uEarthCos, k.giant?.cos ?? 0.9985); gl.uniform1f(u.uEarthKind, k.giant?.kind ?? 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (let i = 1; i < 4; i++) gl.disableVertexAttribArray(i);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // objects
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.obj);
    const o = this.uo;
    gl.uniformMatrix4fv(o.uVP, false, cam.vp);
    gl.uniform1f(o.uTime, t);
    gl.uniform2fv(o.uWind, s.wind);
    gl.uniform1f(o.uFallH, s.fallHeight);
    gl.uniform3fv(o.uCam, cam.eye);
    gl.uniform3fv(o.uSunDir, k.sunDir); gl.uniform3fv(o.uSunCol, k.sunColor);
    gl.uniform3fv(o.uAmbTop, k.ambientTop); gl.uniform3fv(o.uAmbBot, k.ambientBottom);
    gl.uniform3fv(o.uFogCol, k.fogColor); gl.uniform1f(o.uFogDen, k.fogDensity);
    const bindMesh = (b: WebGLBuffer | null) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      const F = 4, st = STRIDE * F;
      for (let i = 0; i < 4; i++) gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 3 * F);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 6 * F);
      gl.vertexAttribPointer(3, 3, gl.FLOAT, false, st, 10 * F);
    };
    if (this.bufs.nSolid) { bindMesh(this.bufs.solid); gl.drawArrays(gl.TRIANGLES, 0, this.bufs.nSolid); }
    if (this.bufs.nClear) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      bindMesh(this.bufs.clear);
      gl.drawArrays(gl.TRIANGLES, 0, this.bufs.nClear);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  // ---- input: drag to orbit, wheel / pinch to zoom, arrows ----

  private on<K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    this.canvas.addEventListener(type, fn as EventListener, opts);
    this.cleanup.push(() => this.canvas.removeEventListener(type, fn as EventListener, opts));
  }

  private touched = false;
  private moved(): void { this.touched = true; this.kick(); this.requestDraw(); }

  private bindEvents(): void {
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    this.on("pointerdown", (e) => { this.canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    this.on("pointermove", (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY;
        const [c, d] = [...pts.values()];
        const d1 = Math.hypot(c.x - d.x, c.y - d.y);
        if (pinch && d0 > 0) this.dist = Math.max(18, Math.min(130, this.dist * (d0 / d1)));
        pinch = 1;
      } else {
        this.yaw -= (e.clientX - p.x) * 0.006;
        this.pitch = Math.max(0.08, Math.min(1.35, this.pitch + (e.clientY - p.y) * 0.004));
        p.x = e.clientX; p.y = e.clientY;
      }
      this.moved();
    });
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
    this.on("pointerup", up);
    this.on("pointercancel", up);
    this.on("wheel", (e) => { e.preventDefault(); this.dist = Math.max(18, Math.min(130, this.dist * Math.exp(e.deltaY * 0.001))); this.moved(); }, { passive: false });
    this.on("keydown", (e) => {
      if (e.key === "ArrowLeft") this.yaw += 0.12;
      else if (e.key === "ArrowRight") this.yaw -= 0.12;
      else if (e.key === "ArrowUp") this.pitch = Math.min(1.35, this.pitch + 0.08);
      else if (e.key === "ArrowDown") this.pitch = Math.max(0.08, this.pitch - 0.08);
      else if (e.key === "+" || e.key === "=") this.dist = Math.max(18, this.dist * 0.88);
      else if (e.key === "-") this.dist = Math.min(130, this.dist * 1.12);
      else return;
      e.preventDefault();
      this.moved();
    });
  }
}
