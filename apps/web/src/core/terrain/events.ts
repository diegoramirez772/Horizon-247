// From a live anomaly to the zone that shows it in «Vista 3D real» with its generated effect (effects.ts):
// a small zone centred on it, sized by the phenomenon, and the effect's kind and strength read from the data.

import type { LiveDetection } from "@/core/map/weather";
import type { NaturalEvent, EventCat } from "@/core/live/eonet";
import type { Fireball } from "@/core/live/space";
import type { ZoneTarget } from "@/core/state/store";
import type { EffectKind, ZoneEvent } from "./effects";

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

function zone(name: string, lat: number, lon: number, ev: ZoneEvent): ZoneTarget {
  // the zone: the phenomenon and some ground around it (25–150 km half side), never a whole state
  const half = clamp(ev.radiusKm * 1.6, 25, 150), dLat = half / 110.6, dLon = half / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { name, lat, lon, box: [lon - dLon, lat - dLat, lon + dLon, lat + dLat], event: ev };
}

const STORM: Record<LiveDetection["kind"], { k: EffectKind; es: string; en: string }> = {
  tormenta: { k: "tormenta", es: "Tormenta detectada", en: "Storm detected" },
  lluvia_intensa: { k: "lluvia", es: "Lluvia intensa detectada", en: "Heavy rain detected" },
  nieve: { k: "nieve", es: "Nieve detectada", en: "Snow detected" },
};

/** A storm, heavy rain or snow found by the live detector (GOES/Himawari infrared + IMERG). */
export function zoneFromStorm(d: LiveDetection, lang: "es" | "en"): ZoneTarget {
  const s = STORM[d.kind];
  const radius = clamp(Math.sqrt(d.areaKm2 / Math.PI), 10, 90);
  const since = d.since ? d.since.slice(11, 16) + " UTC" : "";
  return zone(s[lang], d.lat, d.lon, {
    kind: s.k, intensity: clamp(0.3 + 0.7 * d.strength, 0.2, 1), radiusKm: radius,
    label: `${s[lang]}${since ? (lang === "es" ? ` desde las ${since}` : ` since ${since}`) : ""}`,
    source: d.kind === "tormenta" ? (lang === "es" ? "infrarrojo GOES/Himawari (topes de nube muy fríos)" : "GOES/Himawari infrared (very cold cloud tops)") : "IMERG (NASA GPM)",
  });
}

const EONET: Record<EventCat, { k: EffectKind; r: number; i: number }> = {
  wildfires: { k: "incendio", r: 12, i: 0.7 }, volcanoes: { k: "volcan", r: 10, i: 0.8 }, severeStorms: { k: "tormenta", r: 60, i: 0.8 },
  floods: { k: "inundacion", r: 30, i: 0.7 }, snow: { k: "nieve", r: 40, i: 0.6 }, seaLakeIce: { k: "nieve", r: 40, i: 0.5 },
  dustHaze: { k: "bruma", r: 60, i: 0.7 }, drought: { k: "sequia", r: 60, i: 0.7 }, landslides: { k: "anomalia", r: 8, i: 0.6 },
  other: { k: "anomalia", r: 20, i: 0.5 },
};

/** A NASA EONET open event (fire, volcano, storm, flood…): its kind gives the effect; a magnitude, when given, its strength. */
export function zoneFromEvent(e: NaturalEvent, lang: "es" | "en"): ZoneTarget {
  const m = EONET[e.cat] ?? EONET.other;
  const kts = e.magnitude?.match(/([\d.]+)\s*kts/i);
  const intensity = kts ? clamp(Number(kts[1]) / 120, 0.3, 1) : m.i;
  return zone(e.title, e.lat, e.lon, {
    kind: m.k, intensity, radiusKm: m.r,
    label: `${e.title} · ${e.date.slice(0, 10)}`,
    source: lang === "es" ? `NASA EONET${e.magnitude ? ` (${e.magnitude})` : ""}` : `NASA EONET${e.magnitude ? ` (${e.magnitude})` : ""}`,
  });
}

/** A fireball (bolide) of NASA/JPL CNEOS: where it burst, how high, how fast and how much energy. */
export function zoneFromFireball(f: Fireball, lang: "es" | "en"): ZoneTarget {
  const kt = f.energy_kt ?? 0.1;
  const es = lang === "es";
  const bits = [f.alt_km !== null ? `${Math.round(f.alt_km)} km ${es ? "de altura" : "high"}` : null, f.v_kms !== null ? `${f.v_kms} km/s` : null, f.energy_kt !== null ? `${f.energy_kt} kt` : null].filter(Boolean).join(" · ");
  return zone(es ? `Bólido del ${f.date.slice(0, 10)}` : `Fireball of ${f.date.slice(0, 10)}`, f.lat, f.lon, {
    kind: "bolido", intensity: clamp(0.3 + Math.log10(1 + kt * 10) / 2, 0.3, 1), radiusKm: 40,
    label: `${es ? "Bólido" : "Fireball"} ${f.date.slice(0, 16)} UTC${bits ? ` · ${bits}` : ""}`,
    source: "NASA/JPL CNEOS Fireball",
  });
}
