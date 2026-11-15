"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContextCard } from "@/contract/types";
import type { IndexEntry, RegionGeo } from "@/core/contract/extra";
import { loadContext, loadIndex, loadLayer, loadRegions, loadSeries, loadWindow, type Layer } from "@/core/contract/loader";
import type { MapData } from "@/core/map/MapView";
import { moreIsBlue, robustRange, robustScale } from "@/core/map/palette";
import type { AppState } from "@/core/state/store";

/** Bundles are served next to the page (static export); relative so it also works under a sub-path. */
export const BUNDLES = "bundles/";

export type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

export function useIndex(): { index: Load<IndexEntry[]>; regions: RegionGeo[]; context: ContextCard[] } {
  const [index, setIndex] = useState<Load<IndexEntry[]>>({ status: "loading" });
  const [regions, setRegions] = useState<RegionGeo[]>([]);
  const [context, setContext] = useState<ContextCard[]>([]);
  useEffect(() => {
    let live = true;
    loadIndex(BUNDLES)
      .then((v) => { if (live) setIndex({ status: "ready", value: Array.isArray(v) ? v : [] }); })
      .catch((e: Error) => { if (live) setIndex({ status: "error", message: e.message }); });
    // Optional files (SPEC §8.2, §8.4): their absence is not an error.
    loadRegions(BUNDLES).then((r) => { if (live) setRegions(r); }).catch(() => {});
    loadContext(BUNDLES).then((c) => { if (live) setContext(c); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return { index, regions, context };
}

export function useLayer(entry: IndexEntry | null, attempt: number): Load<Layer> {
  const [state, setState] = useState<{ key: string; load: Load<Layer> } | null>(null);
  const key = entry ? `${entry.path}#${attempt}` : "";
  useEffect(() => {
    if (!entry) return;
    let live = true;
    loadLayer(BUNDLES + entry.path)
      .then((value) => { if (live) setState({ key, load: { status: "ready", value } }); })
      .catch((e: Error) => { if (live) setState({ key, load: { status: "error", message: e.message } }); });
    return () => { live = false; };
  }, [entry, key]);
  return state && state.key === key ? state.load : { status: "loading" };
}

/** Loads series.f32 when needed (year-by-year mode, or a cell selected) and reports when it is there. */
export function useSeries(layer: Layer | null, needed: boolean): boolean {
  const [readyFor, setReadyFor] = useState<Layer | null>(null);
  useEffect(() => {
    if (!layer || !needed || !layer.manifest.series) return;
    let live = true;
    loadSeries(layer).then(() => { if (live) setReadyFor(layer); }).catch(() => {});
    return () => { live = false; };
  }, [layer, needed]);
  return !!layer && (layer.series !== null || readyFor === layer);
}

/** Builds what the map paints for the current time mode. The web never recomputes a verdict. */
export function useMapData(layer: Layer | null, s: AppState, seriesReady: boolean): { data: MapData | null; blueIsMore: boolean } {
  const blueIsMore = layer ? moreIsBlue(layer.manifest.variable) : false;
  const baseScale = useMemo(() => (layer?.arrays.effect ? robustScale(layer.arrays.effect as Float32Array) : 1), [layer]);
  const seriesScale = useMemo(() => (layer && seriesReady && layer.series ? robustScale(layer.series) : 1), [layer, seriesReady]);
  const [win, setWin] = useState<{ key: string; data: MapData } | null>(null);

  const winKey = layer && s.timeMode === "acumulada" && layer.manifest.windows && s.windowEnd ? `${layer.basePath}@${s.windowEnd}` : "";
  useEffect(() => {
    if (!layer || !winKey || !s.windowEnd) return;
    let live = true;
    loadWindow(layer, s.windowEnd).then((w) => {
      if (!live) return;
      const eff = w.effect as Float32Array;
      setWin({ key: winKey, data: { grid: layer.manifest.grid, verdict: w.verdict as Uint8Array, effect: eff, scale: robustScale(eff), blueIsMore } });
    }).catch(() => {});
    return () => { live = false; };
  }, [layer, winKey, s.windowEnd, blueIsMore]);

  const data = useMemo<MapData | null>(() => {
    if (!layer) return null;
    const m = layer.manifest;
    if (s.timeMode === "anual" && m.series) {
      if (!seriesReady || !layer.series) return null;
      // SPEC §8.1: year by year = column t of series.f32. Descriptive, no verdict.
      const years = m.series.years;
      const t = Math.max(0, years.indexOf(s.year ?? years[years.length - 1]));
      const n = m.window.n;
      const col = new Float32Array(layer.cells);
      for (let i = 0; i < layer.cells; i++) col[i] = layer.series[i * n + t];
      return { grid: m.grid, verdict: new Uint8Array(layer.cells), effect: col, scale: seriesScale, blueIsMore, mode: "descriptive" };
    }
    if (s.timeMode === "acumulada" && winKey) return win && win.key === winKey ? win.data : null;
    // Experto metrics (full window): the estimated effect everywhere, the MDE, the years still needed.
    // They describe the layer; the verdict is still HORI's and is not recomputed.
    if (s.metric === "effect") {
      return { grid: m.grid, verdict: layer.arrays.verdict as Uint8Array, effect: layer.arrays.effect as Float32Array, scale: baseScale, blueIsMore, mode: "descriptive" };
    }
    if (s.metric === "mde" && layer.arrays.mde) {
      const v = layer.arrays.mde as Float32Array;
      return { grid: m.grid, verdict: layer.arrays.verdict as Uint8Array, effect: v, scale: 1, blueIsMore, mode: "sequential", range: robustRange(v) };
    }
    if (s.metric === "years" && layer.arrays.years_more) {
      const src = layer.arrays.years_more as Float32Array;
      const v = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) v[i] = src[i] === 255 ? 61 : src[i]; // 255 = "more than 60"
      const [a, b] = robustRange(v);
      return { grid: m.grid, verdict: layer.arrays.verdict as Uint8Array, effect: v, scale: 1, blueIsMore, mode: "sequential", range: [a, Math.max(b, a + 1)] };
    }
    return { grid: m.grid, verdict: layer.arrays.verdict as Uint8Array, effect: layer.arrays.effect as Float32Array, scale: baseScale, blueIsMore };
  }, [layer, s.timeMode, s.year, s.metric, seriesReady, seriesScale, baseScale, blueIsMore, winKey, win]);

  return { data, blueIsMore };
}
