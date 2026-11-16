// «Lo que está pasando», generated on the REAL place (Vista 3D real): when a live anomaly is the reason to open the
// zone, its kind and its measured strength drive a light 3D effect on the real relief — rain falling and wet ground,
// water filling the low ground, a storm deck with lightning, flames and smoke, snow, heat, drought, haze, or an
// abstract pulsing column when the anomaly has no physical kind (a statistical departure).
// Real stays real (relief, photo); what is drawn here is GENERATED from the data and the screen always says so.
// Cheap on purpose: the particles move in the vertex shader (one buffer, no CPU work per frame).

export type EffectKind = "lluvia" | "inundacion" | "tormenta" | "incendio" | "volcan" | "nieve" | "calor" | "sequia" | "bruma" | "anomalia" | "bolido";

export interface ZoneEvent {
  kind: EffectKind;
  /** 0–1, from the data (rain rate, cold tops, hotspots…); never invented. */
  intensity: number;
  /** What is shown, and from what («Lluvia intensa · IMERG 20:30 UTC»). */
  label: string;
  source: string;
  /** Size of the phenomenon (km); the effect covers that, centred on the zone. */
  radiusKm: number;
}

/** Terrain tints (uniform vec4 uFx + uSnow): wet, heat, drought, haze; snow on flat ground. */
export function terrainTints(e: ZoneEvent | null): { fx: [number, number, number, number]; snow: number } {
  if (!e) return { fx: [0, 0, 0, 0], snow: 0 };
  const k = Math.max(0.15, Math.min(1, e.intensity));
  return {
    fx: [
      e.kind === "lluvia" || e.kind === "inundacion" || e.kind === "tormenta" ? 0.35 + 0.5 * k : 0,
      e.kind === "calor" ? 0.25 + 0.6 * k : e.kind === "incendio" || e.kind === "volcan" ? 0.15 : 0,
      e.kind === "sequia" ? 0.3 + 0.6 * k : 0,
      e.kind === "bruma" || e.kind === "volcan" ? 0.3 + 0.6 * k : e.kind === "incendio" ? 0.2 : 0,
    ],
    snow: e.kind === "nieve" ? 0.4 + 0.6 * k : 0,
  };
}

// ---------------------------------------------------------------- particles

const PVS = `attribute vec4 aS; attribute float aG;
uniform mat4 uM; uniform float uT; uniform float uTop; uniform float uMode; uniform float uPx; uniform vec2 uWind;
varying float vA; varying float vK;
void main(){
  // aS = (x, z, seed, size); aG = ground height under the particle (model units)
  float s = aS.z; vec3 p = vec3(aS.x, aG, aS.y); float life = 1.0;
  if (uMode < 0.5) {            // rain: straight down from the cloud base to the ground
    float h = uTop - aG; p.y = uTop - mod(uT*0.9 + s*h, h); life = 1.0;
  } else if (uMode < 1.5) {     // snow: slow, swaying
    float h = uTop - aG; p.y = uTop - mod(uT*0.12 + s*h, h); p.x += 0.01*sin(uT*1.3+s*40.0); p.z += 0.01*cos(uT*1.1+s*30.0);
  } else if (uMode < 2.5) {     // flames: short, fast, flicker
    float f = fract(uT*1.6 + s); p.y = aG + f*0.035; p.x += 0.004*sin(uT*9.0+s*60.0); life = 1.0 - f;
  } else if (uMode < 3.5) {     // smoke (or ash): rises and drifts with the wind
    float f = fract(uT*0.08 + s); p.y = aG + f*0.45; p.xz += uWind*f*0.9 + 0.03*f*vec2(sin(s*80.0), cos(s*50.0)); life = 1.0 - f;
  } else if (uMode > 4.5) {     // bolide: a streak coming down at an angle to the burst point (repeats every ~6 s)
    float head = fract(uT*0.16)*1.25; float k = s;
    vec3 a0 = vec3(-0.9, uTop + 0.55, -0.85); vec3 b0 = vec3(0.05, uTop, 0.1); // enters the frame high and from the side
    p = mix(a0, b0, k) + vec3(0.0, 0.0, 0.004*sin(s*90.0));
    life = (k < head && k > head - 0.4) ? 1.0 - (head - k)/0.4 : 0.0;
    if (head > 1.0 && k > 0.96) { float b = head - 1.0; p = b0 + vec3(sin(s*300.0), cos(s*170.0), sin(s*230.0))*b*0.25; life = 1.0 - b*4.0; }
  } else {                      // abstract anomaly: a column that spirals up and fades
    float f = fract(uT*0.15 + s); float a = s*60.0 + uT*0.8; float r = aS.w*0.02*(0.6+0.4*sin(uT*2.0));
    p = vec3(aS.x + cos(a)*r, aG + f*0.5, aS.y + sin(a)*r); life = 1.0 - f;
  }
  vec4 q = uM*vec4(p,1.0);
  gl_Position = q;
  gl_PointSize = clamp(uPx*aS.w/q.w, 1.0, 64.0);
  vA = life; vK = uMode;
}`;
const PFS = `precision mediump float;
uniform vec3 uC; uniform float uAlpha; varying float vA; varying float vK;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (vK < 0.5) { if (abs(d.x) > 0.12) discard; }      // rain: thin streaks
  else if (r > 0.5) discard;
  float soft = vK < 0.5 ? 1.0 : smoothstep(0.5, 0.0, r);
  vec3 c = uC;
  if (vK > 1.5 && vK < 2.5) c = mix(vec3(1.0,0.85,0.3), vec3(1.0,0.25,0.05), 1.0 - vA); // flame: yellow core → red tip
  if (vK > 4.5) c = mix(vec3(1.0,0.55,0.2), vec3(1.0,1.0,0.92), vA);                    // bolide: white head, orange trail
  gl_FragColor = vec4(c, soft*uAlpha*clamp(vA*1.4,0.0,1.0));
}`;

