// Latest conditions at a point, straight from NASA POWER (no account, CORS open). POWER daily data arrive with a
// delay of a few days: every value carries its own date, and the screen says "último dato", never "ahora".
// Livestock heat stress (THI) is computed here from POWER's maximum temperature and humidity: a published formula
// (NRC 1971), not a prediction about any animal (SANTUARIO H12, H17).

import { lastGood } from "./lastgood";

export interface PowerDay {
  date: string; // YYYY-MM-DD
  t2m: number | null; // °C, daily mean
  tmax: number | null; // °C
  rh: number | null; // %
  rain: number | null; // mm/day
  wind: number | null; // m/s at 2 m
}

export interface PowerPoint {
  lat: number;
  lon: number;
  days: PowerDay[]; // oldest first, only days with data
  url: string; // what was asked, for provenance
}

const PARAMS = ["T2M", "T2M_MAX", "RH2M", "PRECTOTCORR", "WS2M"] as const;
const FILL = -999;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

export function powerUrl(lat: number, lon: number, days = 21, now = Date.now()): string {
  const end = new Date(now);
  const start = new Date(now - days * 864e5);
  const q = new URLSearchParams({
    parameters: PARAMS.join(","), community: "AG", latitude: lat.toFixed(3), longitude: lon.toFixed(3),
    start: ymd(start), end: ymd(end), format: "JSON",
  });
  return `https://power.larc.nasa.gov/api/temporal/daily/point?${q}`;
}

type Raw = { properties?: { parameter?: Record<string, Record<string, number>> } };

/** Pure: POWER JSON → days with at least one real value (POWER fills the days it does not have yet with -999). */
export function parsePower(raw: Raw): PowerDay[] {
  const p = raw.properties?.parameter ?? {};
  const v = (k: string, d: string): number | null => {
    const x = p[k]?.[d];
    return typeof x === "number" && x !== FILL && Number.isFinite(x) ? x : null;
  };
  return Object.keys(p.T2M ?? {}).sort().map((d) => ({
    date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
    t2m: v("T2M", d), tmax: v("T2M_MAX", d), rh: v("RH2M", d), rain: v("PRECTOTCORR", d), wind: v("WS2M", d),
  })).filter((x) => x.t2m !== null || x.tmax !== null || x.rain !== null);
}

const memo = new Map<string, Promise<PowerPoint>>();

export function fetchPowerPoint(lat: number, lon: number, days = 21): Promise<PowerPoint> {
  const url = powerUrl(lat, lon, days, Math.floor(Date.now() / 36e5) * 36e5); // one request per hour and place
  let p = memo.get(url);
  if (!p) {
    // keyed by place (not by hour), so the last good reading of this place is shown when the network fails
    p = lastGood(url, { source: "Clima (NASA POWER)", key: `power:${lat.toFixed(2)},${lon.toFixed(2)}:${days}`, parse: (d) => parsePower(d as Parameters<typeof parsePower>[0]) })
      .then((g) => ({ lat, lon, days: g.data, url }));
    p.catch(() => memo.delete(url));
    memo.set(url, p);
  }
  return p;
}

// ---------------------------------------------------------------- livestock heat stress

export type ThiLevel = "normal" | "alerta" | "alto" | "muy_alto";

/** Temperature-Humidity Index (NRC 1971): THI = 0.8·T + RH/100·(T − 14.4) + 46.4, with T in °C. */
export function thi(tC: number, rh: number): number {
  return 0.8 * tC + (rh / 100) * (tC - 14.4) + 46.4;
}

/** LCI thresholds for cattle (Livestock Weather Safety Index): <75 normal, 75–78 alert, 79–83 danger, ≥84 emergency (shown as alto / muy alto). */
export function thiLevel(x: number): ThiLevel {
  return x >= 84 ? "muy_alto" : x >= 79 ? "alto" : x >= 75 ? "alerta" : "normal";
}

export interface ThiDay { date: string; thi: number; level: ThiLevel }

/** THI of the hottest part of each day (maximum temperature with the day's mean humidity). */
export function thiDays(days: PowerDay[]): ThiDay[] {
  return days.flatMap((d) => {
    if (d.tmax === null || d.rh === null) return [];
    const x = thi(d.tmax, d.rh);
    return [{ date: d.date, thi: x, level: thiLevel(x) }];
  });
}
