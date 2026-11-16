// Near space, for «En vivo», the globe and the assistant:
//   · from bundles/space.json (scripts/build_space.py; NASA/JPL has no CORS): close approaches of the next 60 days,
//     Sentry's impact monitoring summary and fireballs (bolides) with their place, height, speed and energy;
//   · live from NOAA SWPC (CORS open): the planetary Kp index every 3 hours and the aurora (OVATION) probability map.
// The Kp series also goes through HORI's anomaly detector (period = 8 samples a day), next to NOAA's official G scale.
// Honesty: Sentry's Palermo values are negative (below the background risk); the screen says so in those words.

import { BUNDLES } from "@/components/useBundles";
import { detect, events } from "@/core/watch/anomaly";
import { lastGood } from "./lastgood";

export interface Approach { name: string; des: string; date: string; dist_km: number; dist_ld: number; v_kms: number; h: number | null; diameter_m: [number, number] | null }
export interface SentryObj { name: string; des: string; range: string; ps_cum: number; ts_max: number; ip: number; diameter_km: number | null }
export interface Fireball { date: string; lat: number; lon: number; alt_km: number | null; v_kms: number | null; energy_kt: number | null; radiated_j: number | null }
export interface SpaceDoc {
  built: string;
  approaches: Approach[];
  sentry: { count: number; max_ps_cum: number | null; max_torino: number; top: SentryObj[] };
  fireballs: Fireball[];
}

let docP: Promise<SpaceDoc> | null = null;
export function loadSpace(): Promise<SpaceDoc> {
  docP ??= fetch(`${BUNDLES}space.json`).then((r) => { if (!r.ok) throw new Error(`space ${r.status}`); return r.json() as Promise<SpaceDoc>; });
  docP.catch(() => { docP = null; });
  return docP;
}

// ---- Kp (NOAA SWPC) ----

export interface KpReading {
  times: string[]; values: number[]; now: number; at: string;
  /** NOAA geomagnetic storm scale: G0 (none) … G5 (extreme), from Kp ≥ 5 … 9. */
  g: number;
  /** HORI's anomaly detector on the same series (period one day = 8 samples); null if it is too short to judge. */
  hori: { unusual: boolean; z: number | null; since: string | null } | null;
  stale: boolean; savedAt: number;
}

export function gScale(kp: number): number { return kp >= 9 ? 5 : kp >= 8 ? 4 : kp >= 7 ? 3 : kp >= 6 ? 2 : kp >= 5 ? 1 : 0; }

export async function fetchKp(): Promise<KpReading> {
  const got = await lastGood<{ time_tag: string; Kp: number }[]>("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", { source: "Clima espacial (NOAA)", key: "kp" });
  const rows = got.data.filter((r) => Number.isFinite(r.Kp));
  const times = rows.map((r) => r.time_tag.slice(0, 16).replace("T", " ")), values = rows.map((r) => r.Kp);
  let hori: KpReading["hori"] = null;
  try {
    const res = detect(values, 8, { cycles: 3 });
    const ev = events(res, times).filter((e) => e.direction === "alto");
    const last = ev.at(-1) ?? null;
    const recent = !!last && times.indexOf(last.tEnd) >= times.length - 8;
    hori = { unusual: recent, z: last?.peakZ ?? null, since: recent ? last!.tStart : null };
  } catch { hori = null; }
  const now = values.at(-1) ?? 0;
  return { times, values, now, at: times.at(-1) ?? "", g: gScale(now), hori, stale: got.stale, savedAt: got.savedAt };
}

// ---- aurora (OVATION) ----

export interface Aurora { at: string; /** [lon, lat, probability %] with probability ≥ 10, every 2°. */ cells: [number, number, number][] }

let auroraP: Promise<Aurora> | null = null;
let auroraAt = 0;
/** The aurora map (~0.9 MB from NOAA), thinned to the cells where it can be seen; refreshed every 30 min. */
export function fetchAurora(): Promise<Aurora> {
  if (auroraP && Date.now() - auroraAt < 30 * 60e3) return auroraP;
  auroraAt = Date.now();
  auroraP = lastGood<{ "Forecast Time"?: string; coordinates: [number, number, number][] }>("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json", {
    source: "Auroras (NOAA)", key: "aurora", timeoutMs: 8000,
  }).then((g) => ({
    at: g.data["Forecast Time"] ?? "",
    cells: g.data.coordinates.filter(([lo, la, p]) => p >= 10 && lo % 2 === 0 && la % 2 === 0).map(([lo, la, p]) => [lo > 180 ? lo - 360 : lo, la, p] as [number, number, number]),
  }));
  auroraP.catch(() => { auroraP = null; });
  return auroraP;
}

/** «2026-Dec-04 00:35» → «4 dic 2026, 00:35 UTC». */
export function cadDate(s: string, lang: "es" | "en"): string {
  const d = new Date(`${s.replace(/-(\w{3})-/, " $1 ")} UTC`);
  return Number.isFinite(d.getTime()) ? `${d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, ${s.slice(-5)} UTC` : s;
}
