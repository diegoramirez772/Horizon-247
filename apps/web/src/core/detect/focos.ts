// «Detector de lo significativo» (traspaso 3D, D1): HORI's verdicts → a few places worth flying to.
//
// Golden rule: nothing here is a new statistical test. Every cell keeps HORI's verdict (3-method consensus + BH-FDR),
// its effect, interval, q-value and δ. This file only DESCRIBES where those verdicts sit together on the map:
//   · a focus = cells HORI marks as supported (PROBADO) whose WHOLE interval lies beyond δ in the same direction,
//     joined by their edges (4-neighbours; the longitude wraps on a global grid). Plain «supported» merges most of the
//     planet into one blob for temperature (measured: 6 782 of 8 118 cells on the 2° layer), which shows nothing;
//   · an «aún no se sabe» zone = contiguous candidate or inconclusive cells (verdict 2 or 3).
// Area is real area (cos latitude), so polar cells — tiny on a lat/lon grid — do not count as much as tropical ones.
// The order is written out in `SCORE_TEXT` and shown in the panel next to each focus.

import type { Manifest } from "@/contract/types";
import { FLAG } from "@/contract/types";
import type { Layer, NumArray } from "@/core/contract/loader";
import { type FlagName, VERDICT, YEARS_MORE_OVER_60 } from "@/core/contract/extra";

const R_KM = 6371;
const RAD = Math.PI / 180;
/** Ceiling of the evidence factor: −log10(q) above 6 adds nothing (q < 10⁻⁶ is already overwhelming). */
const Q_CAP = 6;
/** Ceiling of |effect| / δ: one huge cell must not outrank a large coherent area. */
const EFFECT_CAP = 4;

export type FocusKind = "apoyado" | "no_se_sabe";

export interface Focus {
  id: string;
  kind: FocusKind;
  /** Rank, 1 = shown first. */
  rank: number;
  cells: number[];
  areaKm2: number;
  /** Area-weighted centre and the box around the cells (lon/lat degrees). */
  lat: number;
  lon: number;
  bbox: [number, number, number, number];
  /** +1 = the variable rises, −1 = it falls, 0 = mixed (only «no se sabe» zones). */
  sign: 1 | -1 | 0;
  /** Area-weighted mean effect per decade, the typical interval (area-weighted mean of the bounds) and the span of
   *  all the cells' intervals. */
  effect: number;
  ciLo: number;
  ciHi: number;
  ciMin: number;
  ciMax: number;
  delta: number;
  /** Median q-value of the cells (HORI's BH-FDR). */
  qMedian: number;
  /** Share of cells that the e-value procedure (e-BH) also flags; null when the bundle has no e-BH. */
  ebhShare: number | null;
  /** Quality flags carried by at least 30 % of the cells. */
  flags: FlagName[];
  /** «no se sabe» zones: median years still needed (null = no estimate; 255 = more than 60) and share of candidates. */
  yearsMore: number | null;
  candidateShare: number;
  mde: number;
  score: number;
  /** The three factors of the score, so the panel can say why this focus comes first. */
  why: { areaKm2: number; effectOverDelta: number; evidence: number };
}

export interface FocusOptions {
  /** Smallest group shown as a focus (default 3 cells): single cells are read as noise, never as a place. */
  minCells?: number;
  /** Maximum number of foci of each kind (default 12). */
  max?: number;
}

export interface FocusSet {
  supported: Focus[];
  unknown: Focus[];
  /** Supported cells that fall in no focus (interval touches δ, or groups below `minCells`). */
  looseSupported: number;
}

/** How the order is decided, word for word in the panel (lint-safe: no forbidden words). */
export const SCORE_TEXT = {
  es: "Orden: área real × (efecto ÷ δ, tope 4) × fuerza de la evidencia (−log₁₀ q ÷ 6, tope 1). Nunca el valor más llamativo de una sola celda.",
  en: "Order: real area × (effect ÷ δ, capped at 4) × strength of evidence (−log₁₀ q ÷ 6, capped at 1). Never the most striking value of a single cell.",
};
export const UNKNOWN_TEXT = {
  es: "Orden: área real. Son celdas contiguas donde HORI todavía no puede decir si hay un cambio mayor que δ.",
  en: "Order: real area. Contiguous cells where HORI cannot yet say whether there is a change larger than δ.",
};

type Arrays = Partial<Record<string, NumArray>>;

/** δ of one cell: `delta.f32` when the bundle has it, else the profile's δ, else δ in σ units × σ of the cell. */
export function cellDelta(m: Manifest, a: Arrays, i: number): number {
  const d = a.delta?.[i];
  if (d !== undefined && Number.isFinite(d) && d > 0) return d;
  const p = (m.params as Manifest["params"] & { delta_per_decade?: number | null }).delta_per_decade;
  if (typeof p === "number" && p > 0) return p;
  const s = a.sigma?.[i];
  return s !== undefined && Number.isFinite(s) ? m.params.delta_sigma_per_decade * s : NaN;
}

