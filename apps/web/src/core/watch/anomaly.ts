// HORI's anomaly detector (packages/hori/src/hori/anomaly.py: `detect`, `events`, `severity`) ported line by line, so the
// browser can watch a live stream — an animal reporting rate, a person's resting heart rate — with the SAME method and the
// same stated false-alarm rates, without a server. tests/anomaly-parity.test.ts checks it against Python's output.
//
// Model (causal: each sample is judged with the past only):
//   level L_t = mean of the last P samples; deviation d_t = x_t − L_{t−1}; expected e_t = median of d at the same phase over
//   the previous K cycles; residual r_t = d_t − e_t; scale = robust (MAD / IQR, per phase shrunk to the pool); z_t = r_t / s_t.
//   Detectors: punto |z| ≥ z_alarm · cambio_nivel two-sided CUSUM · sin_datos runs of missing · fuera_de_rango · congelado.
// An anomaly is a statistical deviation; it says where and how much, never why (H12, H16).

const MAD_TO_SD = 1.4826;
export const DEFAULTS = { z_alarm: 3.5, cusum_k: 0.5, cusum_h: 5.0, gap_min: 3, merge_gap: 2, phase_prior: 15.0, frozen_min: 12 };

export interface DetectOptions extends Partial<typeof DEFAULTS> {
  cycles?: number;
  scale_window?: number;
  min_sigma?: number;
  valid_range?: [number | null, number | null];
  transform?: "sqrt" | "log1p" | null;
}

export interface AnomalyResult {
  period: number;
  z: Float64Array;
  resid: Float64Array;
  judged: Uint8Array;
  point: Uint8Array;
  shift: Int8Array;
  onset: Int32Array;
  gap: Uint8Array;
  outOfRange: Uint8Array;
  frozen: Uint8Array;
  phi: number;
  params: typeof DEFAULTS & { cycles: number; scale_window: number; transform: string | null };
  warmup: number;
}

const fin = Number.isFinite;

