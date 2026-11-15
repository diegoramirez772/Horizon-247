// Real data → scene (Plan de unión: «escena 3D con datos reales y línea de tiempo»). Pure and deterministic.
//   · a day of NASA POWER at the place → temperature, humidity, rain, wind of that day (kind «observacion»);
//   · a year of HORI's series → that year's temperature = recent POWER mean + (anomaly of the year − anomaly of the
//     last year) (kind «estimacion»): the scene warms or cools with the measured trend, nothing else is invented.
// Readings POWER does not give (vegetation, clouds, fire…) keep the preset's example values and say so.

import type { PowerDay } from "@/core/live/power";
import { preset } from "./presets";
import type { Reading, SceneSpec } from "./spec";

export interface Place { name: string; lat: number; lon: number }

const power = (value: number, unit: string, date: string): Reading => ({ value, unit, source: "NASA POWER", date, kind: "observacion" });
const r1 = (x: number) => Math.round(x * 10) / 10;

/** The base scene for a place: the ranch preset, renamed, with its example readings (replaced below when data exist). */
export function baseFor(p: Place): SceneSpec {
  const s = preset("rancho");
  return { ...s, title: `Escena · ${p.name}`, place: `${p.name} (${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°)`, seed: Math.round((p.lat + 90) * 1000 + (p.lon + 180)) };
}

/** One POWER day at the place. Rain mm/day → mm/h as the day's average rate. */
export function specForDay(p: Place, d: PowerDay): SceneSpec {
  const s = baseFor(p);
  const vars = { ...s.vars };
  if (d.t2m !== null) vars.temp_c = power(r1(d.t2m), "°C", d.date);
  if (d.rh !== null) vars.rh_pct = power(Math.round(d.rh), "%", d.date);
  if (d.rain !== null) vars.precip_mm_h = power(Math.round((d.rain / 24) * 100) / 100, "mm/h", d.date);
  if (d.wind !== null) vars.wind_ms = power(r1(d.wind), "m/s", d.date);
  return { ...s, vars, note: `Datos de NASA POWER del ${d.date}; lo demás son valores de ejemplo.` };
}

/** Year `y` of HORI's anomaly series, anchored on the recent POWER mean temperature at the place. */
export function specForYear(p: Place, days: PowerDay[], series: number[], y0: number, y: number): SceneSpec {
  const last = lastDay(days);
  const s = last ? specForDay(p, last) : baseFor(p);
  const temps = days.map((d) => d.t2m).filter((x): x is number => x !== null);
  const base = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : s.vars.temp_c?.value ?? 20;
  const lastA = lastFinite(series);
  const a = series[y - y0];
  if (lastA === null || a === undefined || !Number.isFinite(a)) return s;
  const vars = { ...s.vars, temp_c: { value: r1(base + (a - lastA)), unit: "°C", source: "HORI · serie anual (anomalía) + media reciente de POWER", date: String(y), kind: "estimacion" as const } };
  return { ...s, vars, title: `${s.title} · ${y}`, note: `Temperatura de ${y} según la serie de HORI; lo demás, del último día de POWER o de ejemplo.` };
}

export function lastDay(days: PowerDay[]): PowerDay | null {
  for (let i = days.length - 1; i >= 0; i--) if (days[i].t2m !== null) return days[i];
  return null;
}

function lastFinite(xs: number[]): number | null {
  for (let i = xs.length - 1; i >= 0; i--) if (Number.isFinite(xs[i])) return xs[i];
  return null;
}