/** +1 / −1 when HORI supports the change AND the whole interval is beyond δ on one side; 0 otherwise. */
export function coreSign(m: Manifest, a: Arrays, i: number): 1 | -1 | 0 {
  if (a.verdict?.[i] !== VERDICT.PROBADO) return 0;
  const lo = a.ci_lo?.[i], hi = a.ci_hi?.[i], d = cellDelta(m, a, i);
  if (lo === undefined || hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(d)) return 0;
  if (lo >= d) return 1;
  if (hi <= -d) return -1;
  return 0;
}

function cellArea(m: Manifest, i: number): number {
  const g = m.grid;
  const lat = g.lat0 + Math.floor(i / g.nlon) * g.dlat;
  return R_KM * R_KM * Math.abs(g.dlat * RAD) * Math.abs(g.dlon * RAD) * Math.max(0, Math.cos(lat * RAD));
}

/**
 * Connected groups of cells with the same non-zero key. 4-neighbours; wraps in longitude.
 * The keys are computed once into a typed array (a 0.5° layer has 207 936 cells; the laptop is an E2-9000).
 */
export function components(m: Manifest, keyOf: ((i: number) => number) | Int8Array): number[][] {
  const { nlat, nlon, dlon } = m.grid;
  const n = nlat * nlon;
  let keys: Int8Array;
  if (keyOf instanceof Int8Array) keys = keyOf;
  else { keys = new Int8Array(n); for (let i = 0; i < n; i++) keys[i] = keyOf(i); }
  const key = (i: number) => keys[i];
  const wraps = nlon * Math.abs(dlon) > 359;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const out: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const k = key(s);
    if (!k) { seen[s] = 1; continue; }
    const group: number[] = [];
    let top = 0;
    stack[top++] = s; seen[s] = 1;
    while (top) {
      const i = stack[--top];
      group.push(i);
      const r = Math.floor(i / nlon), c = i % nlon;
      const up = r > 0 ? i - nlon : -1, down = r < nlat - 1 ? i + nlon : -1;
      const left = c > 0 ? i - 1 : wraps ? i + nlon - 1 : -1, right = c < nlon - 1 ? i + 1 : wraps ? i - nlon + 1 : -1;
      if (up >= 0 && !seen[up] && key(up) === k) { seen[up] = 1; stack[top++] = up; }
      if (down >= 0 && !seen[down] && key(down) === k) { seen[down] = 1; stack[top++] = down; }
      if (left >= 0 && !seen[left] && key(left) === k) { seen[left] = 1; stack[top++] = left; }
      if (right >= 0 && !seen[right] && key(right) === k) { seen[right] = 1; stack[top++] = right; }
    }
    out.push(group);
  }
  return out;
}

function median(xs: number[]): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const h = v.length >> 1;
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

/** Centre and box of a group; on a global grid the centre longitude is a circular mean (groups can cross ±180°). */
function geometry(m: Manifest, cells: number[], w: number[]): Pick<Focus, "lat" | "lon" | "bbox"> {
  const g = m.grid;
  let sx = 0, sy = 0, sl = 0, sw = 0, x0 = 180, x1 = -180, y0 = 90, y1 = -90;
  cells.forEach((i, k) => {
    const lat = g.lat0 + Math.floor(i / g.nlon) * g.dlat, lon = g.lon0 + (i % g.nlon) * g.dlon;
    const ww = w[k] || 1e-9;
    sx += Math.cos(lon * RAD) * ww; sy += Math.sin(lon * RAD) * ww; sl += lat * ww; sw += ww;
    x0 = Math.min(x0, lon); x1 = Math.max(x1, lon); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat);
  });
  const lon = Math.atan2(sy, sx) / RAD, lat = sl / sw;
  const hx = Math.abs(g.dlon) / 2, hy = Math.abs(g.dlat) / 2;
  // A group that crosses the antimeridian: its box is the one around the centre, not −180…180.
  if (x1 - x0 > 180) { const span = Math.min(360, cells.length * Math.abs(g.dlon)); x0 = lon - span / 2; x1 = lon + span / 2; }
  return { lat, lon, bbox: [x0 - hx, Math.max(-90, y0 - hy), x1 + hx, Math.min(90, y1 + hy)] };
}

function flagsOf(a: Arrays, cells: number[]): FlagName[] {
  const f = a.flags;
  if (!f) return [];
  return (Object.keys(FLAG) as FlagName[]).filter((k) => cells.filter((i) => (f[i] & FLAG[k]) !== 0).length >= cells.length * 0.3);
}

