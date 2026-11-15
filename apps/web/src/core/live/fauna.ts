// Animal signals in the browser (same rule as packages/zon/src/zon/fetch/fauna.py): how often a group of animals is REPORTED
// in an area, month by month, divided by everything reported there that month (the observers' effort cancels out).
// iNaturalist's API is open, needs no account and allows CORS: two requests per group and area for the whole history.
// Results are kept 6 hours in this browser, so watching costs almost nothing; HORI's detector (core/watch/anomaly.ts, the
// same method as Python) says where the rate departs from its own past, and by how much. Never why (H16).

import { type AnomalyEvent, detect, events } from "@/core/watch/anomaly";

const API = "https://api.inaturalist.org/v1/observations/histogram";
const TTL_MS = 6 * 3600e3;
export const MIN_EFFORT = 30;

export type FaunaGroup = "aves" | "mamiferos" | "anfibios" | "reptiles" | "insectos" | "mariposas";

export const GROUPS: Record<FaunaGroup, { taxonId: number; es: string; en: string }> = {
  aves: { taxonId: 3, es: "Aves", en: "Birds" },
  mamiferos: { taxonId: 40151, es: "Mamíferos", en: "Mammals" },
  anfibios: { taxonId: 20978, es: "Anfibios", en: "Amphibians" },
  reptiles: { taxonId: 26036, es: "Reptiles", en: "Reptiles" },
  insectos: { taxonId: 47158, es: "Insectos", en: "Insects" },
  mariposas: { taxonId: 47157, es: "Mariposas y polillas", en: "Butterflies and moths" },
};

export type Box = [number, number, number, number]; // lonMin, latMin, lonMax, latMax

export function histogramUrl(box: Box, d1: string, d2: string, taxonId?: number): string {
  const q = new URLSearchParams({ date_field: "observed", interval: "month", verifiable: "true", d1, d2,
    swlng: box[0].toFixed(4), swlat: box[1].toFixed(4), nelng: box[2].toFixed(4), nelat: box[3].toFixed(4) });
  if (taxonId !== undefined) q.set("taxon_id", String(taxonId));
  return `${API}?${q}`;
}

export function parseHistogram(doc: unknown): Record<string, number> {
  const m = (doc as { results?: { month?: Record<string, number> } })?.results?.month ?? {};
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k.slice(0, 7), Number(v)]));
}

/** Monthly rate per 1000 observations from the first to the last month with data; thin months (< MIN_EFFORT) are missing. */
export function reportingRate(group: Record<string, number>, all: Record<string, number>, minEffort = MIN_EFFORT): { times: string[]; values: number[]; counts: number[]; effort: number[] } {
  const keys = [...new Set([...Object.keys(group), ...Object.keys(all)])].sort();
  const out = { times: [] as string[], values: [] as number[], counts: [] as number[], effort: [] as number[] };
  if (!keys.length) return out;
  let [y, m] = keys[0].split("-").map(Number);
  const [y1, m1] = keys[keys.length - 1].split("-").map(Number);
  while (y < y1 || (y === y1 && m <= m1)) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    const n = all[k] ?? 0, g = group[k] ?? 0;
    out.times.push(k); out.counts.push(g); out.effort.push(n);
    out.values.push(n >= minEffort ? (1000 * g) / n : NaN);
    if (m === 12) { y++; m = 1; } else m++;
  }
  return out;
}

export interface FaunaSignal {
  group: FaunaGroup;
  box: Box;
  times: string[];
  values: number[];
  counts: number[];
  effort: number[];
  events: AnomalyEvent[];
  /** Change of the rate after the latest sustained shift: mean after its start vs the 36 months before (descriptive). */
  change: { from: string; pct: number; before: number; after: number; direction: "alto" | "bajo" } | null;
  /** Most recent event that touches the last 12 judged months (what a watcher should hear about). */
  recent: AnomalyEvent | null;
  urls: string[];
  fetchedAt: number;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const key = `h247-inat:${url}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? "null") as { at: number; doc: unknown } | null;
    if (hit && Date.now() - hit.at < TTL_MS) return hit.doc;
  } catch { /* no storage: ask the network */ }
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
  const doc = await res.json();
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), doc })); } catch { /* full or blocked: fine */ }
  return doc;
}

/** Descriptive size of the latest level shift (never a test: HORI's CUSUM already flagged it). */
export function shiftChange(times: string[], values: number[], evs: AnomalyEvent[]): FaunaSignal["change"] {
  const s = [...evs].reverse().find((e) => e.type === "cambio_nivel");
  if (!s) return null;
  const mean = (a: number[]) => { const f = a.filter(Number.isFinite); return f.length ? f.reduce((x, y) => x + y, 0) / f.length : NaN; };
  const before = mean(values.slice(Math.max(0, s.start - 36), s.start)), after = mean(values.slice(s.start));
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return null;
  return { from: times[s.start], pct: (100 * (after - before)) / before, before, after, direction: s.direction ?? (after > before ? "alto" : "bajo") };
}

export function analyse(group: FaunaGroup, box: Box, r: ReturnType<typeof reportingRate>, urls: string[] = []): FaunaSignal {
  // the current month is still being uploaded and identified: it is never judged
  const cur = new Date().toISOString().slice(0, 7);
  const n = r.times.length && r.times[r.times.length - 1] >= cur ? r.times.length - 1 : r.times.length;
  const times = r.times.slice(0, n), values = r.values.slice(0, n);
  const res = detect(values, 12, { transform: "sqrt" });
  const evs = events(res, times);
  const lastJudged = times.length - 1;
  const recent = [...evs].reverse().find((e) => e.type !== "sin_datos" && e.end >= lastJudged - 11) ?? null;
  return { group, box, times, values, counts: r.counts.slice(0, n), effort: r.effort.slice(0, n), events: evs,
    change: shiftChange(times, values, evs), recent, urls, fetchedAt: Date.now() };
}

export async function watchFauna(group: FaunaGroup, box: Box, opts: { since?: string; signal?: AbortSignal } = {}): Promise<FaunaSignal> {
  const d1 = opts.since ?? "2012-01-01";
  const d2 = new Date().toISOString().slice(0, 10);
  const ug = histogramUrl(box, d1, d2, GROUPS[group].taxonId), ua = histogramUrl(box, d1, d2);
  const [g, a] = await Promise.all([getJson(ug, opts.signal), getJson(ua, opts.signal)]);
  return analyse(group, box, reportingRate(parseHistogram(g), parseHistogram(a)), [ug, ua]);
}

/** A box of `halfDeg` around a point (1° ≈ 110 km): big enough for citizen science to have looked. */
export function boxAround(lat: number, lon: number, halfDeg = 0.5): Box {
  return [lon - halfDeg, Math.max(-90, lat - halfDeg), lon + halfDeg, Math.min(90, lat + halfDeg)];
}
