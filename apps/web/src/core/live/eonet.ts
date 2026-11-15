// Natural events open RIGHT NOW, from NASA EONET v3 (no key, CORS open): wildfires, storms, volcanoes, ice…
// EONET curates events from other sources (InciWeb, GDACS, JTWC…): each one keeps its source link. HORI did not
// detect them; the screen says so (SANTUARIO H4, H19).

export type EventCat = "wildfires" | "severeStorms" | "volcanoes" | "seaLakeIce" | "floods" | "drought" | "dustHaze" | "landslides" | "snow" | "other";

export interface NaturalEvent {
  id: string;
  title: string;
  cat: EventCat;
  date: string; // ISO of the latest position
  lat: number;
  lon: number;
  source: string | null; // URL of the original report
  magnitude: string | null; // e.g. "65 kts"
}

const KNOWN: EventCat[] = ["wildfires", "severeStorms", "volcanoes", "seaLakeIce", "floods", "drought", "dustHaze", "landslides", "snow"];

/** Plural names for counts («24 incendios»). */
export const CAT_PLURAL: Record<EventCat, { es: string; en: string }> = {
  wildfires: { es: "incendios", en: "wildfires" }, severeStorms: { es: "tormentas", en: "storms" }, volcanoes: { es: "volcanes", en: "volcanoes" },
  seaLakeIce: { es: "hielos", en: "ice" }, floods: { es: "inundaciones", en: "floods" }, drought: { es: "sequías", en: "droughts" },
  dustHaze: { es: "polvo o humo", en: "dust or haze" }, landslides: { es: "deslaves", en: "landslides" }, snow: { es: "nevadas", en: "snow" },
  other: { es: "eventos", en: "events" },
};

export const CAT_LABEL: Record<EventCat, { es: string; en: string; icon: string }> = {
  wildfires: { es: "Incendio", en: "Wildfire", icon: "🔥" },
  severeStorms: { es: "Tormenta", en: "Storm", icon: "🌀" },
  volcanoes: { es: "Volcán", en: "Volcano", icon: "🌋" },
  seaLakeIce: { es: "Hielo", en: "Ice", icon: "🧊" },
  floods: { es: "Inundación", en: "Flood", icon: "🌊" },
  drought: { es: "Sequía", en: "Drought", icon: "🏜️" },
  dustHaze: { es: "Polvo o humo", en: "Dust or haze", icon: "🌫️" },
  landslides: { es: "Deslave", en: "Landslide", icon: "⛰️" },
  snow: { es: "Nieve", en: "Snow", icon: "❄️" },
  other: { es: "Evento", en: "Event", icon: "📍" },
};

type Geo = { date: string; type: string; coordinates: number[] | number[][][]; magnitudeValue?: number | null; magnitudeUnit?: string | null };
type RawEvent = { id: string; title: string; categories?: { id: string }[]; sources?: { url?: string }[]; geometry?: Geo[] };

function point(g: Geo): [number, number] | null {
  if (g.type === "Point") {
    const [lon, lat] = g.coordinates as number[];
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }
  // Polygon: the average of its ring is good enough to fly the camera there.
  const ring = (g.coordinates as number[][][])[0] ?? [];
  if (!ring.length) return null;
  const lat = ring.reduce((a, c) => a + c[1], 0) / ring.length;
  const lon = ring.reduce((a, c) => a + c[0], 0) / ring.length;
  return [lat, lon];
}

/** Pure: EONET JSON → events at their latest position, newest first. */
export function parseEonet(raw: { events?: RawEvent[] }): NaturalEvent[] {
  return (raw.events ?? []).flatMap((e) => {
    const geos = (e.geometry ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const g = geos.at(-1);
    const p = g ? point(g) : null;
    if (!g || !p) return [];
    const c = e.categories?.[0]?.id as EventCat | undefined;
    return [{
      id: e.id, title: e.title, cat: c && KNOWN.includes(c) ? c : "other", date: g.date, lat: p[0], lon: p[1],
      source: e.sources?.[0]?.url ?? null,
      magnitude: g.magnitudeValue != null ? `${g.magnitudeValue} ${g.magnitudeUnit ?? ""}`.trim() : null,
    }];
  }).sort((a, b) => b.date.localeCompare(a.date));
}

let cache: { at: number; p: Promise<NaturalEvent[]> } | null = null;

/** Open events of the last `days` days (refreshed at most every 10 minutes). */
export function fetchEvents(days = 30): Promise<NaturalEvent[]> {
  if (cache && Date.now() - cache.at < 600e3) return cache.p;
  const p = fetch(`https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=${days}`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`EONET ${r.status}`);
      return parseEonet(await r.json());
    });
  p.catch(() => { cache = null; });
  cache = { at: Date.now(), p };
  return p;
}

/** Great-circle distance in km (to sort events by how close they are to a place). */
export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
