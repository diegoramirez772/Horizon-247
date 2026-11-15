// What the web needs from the contract that `src/contract/types.ts` (auto-synced, never edited by hand)
// does not spell out as a type. Everything here is read from contract/SPEC.md; nothing is invented.

import { FLAG, type Manifest, type Region, type Verdict } from "@/contract/types";

/** SPEC §1: index.json = [{id, profile, title, variable, window, path}]. Types of title/variable/window are open (PREGUNTAS #1). */
export interface IndexEntry {
  id: string;
  profile: Manifest["profile"];
  title: { es: string; en: string } | string;
  variable: unknown;
  window: { start: number; end: number; n: number } | unknown;
  path: string;
  /** ZON export: "layer" (trend), "timeline" (when it became known) or "anomaly" (last month). Absent = layer. */
  kind?: "layer" | "timeline" | "anomaly";
  data_real?: boolean;
}

/** SPEC §3: verdict codes. The web never computes them; HORI writes them. */
export const VERDICT = {
  INSUFICIENTE: 0,
  PROBADO: 1,
  CANDIDATA: 2,
  NO_CONCLUYENTE: 3,
  SIN_CAMBIO_MAYOR_QUE_DELTA: 4,
} as const satisfies Record<string, Verdict>;

export type FlagName = keyof typeof FLAG;

export function flagNames(flags: number): FlagName[] {
  return (Object.keys(FLAG) as FlagName[]).filter((k) => (flags & FLAG[k]) !== 0);
}

/** SPEC §2: years_more = 255 means "more than 60". */
export const YEARS_MORE_OVER_60 = 255;

/** Window of an index entry, when it carries one (used to pair 24- and 45-year layers). */
export function entryWindow(e: IndexEntry): { start: number; end: number; n: number } | null {
  const w = e.window as { start?: unknown; end?: unknown; n?: unknown } | null;
  if (w && typeof w.start === "number" && typeof w.end === "number" && typeof w.n === "number") {
    return { start: w.start, end: w.end, n: w.n };
  }
  return null;
}

export function entryTitle(e: IndexEntry, lang: "es" | "en"): string {
  return typeof e.title === "string" ? e.title : (e.title?.[lang] ?? e.id);
}

/** Layers of the same variable and profile, ordered by window length (the 24 ↔ 45 years switch). */
export function siblings(index: IndexEntry[], entry: IndexEntry | null): IndexEntry[] {
  if (!entry) return [];
  const v = JSON.stringify(entry.variable);
  return index
    .filter((e) => e.profile === entry.profile && JSON.stringify(e.variable) === v && entryWindow(e))
    .sort((a, b) => entryWindow(a)!.n - entryWindow(b)!.n);
}

/** One entry per variable for the layer selector (the window is chosen separately). */
export function variables(index: IndexEntry[], profile: string): IndexEntry[] {
  const seen = new Set<string>();
  return index.filter((e) => {
    if (e.profile !== profile) return false;
    const v = JSON.stringify(e.variable);
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

/**
 * Region with an optional bounding box [lonMin, latMin, lonMax, latMax]. The contract (§8.2) has no geometry yet:
 * `bbox` is an ADDITIVE proposal for Diego so the map can fly to a region and outline it.
 */
export type RegionGeo = Region & { bbox?: [number, number, number, number] };