function nanMedian(v: number[]): number {
  const a = v.filter(fin).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

/** numpy's linear-interpolation quantile over the finite values (NaN when there are none). */
function nanQuantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const pos = q * Math.max(n - 1, 0), lo = Math.floor(pos), hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

function rollingMedianExcl(a: Float64Array, w: number): Float64Array {
  const out = new Float64Array(a.length).fill(NaN);
  for (let t = w; t < a.length; t++) out[t] = nanMedian(Array.from(a.subarray(t - w, t)));
  return out;
}

function rollingIqrExcl(a: Float64Array, w: number): Float64Array {
  const out = new Float64Array(a.length).fill(NaN);
  for (let t = w; t < a.length; t++) {
    const s = Array.from(a.subarray(t - w, t)).filter(fin).sort((x, y) => x - y);
    out[t] = nanQuantile(s, 0.75) - nanQuantile(s, 0.25);
  }
  return out;
}

export function detect(input: ArrayLike<number | null>, period: number, opt: DetectOptions = {}): AnomalyResult {
  const { valid_range, transform = null, cycles, scale_window, min_sigma = 0, ...rest } = opt;
  const p = { ...DEFAULTS, ...rest };
  const T = input.length, P = Math.floor(period);
  if (P < 2) throw new Error("period must be >= 2 samples");
  const x = new Float64Array(T);
  for (let i = 0; i < T; i++) { const v = input[i]; x[i] = v === null || v === undefined ? NaN : Number(v); }
  const missing0 = Uint8Array.from(x, (v) => (fin(v) ? 0 : 1));
  const oor = new Uint8Array(T);
  if (valid_range) {
    const [lo, hi] = valid_range;
    for (let i = 0; i < T; i++) if (fin(x[i]) && ((lo !== null && x[i] < lo) || (hi !== null && x[i] > hi))) oor[i] = 1;
  }
  const frozen = new Uint8Array(T);
  const fm = p.frozen_min * (min_sigma > 0 ? 3 : 1);
  for (let i = 0; i < T;) {
    let j = i + 1;
    while (j < T && fin(x[i]) && x[j] === x[i]) j++;
    if (fin(x[i]) && j - i >= fm) frozen.fill(1, i, j);
    i = j;
  }
  for (let i = 0; i < T; i++) {
    if (oor[i] || frozen[i]) x[i] = NaN;
    else if (transform === "sqrt") x[i] = Math.sqrt(Math.max(0, x[i]));
    else if (transform === "log1p") x[i] = Math.log1p(Math.max(0, x[i]));
  }
  const K = cycles ?? (P >= 24 ? 5 : 10);
  const S = scale_window ?? Math.max(K * P, 60);
  // level: mean of the last P samples (needs at least half of them)
  const L = new Float64Array(T).fill(NaN);
  for (let t = P - 1; t < T; t++) {
    let s = 0, n = 0;
    for (let k = t - P + 1; k <= t; k++) if (fin(x[k])) { s += x[k]; n++; }
    L[t] = n >= Math.floor(P / 2) + 1 ? s / n : NaN;
  }
  const d = new Float64Array(T);
  for (let t = 0; t < T; t++) d[t] = t === 0 ? NaN : x[t] - L[t - 1];
  // expected deviation: median of d at the same phase over the previous K cycles
  const e = new Float64Array(T).fill(NaN);
  const minE = Math.max(3, Math.floor(K / 2));
  for (let t = 0; t < T; t++) {
    const v: number[] = [];
    for (let k = 1; k <= K; k++) if (t - k * P >= 0 && fin(d[t - k * P])) v.push(d[t - k * P]);
    if (v.length >= minE) e[t] = nanMedian(v);
  }
  const r = Float64Array.from(d, (v, t) => v - e[t]);
  const medR = rollingMedianExcl(r, S);
  const med0 = (t: number) => (fin(medR[t]) ? medR[t] : 0);
  const absDev = Float64Array.from(r, (v, t) => Math.abs(v - med0(t)));
  const mad = rollingMedianExcl(absDev, S);
  const iqr = rollingIqrExcl(r, S);
  const sPool = Float64Array.from(mad, (m, t) => Math.max(MAD_TO_SD * m, iqr[t] / 1.349));
  // per-phase scale shrunk toward the pooled scale with weight `phase_prior`
  const K2 = Math.max(Math.floor(S / P), 3);
  const rr = Float64Array.from(r, (v, t) => v - med0(t));
  const s = new Float64Array(T).fill(NaN);
  for (let t = 0; t < T; t++) {
    const v: number[] = [];
    for (let k = 1; k <= K2; k++) if (t - k * P >= 0 && fin(rr[t - k * P])) v.push(rr[t - k * P]);
    const mPh = nanMedian(v);
    const sPh = v.length ? MAD_TO_SD * nanMedian(v.map((q) => Math.abs(q - mPh))) : NaN;
    if (!fin(sPool[t])) continue;
    const s2 = (v.length * (fin(sPh) ? sPh : 0) ** 2 + p.phase_prior * sPool[t] ** 2) / (v.length + p.phase_prior);
    s[t] = Math.max(Math.sqrt(s2), min_sigma);
  }
  const z = Float64Array.from(r, (v, t) => (s[t] > 0 ? (v - med0(t)) / s[t] : NaN));
  const judged = Uint8Array.from(z, (v) => (fin(v) ? 1 : 0));
  const point = Uint8Array.from(z, (v, t) => (judged[t] && Math.abs(v) >= p.z_alarm ? 1 : 0));
  // lag-1 of the clipped z, for the CUSUM allowance of dependence
  const zz = Float64Array.from(z, (v) => (fin(v) ? Math.max(-3, Math.min(3, v)) : NaN));
  const xs: number[] = [], ys: number[] = [];
  for (let t = 1; t < T; t++) if (fin(zz[t]) && fin(zz[t - 1])) { xs.push(zz[t]); ys.push(zz[t - 1]); }
  let phi = 0;
  if (xs.length > 30) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2; }
    const c = sxy / Math.sqrt(sxx * syy);
    phi = fin(c) ? Math.max(0, Math.min(0.9, c)) : NaN;
  }
  const infl = Math.sqrt((1 + phi) / (1 - phi));
  const shift = new Int8Array(T), onset = new Int32Array(T).fill(-1);
  let sp = 0, sn = 0, op = -1, on = -1;
  for (let t = 0; t < T; t++) {
    if (!judged[t]) continue;
    const zt = Math.max(-p.z_alarm, Math.min(p.z_alarm, z[t])) / infl;
    const sp0 = sp, sn0 = sn;
    sp = Math.max(0, sp + zt - p.cusum_k); sn = Math.max(0, sn - zt - p.cusum_k);
    if (sp0 === 0 && sp > 0) op = t;
    if (sn0 === 0 && sn > 0) on = t;
    if (sp > p.cusum_h) { shift[t] = 1; onset[t] = op; sp = 0; }
    else if (sn > p.cusum_h) { shift[t] = -1; onset[t] = on; sn = 0; }
  }
  const gap = new Uint8Array(T);
  for (let i = 0; i < T;) {
    if (!missing0[i]) { i++; continue; }
    let j = i;
    while (j < T && missing0[j]) j++;
    if (j - i >= p.gap_min) gap.fill(1, i, j);
    i = j;
  }
  const first = judged.indexOf(1);
  return {
    period: P, z, resid: r, judged, point, shift, onset, gap, outOfRange: oor, frozen, phi,
    params: { ...p, cycles: K, scale_window: S, transform }, warmup: first < 0 ? T : first,
  };
}