function describe(m: Manifest, a: Arrays, cells: number[], kind: FocusKind, sign: 1 | -1 | 0): Omit<Focus, "id" | "rank"> {
  const w = cells.map((i) => cellArea(m, i));
  const area = w.reduce((s, x) => s + x, 0);
  const wmean = (arr: NumArray | undefined) => {
    if (!arr) return NaN;
    let s = 0, sw = 0;
    cells.forEach((i, k) => { const v = arr[i]; if (Number.isFinite(v)) { s += v * w[k]; sw += w[k]; } });
    return sw ? s / sw : NaN;
  };
  const effect = wmean(a.effect);
  const deltas = cells.map((i) => cellDelta(m, a, i));
  const delta = median(deltas);
  let lo = Infinity, hi = -Infinity;
  for (const i of cells) {
    const l = a.ci_lo?.[i], h = a.ci_hi?.[i];
    if (l !== undefined && Number.isFinite(l)) lo = Math.min(lo, l);
    if (h !== undefined && Number.isFinite(h)) hi = Math.max(hi, h);
  }
  const qMedian = median(cells.map((i) => a.q_cons?.[i] ?? NaN));
  const ebh = a.ebh_sig;
  const ebhShare = ebh ? cells.filter((i) => ebh[i] === 1).length / cells.length : null;
  const ym = a.years_more;
  // years_more: 255 = «more than 60» (SPEC §2); keep it as such in the median, it is an order, not a value.
  const yearsMore = ym ? median(cells.map((i) => ym[i])) : NaN;
  const candidates = cells.filter((i) => a.verdict?.[i] === VERDICT.CANDIDATA).length;
  // Effect relative to δ per cell, capped, then area-weighted: a large coherent area beats one extreme cell.
  let eod = 0;
  cells.forEach((i, k) => {
    const e = a.effect?.[i], d = deltas[k];
    if (e !== undefined && Number.isFinite(e) && d > 0) eod += Math.min(EFFECT_CAP, Math.abs(e) / d) * w[k];
  });
  eod = area ? eod / area : 0;
  const evidence = Number.isFinite(qMedian) ? Math.min(1, -Math.log10(Math.max(qMedian, 1e-300)) / Q_CAP) : 0;
  const score = kind === "apoyado" ? area * eod * evidence : area;
  return {
    kind, cells, areaKm2: area, sign, ...geometry(m, cells, w),
    effect, ciLo: wmean(a.ci_lo), ciHi: wmean(a.ci_hi), ciMin: Number.isFinite(lo) ? lo : NaN, ciMax: Number.isFinite(hi) ? hi : NaN,
    delta, qMedian, ebhShare,
    flags: flagsOf(a, cells),
    yearsMore: Number.isFinite(yearsMore) ? (yearsMore >= YEARS_MORE_OVER_60 ? YEARS_MORE_OVER_60 : yearsMore) : null,
    candidateShare: candidates / cells.length,
    mde: wmean(a.mde),
    score,
    why: { areaKm2: area, effectOverDelta: eod, evidence },
  };
}

/** The whole detector: supported foci and «aún no se sabe» zones of one layer, each list in its honest order. */
export function findFoci(layer: Pick<Layer, "manifest" | "arrays">, opt: FocusOptions = {}): FocusSet {
  const m = layer.manifest;
  const a = layer.arrays as Arrays;
  const minCells = opt.minCells ?? 3, max = opt.max ?? 12;
  const v = a.verdict;
  if (!v) return { supported: [], unknown: [], looseSupported: 0 };

  const signs = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) if (v[i] === VERDICT.PROBADO) signs[i] = coreSign(m, a, i);
  const supported = components(m, signs).filter((c) => c.length >= minCells)
    .map((c) => describe(m, a, c, "apoyado", signs[c[0]] as 1 | -1))
    .sort((x, y) => y.score - x.score || y.areaKm2 - x.areaKm2)
    .slice(0, max)
    .map((f, k): Focus => ({ ...f, id: `apoyado-${k + 1}`, rank: k + 1 }));

  const inFocus = supported.reduce((s, f) => s + f.cells.length, 0);
  let allSupported = 0;
  for (let i = 0; i < v.length; i++) if (v[i] === VERDICT.PROBADO) allSupported++;

  const openKeys = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) openKeys[i] = v[i] === VERDICT.CANDIDATA || v[i] === VERDICT.NO_CONCLUYENTE ? 1 : 0;
  const open = components(m, openKeys);
  const unknown = open.filter((c) => c.length >= minCells)
    .map((c) => describe(m, a, c, "no_se_sabe", 0))
    .sort((x, y) => y.score - x.score)
    .slice(0, max)
    .map((f, k): Focus => ({ ...f, id: `no-se-sabe-${k + 1}`, rank: k + 1 }));

  return { supported, unknown, looseSupported: allSupported - inFocus };
}

/**
 * Yearly series of a focus for the generated scene: the area-weighted mean of HORI's per-cell yearly values
 * (descriptive, missing years skipped). Null when the layer's series is not loaded.
 */
export function focusSeries(layer: Pick<Layer, "manifest" | "series">, f: Pick<Focus, "cells">): number[] | null {
  const s = layer.series, m = layer.manifest;
  if (!s) return null;
  const n = m.window.n;
  const sum = new Float64Array(n), wsum = new Float64Array(n);
  for (const i of f.cells) {
    const w = cellArea(m, i);
    for (let y = 0; y < n; y++) { const v = s[i * n + y]; if (Number.isFinite(v)) { sum[y] += v * w; wsum[y] += w; } }
  }
  return Array.from(sum, (v, y) => (wsum[y] ? v / wsum[y] : NaN));
}