// ---------------------------------------------------------------- storm deck and water

const QVS = `attribute vec2 aQ; uniform mat4 uM; uniform float uY; uniform float uR; varying vec2 vQ;
void main(){ vQ = aQ; gl_Position = uM*vec4(aQ.x*uR, uY, aQ.y*uR, 1.0); }`;
// highp: the hash multiplies by ~43,758; in a 16-bit mediump that overflows and the whole deck is discarded
const CLOUD_FS = `precision highp float;
uniform float uT; uniform float uK; uniform float uFlash; varying vec2 vQ;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
void main(){
  float r = length(vQ);
  if (r > 1.0) discard;
  // two scales: the cells of the storm and the cauliflower texture of each tower, drifting slowly
  float big = fbm(vQ*4.0 + vec2(uT*0.02, uT*0.01));
  float fine = fbm(vQ*14.0 - vec2(uT*0.05, 0.0));
  float c = clamp((big*0.7 + fine*0.3 - 0.3)/0.4, 0.0, 1.0);
  float edge = smoothstep(1.0, 0.6, r);
  // seen from above, a storm is bright towers with dark gaps (the sea or rain shafts) between them
  float a = smoothstep(0.2, 0.55, c) * edge * (0.75 + 0.23*uK);
  float tops = smoothstep(0.45, 0.9, c);
  vec3 col = mix(vec3(0.22,0.25,0.32), vec3(1.0), tops) * (0.85 + 0.25*fine);
  col += vec3(0.7,0.75,1.0)*uFlash*(0.6+0.4*c);
  gl_FragColor = vec4(col, a);
}`;
const WATER_FS = `precision highp float;
uniform float uT; varying vec2 vQ;
void main(){
  float r = length(vQ);
  if (r > 1.0) discard;
  float w = 0.04*sin(vQ.x*40.0 + uT*1.5)*sin(vQ.y*37.0 - uT*1.2);
  vec3 col = vec3(0.16,0.33,0.42) + w;
  gl_FragColor = vec4(col, 0.72*smoothstep(1.0, 0.85, r));
}`;

const MODE: Partial<Record<EffectKind, number>> = { lluvia: 0, tormenta: 0, inundacion: 0, nieve: 1, anomalia: 4 };

interface Batch { buf: WebGLBuffer; gbuf: WebGLBuffer; n: number; mode: number; color: [number, number, number]; alpha: number; px: number }

/**
 * The generated layer. Built for one event on one terrain (`heightAt` = model height under a model x,z); drawn after
 * the terrain with the same matrix. Returns true from `draw` when it needs the next frame (it is animated).
 */
