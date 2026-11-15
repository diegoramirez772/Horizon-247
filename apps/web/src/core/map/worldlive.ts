// «Mundo en vivo»: what moves on the globe right now, like a flight tracker but for the Earth system.
//   · Satellites — CelesTrak elements (stations, weather, Earth resources, science), positions computed in orbit.ts.
//     Elements change slowly: cached in this browser for 6 h (CelesTrak asks clients not to re-download often).
//   · Animals — the latest geolocated wildlife observations with photo on iNaturalist (birds, mammals, reptiles,
//     amphibians, fish). Obscured locations (protected species) are skipped.
//   · Natural events — NASA EONET open events (fires, storms, volcanoes…), core/live/eonet.ts.
// Live storms and heavy rain come from weather.ts. One shared store; nothing is fetched while nobody listens.

import { type NaturalEvent, fetchEvents } from "@/core/live/eonet";
import { type Omm, type Sat, fromOmm } from "./orbit";

export type AnimalGroup = "Aves" | "Mammalia" | "Reptilia" | "Amphibia" | "Actinopterygii";

export interface AnimalObs {
  id: number;
  lat: number;
  lon: number;
  group: AnimalGroup;
  common: string | null;
  scientific: string;
  photo: string | null;
  when: string | null;
  url: string;
}

export interface WorldLive {
  sats: Sat[];
  animals: AnimalObs[];
  events: NaturalEvent[];
  satsAt: number;
}

const SAT_GROUPS = ["stations", "weather", "resource", "science"] as const;
const SAT_STORE = "h247-sats-v1";
const SAT_TTL = 6 * 3600e3;

async function loadSats(): Promise<{ sats: Sat[]; at: number }> {
  try {
    const c = JSON.parse(localStorage.getItem(SAT_STORE) ?? "null") as { at: number; raw: [string, Omm[]][] } | null;
    if (c && Date.now() - c.at < SAT_TTL) return { sats: parseGroups(c.raw), at: c.at };
  } catch { /* storage blocked: fetch */ }
  const raw = await Promise.all(SAT_GROUPS.map(async (g) => {
    const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=json`);
    return [g, r.ok ? ((await r.json()) as Omm[]) : []] as [string, Omm[]];
  }));
  const at = Date.now();
  try { localStorage.setItem(SAT_STORE, JSON.stringify({ at, raw })); } catch { /* not kept: fine */ }
  return { sats: parseGroups(raw), at };
}

/** One entry per satellite (a satellite can be in two groups), only orbits below 2,000 km (those are visible on the globe). */
export function parseGroups(raw: [string, Omm[]][]): Sat[] {
  const seen = new Set<number>(), out: Sat[] = [];
  for (const [g, list] of raw) for (const o of list) {
    if (seen.has(o.NORAD_CAT_ID)) continue;
    const s = fromOmm(o, g);
    if (!s || s.a * (1 + s.e) - 6378 > 2000) continue;
    seen.add(o.NORAD_CAT_ID);
    out.push(s);
  }
  return out;
}

interface RawObs {
  id: number; uri?: string; obscured?: boolean; time_observed_at?: string | null; observed_on?: string | null;
  geojson?: { coordinates?: [number, number] } | null;
  taxon?: { name?: string; preferred_common_name?: string; iconic_taxon_name?: string } | null;
  photos?: { url?: string }[];
}

export function parseObservations(doc: { results?: RawObs[] }): AnimalObs[] {
  const out: AnimalObs[] = [];
  for (const o of doc.results ?? []) {
    const c = o.geojson?.coordinates, t = o.taxon;
    if (!c || o.obscured || !t?.name || !t.iconic_taxon_name) continue;
    out.push({
      id: o.id, lon: c[0], lat: c[1], group: t.iconic_taxon_name as AnimalGroup, common: t.preferred_common_name ?? null,
      scientific: t.name, photo: o.photos?.[0]?.url ?? null, when: o.time_observed_at ?? o.observed_on ?? null,
      url: o.uri ?? `https://www.inaturalist.org/observations/${o.id}`,
    });
  }
  return out;
}

async function loadAnimals(): Promise<AnimalObs[]> {
  const r = await fetch("https://api.inaturalist.org/v1/observations?iconic_taxa=Aves,Mammalia,Reptilia,Amphibia,Actinopterygii&geo=true&photos=true&order_by=created_at&per_page=200");
  return r.ok ? parseObservations(await r.json()) : [];
}

// ---- shared store ----

type Listener = (w: WorldLive) => void;
const listeners = new Set<Listener>();
let state: WorldLive = { sats: [], animals: [], events: [], satsAt: 0 };
const timers: number[] = [];

function emit(patch: Partial<WorldLive>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

const hidden = () => typeof document !== "undefined" && document.hidden;
const refreshSats = () => { if (!hidden()) loadSats().then(({ sats, at }) => emit({ sats, satsAt: at })).catch((e) => console.warn("[h247] satélites:", e)); };
const refreshAnimals = () => { if (!hidden()) loadAnimals().then((animals) => emit({ animals })).catch((e) => console.warn("[h247] fauna:", e)); };
const refreshEvents = () => { if (!hidden()) fetchEvents(30).then((events) => emit({ events })).catch((e) => console.warn("[h247] EONET:", e)); };

export function subscribeWorld(l: Listener): () => void {
  listeners.add(l);
  l(state);
  if (listeners.size === 1) {
    refreshSats(); refreshAnimals(); refreshEvents();
    timers.push(window.setInterval(refreshSats, SAT_TTL), window.setInterval(refreshAnimals, 15 * 60e3), window.setInterval(refreshEvents, 10 * 60e3));
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size) while (timers.length) clearInterval(timers.pop());
  };
}
