// Evidence prisms (traspaso 3D, D2): one prism per cell of the foci on screen. Height = |effect| per decade relative
// to δ, colour = the legend's colour for that effect. Only SUPPORTED cells are solid; candidates are see-through and
// inconclusive cells are an outline only. Each focus also gets one evidence column at its centre: a thin bar for the
// typical interval and a notch at δ (and at the MDE for «aún no se sabe»), so you can read how far it is from knowing.
// Pure: the globe only draws what this returns.

import { VERDICT } from "@/core/contract/extra";
import type { Layer } from "@/core/contract/loader";
import { type MapTheme, effectStep, hexToRgb, stepColor } from "@/core/map/palette";
import type { Focus, FocusSet } from "./focos";

export type RGB = [number, number, number];
export type PrismStyle = "solid" | "glass" | "outline";

/** One prism: a cell, or a block of b × b cells when the focus has more cells than its share of the budget. */
export interface PrismCell { lat: number; lon: number; h: number; rgb: RGB; style: PrismStyle; group: number; hw: number; hh: number }

export interface PrismColumn {
  group: number;
  lat: number;
  lon: number;
  /** Heights (same scale as the prisms): typical interval, δ and, for «no se sabe», the MDE. */
  lo: number;
  hi: number;
  delta: number;
  mde: number | null;
  tag: string;
}

export interface PrismLayer {
  cells: PrismCell[];
  columns: PrismColumn[];
  /** Index into `columns` of the focus being looked at (−1 = none): drawn stronger, the rest faded. */
  active: number;
  /** Largest block side used (1 = one prism per cell everywhere). */
  block: number;
}

/** Height of an effect: |x| / (4 δ), capped at 1 — four times δ already reaches the top. */
export function heightOf(x: number, delta: number): number {
  if (!Number.isFinite(x) || !(delta > 0)) return 0;
  return Math.min(1, Math.abs(x) / (4 * delta));
}

export interface PrismInput {
  layer: Pick<Layer, "manifest" | "arrays">;
  foci: FocusSet;
  mode: "apoyado" | "no_se_sabe";
  /** Rank (1-based) of the focus being looked at. */
  active: number;
  theme: MapTheme;
  blueIsMore: boolean;
  /** Colour scale of the map (the effect that reaches the strongest step). */
  scale: number;
  /** Most prisms drawn; above it cells are grouped in blocks. Tier 1 laptops: ~650. */
  budget: number;
  tags: (f: Focus) => string;
}

export function buildPrisms(p: PrismInput): PrismLayer {
  const { manifest: m, arrays: a } = p.layer;
  const g = m.grid;
  const list = p.mode === "apoyado" ? p.foci.supported : p.foci.unknown;
  const grey = hexToRgb(p.theme.ink);
  const order = [...list].sort((x, y) => (x.rank === p.active ? -1 : y.rank === p.active ? 1 : x.rank - y.rank));
  // Too many cells for the budget (a 0.5° layer): draw b × b blocks instead of single cells, never half a focus.
  // The focus being looked at gets 70 % of the budget; the others share the rest.
  const others = order.filter((f) => f.rank !== p.active).reduce((s, f) => s + f.cells.length, 0);
  const blockFor = (n: number, share: number) => Math.max(1, Math.ceil(Math.sqrt(n / Math.max(1, p.budget * share))));
  const cells: PrismCell[] = [];
  const columns: PrismColumn[] = [];
  let maxB = 1;
  for (const f of order) {
    const b = f.rank === p.active ? blockFor(f.cells.length, 0.7) : blockFor(others, 0.3);
    maxB = Math.max(maxB, b);
    const hw = (Math.abs(g.dlon) * b) / 2, hh = (Math.abs(g.dlat) * b) / 2;
    const blocks = new Map<number, { n: number; lat: number; lon: number; e: number; worst: number }>();
    for (const i of f.cells) {
      const row = Math.floor(i / g.nlon), col = i % g.nlon;
      const k = Math.floor(row / b) * 1e6 + Math.floor(col / b);
      const e = a.effect?.[i] ?? NaN, v = a.verdict?.[i] ?? 0;
      // the weakest verdict in the block sets its style: a block is solid only if every cell is supported
      const rankOf = v === VERDICT.PROBADO ? 2 : v === VERDICT.CANDIDATA ? 1 : 0;
      const x = blocks.get(k) ?? { n: 0, lat: 0, lon: 0, e: 0, worst: 2 };
      x.n++; x.lat += g.lat0 + row * g.dlat; x.lon += g.lon0 + col * g.dlon;
      if (Number.isFinite(e)) x.e += e;
      x.worst = Math.min(x.worst, rankOf);
      blocks.set(k, x);
    }
    for (const x of blocks.values()) {
      const e = x.e / x.n;
      const hex = stepColor(p.theme, effectStep(e, p.scale), p.blueIsMore);
      const style: PrismStyle = x.worst === 2 ? "solid" : x.worst === 1 ? "glass" : "outline";
      cells.push({ lat: x.lat / x.n, lon: x.lon / x.n, h: Math.max(0.04, heightOf(e, f.delta)), rgb: hex ? hexToRgb(hex) : grey, style, group: f.rank, hw, hh });
    }
    // An interval that crosses zero starts at the ground; otherwise it floats from its smaller to its larger bound.
    const crosses = f.ciLo < 0 && f.ciHi > 0;
    const near = Math.min(Math.abs(f.ciLo), Math.abs(f.ciHi)), far = Math.max(Math.abs(f.ciLo), Math.abs(f.ciHi));
    columns.push({
      group: f.rank, lat: f.lat, lon: f.lon,
      lo: crosses ? 0 : heightOf(near, f.delta), hi: heightOf(far, f.delta),
      delta: heightOf(f.delta, f.delta), mde: f.kind === "no_se_sabe" ? heightOf(f.mde, f.delta) : null,
      tag: p.tags(f),
    });
  }
  return { cells, columns, active: columns.findIndex((c) => c.group === p.active), block: maxB };
}
