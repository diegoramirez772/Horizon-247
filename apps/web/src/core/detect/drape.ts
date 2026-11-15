// HORI's verdict draped over the real relief (traspaso 3D, D3). One texel per grid cell inside the box, nearest
// filtering, so the cell edges stay where HORI's cells are. The colour is the legend's; the alpha says HOW to paint:
//   255 supported (solid, colour = effect) · 200 no change > δ (flat grey) · 120 candidate (dots) ·
//    60 inconclusive (stripes) · 0 no data / outside the grid.
// Nothing is interpolated or smoothed: a 2° cell over a 12 km zone is one colour, and the label says so.

import { VERDICT } from "@/core/contract/extra";
import type { Layer } from "@/core/contract/loader";
import { type MapTheme, effectStep, hexToRgb, stepColor } from "@/core/map/palette";

export const DRAPE_CODE = { supported: 255, noChange: 200, candidate: 120, inconclusive: 60, none: 0 } as const;

export interface Drape {
  w: number;
  h: number;
  rgba: Uint8Array;
  /** Outer edges of the cells in the texture: lonMin, latMin, lonMax, latMax. */
  box: [number, number, number, number];
  /** Cell size in degrees (for the caption). */
  cellDeg: number;
  /** Verdict counts inside the box. */
  counts: Record<number, number>;
}

/** Most texels per side: a 0.5° grid over a 12° box is 24 × 24; this only guards against a huge request. */
const MAX_SIDE = 512;

export function buildDrape(layer: Pick<Layer, "manifest" | "arrays">, box: [number, number, number, number], theme: MapTheme, blueIsMore: boolean, scale: number): Drape | null {
  const g = layer.manifest.grid, a = layer.arrays;
  if (!a.verdict) return null;
  const hw = Math.abs(g.dlon) / 2, hh = Math.abs(g.dlat) / 2;
  const colOf = (lon: number) => Math.round((lon - g.lon0) / g.dlon);
  const rowOf = (lat: number) => Math.round((lat - g.lat0) / g.dlat);
  // Columns and rows (unwrapped) whose cells touch the box.
  const c0 = Math.min(colOf(box[0] + hw * 0.999), colOf(box[2] - hw * 0.999)), c1 = Math.max(colOf(box[0] + hw * 0.999), colOf(box[2] - hw * 0.999));
  const r0 = Math.min(rowOf(box[1] + hh * 0.999), rowOf(box[3] - hh * 0.999)), r1 = Math.max(rowOf(box[1] + hh * 0.999), rowOf(box[3] - hh * 0.999));
  const w = c1 - c0 + 1, h = r1 - r0 + 1;
  if (w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) return null;
  const wraps = g.nlon * Math.abs(g.dlon) > 359;
  const rgba = new Uint8Array(w * h * 4);
  const grey = hexToRgb(theme.noChange), ink = hexToRgb(theme.ink);
  const counts: Record<number, number> = {};
  // Texture rows go north → south (row 0 = top), whatever the sign of dlat.
  const northFirst = g.dlat < 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const row = northFirst ? r0 + y : r1 - y;
    let col = c0 + x;
    if (wraps) col = ((col % g.nlon) + g.nlon) % g.nlon;
    if (row < 0 || row >= g.nlat || col < 0 || col >= g.nlon) continue;
    const i = row * g.nlon + col, p = (y * w + x) * 4;
    const v = a.verdict[i];
    counts[v] = (counts[v] ?? 0) + 1;
    let rgb: [number, number, number] = ink, code: number = DRAPE_CODE.none;
    if (v === VERDICT.PROBADO) {
      const hex = stepColor(theme, effectStep(a.effect?.[i] ?? NaN, scale), blueIsMore);
      if (hex) { rgb = hexToRgb(hex); code = DRAPE_CODE.supported; }
    } else if (v === VERDICT.SIN_CAMBIO_MAYOR_QUE_DELTA) { rgb = grey; code = DRAPE_CODE.noChange; }
    else if (v === VERDICT.CANDIDATA) code = DRAPE_CODE.candidate;
    else if (v === VERDICT.NO_CONCLUYENTE) code = DRAPE_CODE.inconclusive;
    rgba[p] = rgb[0]; rgba[p + 1] = rgb[1]; rgba[p + 2] = rgb[2]; rgba[p + 3] = code;
  }
  const lonA = g.lon0 + c0 * g.dlon, lonB = g.lon0 + c1 * g.dlon, latA = g.lat0 + r0 * g.dlat, latB = g.lat0 + r1 * g.dlat;
  return {
    w, h, rgba, counts, cellDeg: Math.abs(g.dlat),
    box: [Math.min(lonA, lonB) - hw, Math.min(latA, latB) - hh, Math.max(lonA, lonB) + hw, Math.max(latA, latB) + hh],
  };
}