export type EventType = "punto" | "racha" | "cambio_nivel" | "sin_datos" | "fuera_de_rango" | "congelado";
export type Severity = "leve" | "media" | "alta";

export interface AnomalyEvent {
  type: EventType;
  start: number;
  end: number;
  tStart: string;
  tEnd: string;
  direction?: "alto" | "bajo";
  peakZ?: number;
  meanZ?: number;
  nFlagged: number;
  returnLikely?: boolean;
  severity: Severity;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function severity(e: Pick<AnomalyEvent, "type" | "nFlagged" | "peakZ" | "meanZ">): Severity {
  if (e.type === "fuera_de_rango" || e.type === "congelado") return "media";
  if (e.type === "sin_datos") return e.nFlagged >= 12 ? "media" : "leve";
  const z = Math.abs(e.peakZ ?? e.meanZ ?? 0);
  if (e.type === "cambio_nivel") return z >= 2 ? "media" : "leve";
  return z >= 10 ? "alta" : z >= 6 ? "media" : "leve";
}

export function events(res: AnomalyResult, times?: string[]): AnomalyEvent[] {
  const T = res.z.length;
  const lab = (i: number) => (times ? times[i] : String(i));
  const out: Omit<AnomalyEvent, "severity">[] = [];
  const groups: number[][] = [];
  for (let i = 0; i < T; i++) {
    if (!res.point[i]) continue;
    const g = groups.at(-1);
    if (g && i - g[g.length - 1] <= res.params.merge_gap + 1) g.push(i); else groups.push([i]);
  }
  for (const g of groups) {
    let pk = g[0];
    for (const i of g) if (Math.abs(res.z[i]) > Math.abs(res.z[pk])) pk = i;
    out.push({ type: g.length >= 3 ? "racha" : "punto", start: g[0], end: g[g.length - 1], tStart: lab(g[0]), tEnd: lab(g[g.length - 1]),
      peakZ: round2(res.z[pk]), direction: res.z[pk] > 0 ? "alto" : "bajo", nFlagged: g.length });
  }
  const merge = Math.max(Math.floor(res.period / 2), 12);
  const grp: number[][] = [];
  for (let t = 0; t < T; t++) {
    if (!res.shift[t]) continue;
    const g = grp.at(-1);
    if (g && res.shift[t] === res.shift[g[g.length - 1]] && t - g[g.length - 1] <= merge) g.push(t); else grp.push([t]);
  }
  const shifts: Omit<AnomalyEvent, "severity">[] = [];
  for (const g of grp) {
    const sgn = res.shift[g[0]], first = g[0], last = g[g.length - 1];
    const j = res.onset[first] >= 0 ? res.onset[first] : first;
    let s = 0, n = 0;
    for (let k = j; k <= last; k++) if (fin(res.z[k])) { s += res.z[k]; n++; }
    const ev = { type: "cambio_nivel" as const, start: j, end: last, tStart: lab(j), tEnd: lab(last), direction: sgn > 0 ? "alto" as const : "bajo" as const,
      nFlagged: last - j + 1, meanZ: round2(n ? s / n : NaN) };
    out.push(ev);
    shifts.push(ev);
  }
  shifts.forEach((e, i) => {
    for (const prev of shifts.slice(0, i)) if (prev.direction !== e.direction && e.start - prev.end >= 0 && e.start - prev.end <= 2 * res.period) e.returnLikely = true;
  });
  for (const [mask, kind] of [[res.gap, "sin_datos"], [res.outOfRange, "fuera_de_rango"], [res.frozen, "congelado"]] as const) {
    for (let i = 0; i < T;) {
      if (!mask[i]) { i++; continue; }
      let j = i;
      while (j < T && mask[j]) j++;
      out.push({ type: kind, start: i, end: j - 1, tStart: lab(i), tEnd: lab(j - 1), nFlagged: j - i });
      i = j;
    }
  }
  out.sort((a, b) => a.start - b.start || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return out.map((e) => ({ ...e, severity: severity(e) }));
}
