// Quality tier per device (doc «Motor de visualización v2» §2.4), decided once at start-up and lowered on the fly.
//   N0 · no GPU (or only an emulated one): the Canvas globe — emulated WebGL measured 260 ms/frame, worse than Canvas.
//   N1 · "papa": real GPU but ≤ 2 cores or ≤ 4 GB → smaller textures, render scale 1.
//   N2 · the rest.
// Measured on Diego's laptop (AMD E2-9000, Radeon R2): shader globe 9 ms/frame at 1366×768 → N1.

export type Tier = 0 | 1 | 2;

export interface TierInfo {
  tier: Tier;
  renderer: string;
  reason: string;
  /** Largest texture for the global base image. */
  baseMax: number;
  /** Side of the regional patch texture. */
  patchMax: number;
  /** Resolution scale of the WebGL canvas (1 = one pixel per CSS pixel, never above devicePixelRatio). */
  renderScale: number;
  /** Frame budget for the generated 3D scenes. */
  fpsCap: number;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

let cached: TierInfo | null = null;

function forced(): Tier | null {
  try {
    const q = new URLSearchParams(location.search).get("calidad");
    if (q === "0" || q === "1" || q === "2") return Number(q) as Tier;
  } catch { /* no location (tests) */ }
  return null;
}

export function detectTier(): TierInfo {
  if (cached) return cached;
  let renderer = "ninguno";
  let gl: WebGLRenderingContext | null = null;
  try {
    const c = document.createElement("canvas");
    // Chrome on Linux often flags a real GPU as «major performance caveat» (blocklisted driver): try that first,
    // then without the flag, so the GPU globe (with NASA imagery) is used whenever WebGL really works.
    gl = (c.getContext("webgl", { failIfMajorPerformanceCaveat: true }) as WebGLRenderingContext | null)
      ?? (c.getContext("webgl") as WebGLRenderingContext | null);
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    }
  } catch { gl = null; }
  const cores = navigator.hardwareConcurrency || 2;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const maxTex = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 0;
  gl?.getExtension("WEBGL_lose_context")?.loseContext();

  let tier: Tier;
  let reason: string;
  // Software WebGL (llvmpipe, SwiftShader) still draws the GPU globe well at the lowest quality: tier 1.
  if (!gl) { tier = 0; reason = "sin WebGL"; }
  else if (SOFTWARE.test(renderer)) { tier = 1; reason = "gráfica emulada por CPU (calidad baja)"; }
  else if (cores <= 2 || mem <= 4 || maxTex < 4096) { tier = 1; reason = `${cores} núcleos, ${mem} GB`; }
  else { tier = 2; reason = `${cores} núcleos, ${mem} GB`; }
  const f = forced();
  if (f !== null) { tier = f; reason = "forzado con ?calidad="; }

  cached = {
    tier, renderer, reason,
    baseMax: tier === 2 ? Math.min(5120, maxTex) : tier === 1 ? 2560 : 1280,
    patchMax: tier === 2 ? 2048 : 1024,
    renderScale: tier === 2 ? Math.min(1.5, window.devicePixelRatio || 1) : 1,
    fpsCap: tier === 2 ? 60 : 30,
  };
  return cached;
}

/** Lowers the tier for the rest of the session (frames too slow). */
export function downgrade(): TierInfo {
  const t = detectTier();
  if (t.tier === 0) return t;
  cached = { ...t, tier: (t.tier - 1) as Tier, reason: "bajado: cuadros lentos", baseMax: t.tier === 2 ? 2560 : 1280, patchMax: 1024, renderScale: 1, fpsCap: 30 };
  return cached;
}

/** Rolling median of frame times; `slow()` once the median passes `limitMs` over a full window. */
export class FrameMeter {
  private times: number[] = [];
  private readonly limitMs: number;
  private readonly size: number;
  constructor(limitMs = 33, size = 24) { this.limitMs = limitMs; this.size = size; }
  add(ms: number): void { this.times.push(ms); if (this.times.length > this.size) this.times.shift(); }
  median(): number {
    if (!this.times.length) return 0;
    const s = [...this.times].sort((a, b) => a - b);
    return s[s.length >> 1];
  }
  slow(): boolean { return this.times.length >= this.size && this.median() > this.limitMs; }
  reset(): void { this.times = []; }
}