export class EffectLayer {
  private gl: WebGLRenderingContext;
  private pProg: WebGLProgram;
  private cProg: WebGLProgram;
  private wProg: WebGLProgram;
  private quad: WebGLBuffer;
  private batches: Batch[] = [];
  private event: ZoneEvent | null = null;
  private radius = 0.6;
  private top = 0.4;
  private waterY = -1;
  private flashAt = 0;

  constructor(gl: WebGLRenderingContext, compile: (vs: string, fs: string) => WebGLProgram) {
    this.gl = gl;
    this.pProg = compile(PVS, PFS);
    this.cProg = compile(QVS, CLOUD_FS);
    this.wProg = compile(QVS, WATER_FS);
    // a disc of triangles is cheaper to write as a quad + discard in the fragment shader
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  }

  /** (Re)build for an event; `halfKm` = half side of the zone; `maxY` = highest relief (model units). */
  set(e: ZoneEvent | null, halfKm: number, heightAt: (x: number, z: number) => number, maxY: number, budget: number): void {
    const gl = this.gl;
    for (const b of this.batches) { gl.deleteBuffer(b.buf); gl.deleteBuffer(b.gbuf); }
    this.batches = [];
    this.event = e;
    if (!e) return;
    this.radius = Math.max(0.15, Math.min(1, e.radiusKm / halfKm));
    this.top = maxY + 0.18;
    const k = Math.max(0.15, Math.min(1, e.intensity));
    // water level: the lowest part of the relief inside the event, raised by intensity (fills valleys, not peaks)
    if (e.kind === "inundacion") {
      let lo = Infinity;
      for (let i = 0; i < 400; i++) { const a = (i / 400) * Math.PI * 2, r = Math.sqrt((i % 20) / 20) * this.radius; lo = Math.min(lo, heightAt(Math.cos(a) * r, Math.sin(a) * r)); }
      this.waterY = lo + (0.006 + 0.03 * k) * Math.max(0.2, maxY);
    } else this.waterY = -1;
    const add = (mode: number, count: number, color: [number, number, number], alpha: number, px: number, where: (i: number) => [number, number], size = 1) => {
      const n = Math.max(1, Math.round(count));
      const s = new Float32Array(n * 4), g = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const [x, z] = where(i);
        s[i * 4] = x; s[i * 4 + 1] = z; s[i * 4 + 2] = Math.random(); s[i * 4 + 3] = size * (0.7 + 0.6 * Math.random());
        g[i] = heightAt(x, z);
      }
      const buf = gl.createBuffer()!, gbuf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, s, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, gbuf); gl.bufferData(gl.ARRAY_BUFFER, g, gl.STATIC_DRAW);
      this.batches.push({ buf, gbuf, n, mode, color, alpha, px });
    };
    const disc = (r: number) => () => { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; return [Math.cos(a) * d, Math.sin(a) * d] as [number, number]; };
    const N = budget; // particles for the tier (2,500 on a modest laptop)
    switch (e.kind) {
      case "lluvia": case "tormenta": case "inundacion":
        add(MODE.lluvia!, N * (0.35 + 0.65 * k), [0.72, 0.78, 0.9], 0.55, 9, disc(this.radius), 1);
        break;
      case "nieve":
        add(MODE.nieve!, N * 0.6 * (0.4 + 0.6 * k), [1, 1, 1], 0.9, 7, disc(this.radius), 1);
        break;
      case "incendio": case "volcan": {
        // a few fronts (hotspots) inside the event; flames on the ground, smoke above them
        const fronts = Array.from({ length: 3 + Math.round(6 * k) }, () => disc(this.radius * 0.6)());
        const near = (i: number): [number, number] => { const f = fronts[i % fronts.length]; return [f[0] + (Math.random() - 0.5) * 0.04, f[1] + (Math.random() - 0.5) * 0.04]; };
        if (e.kind === "incendio") add(2, N * 0.35 * (0.4 + 0.6 * k), [1, 0.6, 0.2], 0.95, 20, near, 1.1);
        add(3, N * 0.3 * (0.4 + 0.6 * k), e.kind === "volcan" ? [0.35, 0.33, 0.32] : [0.55, 0.53, 0.5], 0.35, 60, near, 1.6);
        break;
      }
      case "anomalia":
        add(MODE.anomalia!, N * 0.25, [0.62, 0.45, 1], 0.7, 18, () => [0, 0], 1 + 2 * k);
        break;
      case "bolido":
        // the streak: particles along the path (their seed is the position along it); the burst at the end
        add(5, 1200 + 1200 * k, [1, 0.8, 0.5], 1, 34, () => [0, 0], 1.6);
        this.top = Math.max(this.top, 0.25 + 0.15 * k); // burst height: a few tens of km above the ground, drawn higher than clouds
        break;
      default:
        break; // heat, drought, haze: terrain tints only
    }
  }

  get active(): boolean { return !!this.event; }

  /** Draw on top of the terrain (depth test on, no depth writes for the transparent parts). */
  draw(mvp: Float32Array | number[], t: number): void {
    const e = this.event, gl = this.gl;
    if (!e) return;
    gl.enable(gl.BLEND);
    // colour blends; the canvas' own alpha stays 1 (otherwise the page behind shows through the clouds and the rain)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    // water first (it writes depth: rain behind it is hidden)
    if (this.waterY >= 0) this.drawQuad(this.wProg, mvp, this.waterY, this.radius, t, 0, 0, true);
    gl.depthMask(false);
    for (const b of this.batches) {
      const P = this.pProg;
      gl.useProgram(P);
      const s = gl.getAttribLocation(P, "aS"), g = gl.getAttribLocation(P, "aG");
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf); gl.enableVertexAttribArray(s); gl.vertexAttribPointer(s, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.gbuf); gl.enableVertexAttribArray(g); gl.vertexAttribPointer(g, 1, gl.FLOAT, false, 0, 0);
      const u = (n: string) => gl.getUniformLocation(P, n);
      gl.uniformMatrix4fv(u("uM"), false, mvp);
      gl.uniform1f(u("uT"), t); gl.uniform1f(u("uTop"), this.top); gl.uniform1f(u("uMode"), b.mode); gl.uniform1f(u("uPx"), b.px);
      gl.uniform2f(u("uWind"), 0.35, -0.12);
      gl.uniform3fv(u("uC"), b.color); gl.uniform1f(u("uAlpha"), b.alpha);
      gl.drawArrays(gl.POINTS, 0, b.n);
      gl.disableVertexAttribArray(s); gl.disableVertexAttribArray(g);
    }
    if (e.kind === "tormenta" || e.kind === "lluvia") {
      // lightning only for storms with very cold tops; the deck for both
      const k = Math.max(0.15, Math.min(1, e.intensity));
      let flash = 0;
      if (e.kind === "tormenta") {
        if (t > this.flashAt) this.flashAt = t + 1.5 + Math.random() * (5 - 3 * k);
        const dtf = this.flashAt - t;
        flash = dtf < 0.12 ? (dtf > 0.06 ? 1 : 0.5) : 0;
      }
      this.drawQuad(this.cProg, mvp, this.top, this.radius * 1.15, t, k, flash, false);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** Lightning (storm) or the bolide's burst: the terrain brightens with it. */
  flash(t: number): number {
    if (this.event?.kind === "bolido") { const head = ((t * 0.16) % 1) * 1.25; return head > 1 && head < 1.08 ? 1.6 : 0; }
    return this.event?.kind === "tormenta" && this.flashAt - t < 0.12 && this.flashAt - t > 0.06 ? 1 : 0;
  }

  private drawQuad(P: WebGLProgram, mvp: Float32Array | number[], y: number, r: number, t: number, k: number, flash: number, writeDepth: boolean): void {
    const gl = this.gl;
    gl.useProgram(P);
    gl.depthMask(writeDepth);
    const a = gl.getAttribLocation(P, "aQ");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(P, n);
    gl.uniformMatrix4fv(u("uM"), false, mvp);
    gl.uniform1f(u("uY"), y); gl.uniform1f(u("uR"), r); gl.uniform1f(u("uT"), t);
    const uk = u("uK"); if (uk) gl.uniform1f(uk, k);
    const uf = u("uFlash"); if (uf) gl.uniform1f(uf, flash);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(a);
  }

  destroy(): void {
    const gl = this.gl;
    for (const b of this.batches) { gl.deleteBuffer(b.buf); gl.deleteBuffer(b.gbuf); }
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.pProg); gl.deleteProgram(this.cProg); gl.deleteProgram(this.wProg);
  }
}
