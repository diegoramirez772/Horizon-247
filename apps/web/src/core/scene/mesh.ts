// Low-poly mesh builder for the scene generator: flat-shaded triangles, one colour per face, no textures, no library.
// Vertex = position(3) normal(3) colour+alpha(4) animation(3: type, phase, amount) → 13 floats.
// Animation runs in the vertex shader (SceneView), so the CPU builds a scene once and never touches it again.

export const STRIDE = 13;

/** What the vertex shader does with a vertex (SceneView.ts reads the same numbers). */
export const Anim = {
  none: 0,
  sway: 1, // vegetation in the wind: amount = wind × height factor
  drift: 2, // clouds: slow back-and-forth
  fall: 3, // rain: falls and loops; amount = speed
  snow: 4, // snow: slow fall with a wobble
  flame: 5, // fire: flicker, emissive
  rise: 6, // smoke: rises and loops
  wave: 7, // water surface
  breathe: 8, // animals and people: tiny bob
  blow: 9, // dust: blows across and loops; amount = speed
  flash: 10, // lightning: visible a few frames now and then, emissive
  glow: 11, // static emissive (lamps, screens, lava, the Earth in the Moon's sky)
} as const;

export type Vec3 = [number, number, number];
export type RGBA = [number, number, number, number];

/** 3×4 affine matrix, row-major: [a b c tx; d e f ty; g h i tz]. */
export type M34 = number[];

export const I34: M34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export function mul(a: M34, b: M34): M34 {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
}
export const T = (x: number, y: number, z: number): M34 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
export const S = (x: number, y = x, z = x): M34 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0];
export function RY(a: number): M34 { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; }
export function RX(a: number): M34 { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; }
export function RZ(a: number): M34 { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; }
/** Compose left to right: chain(T, RY, S) = T·RY·S (S applied first). */
export function chain(...ms: M34[]): M34 { return ms.reduce((acc, m) => mul(acc, m), I34); }

function apply(m: M34, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
}

/** `nrm` overrides the face normal (particles use it to carry data to the shader, e.g. a drop's top height). */
export interface Look { color: RGBA; anim?: number; phase?: number; amount?: number; nrm?: Vec3 }

export function rgb(hex: string, a = 1): RGBA {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}
export function shade(c: RGBA, k: number): RGBA { return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k), c[3]]; }

export class MeshBuilder {
  private data: number[] = [];
  /** Optional per-face colour jitter, so big low-poly surfaces do not look flat. */
  jitter = 0;
  private seed = 1;

  get vertexCount(): number { return this.data.length / STRIDE; }

  toArray(): Float32Array { return new Float32Array(this.data); }

  private rand(): number { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  tri(a: Vec3, b: Vec3, c: Vec3, look: Look): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (look.nrm) [nx, ny, nz] = look.nrm;
    let col = look.color;
    if (this.jitter) col = shade(col, 1 + (this.rand() - 0.5) * this.jitter);
    const an = look.anim ?? 0, ph = look.phase ?? 0, am = look.amount ?? 0;
    for (const p of [a, b, c]) this.data.push(p[0], p[1], p[2], nx, ny, nz, col[0], col[1], col[2], col[3], an, ph, am);
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, look: Look): void { this.tri(a, b, c, look); this.tri(a, c, d, look); }

  /** Unit box centred on the origin (−0.5…0.5), transformed. */
  box(m: M34, look: Look): void {
    const v = (x: number, y: number, z: number) => apply(m, [x - 0.5, y - 0.5, z - 0.5]);
    const p = [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0), v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)];
    const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
    for (const [a, b, c, d] of f) this.quad(p[a], p[b], p[c], p[d], look);
  }

  /** Unit sphere (radius 1) with `seg` around and `rings` from pole to pole; low counts give the faceted look. */
  sphere(m: M34, look: Look, seg = 7, rings = 5): void {
    const pt = (i: number, j: number): Vec3 => {
      const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2;
      return apply(m, [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]);
    };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      if (j === 0) this.tri(a, c, d, look);
      else if (j === rings - 1) this.tri(a, b, c, look);
      else this.quad(a, b, c, d, look);
    }
  }

  /** Cylinder or cone along +Y from y=0 to y=1, radii r0 (bottom) and r1 (top). */
  cylinder(m: M34, look: Look, r0 = 1, r1 = 1, seg = 6, caps = true): void {
    const at = (i: number, y: number, r: number): Vec3 => { const a = (i / seg) * Math.PI * 2; return apply(m, [Math.cos(a) * r, y, Math.sin(a) * r]); };
    for (let i = 0; i < seg; i++) {
      const a = at(i, 0, r0), b = at(i + 1, 0, r0), c = at(i + 1, 1, r1), d = at(i, 1, r1);
      if (r1 > 0) this.quad(a, d, c, b, look); else this.tri(a, d, b, look);
      if (caps) {
        this.tri(apply(m, [0, 0, 0]), a, b, look);
        if (r1 > 0) this.tri(apply(m, [0, 1, 0]), c, d, look);
      }
    }
  }

  /** Grid surface: heights from `h(x, z)`, colours from `c(x, z, y, slope)`. */
  grid(x0: number, z0: number, size: number, n: number, h: (x: number, z: number) => number, c: (x: number, z: number, y: number, slope: number) => Look): void {
    const step = size / n;
    const P = (i: number, j: number): Vec3 => { const x = x0 + i * step, z = z0 + j * step; return [x, h(x, z), z]; };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
      const cx = (a[0] + cc[0]) / 2, cz = (a[2] + cc[2]) / 2, cy = (a[1] + b[1] + cc[1] + d[1]) / 4;
      const slope = Math.max(Math.abs(a[1] - cc[1]), Math.abs(b[1] - d[1])) / step;
      const look = c(cx, cz, cy, slope);
      // Alternate the diagonal so the faceting does not line up.
      if ((i + j) % 2) { this.tri(a, d, b, look); this.tri(b, d, cc, look); }
      else { this.tri(a, d, cc, look); this.tri(a, cc, b, look); }
    }
  }
}
