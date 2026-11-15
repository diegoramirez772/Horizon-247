// The «person» profile in the web (contract profile "person", like ZON's simulated astronaut): a body signal sampled at a
// regular cadence, watched with HORI's anomaly detector with a period of ONE DAY (so night and day are compared with
// themselves). Two sources: a simulated week (labelled as such, with the events we injected on purpose) or the person's own
// file, read in the browser and never uploaded. A deviation is statistical: it does not say what happens to the person.

export interface PersonSeries {
  name: { es: string; en: string };
  unit: string;
  times: string[];
  values: number[];
  /** Samples per day (period of the detector). */
  period: number;
  /** Physical range for «fuera de rango» (impossible readings). */
  validRange: [number | null, number | null];
  simulated: boolean;
  /** Only for the simulation: what was injected and where (index), to check the detector against known truth. */
  truth?: { start: number; end: number; what: { es: string; en: string } }[];
}

/** Small deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ten days of resting heart rate every 10 minutes (144 per day): a day/night cycle, noise, a planned daily walk, and
 * three injected events — one high hour on day 8, a sustained +9 lpm from day 9 on, and 40 minutes with no data.
 */
export function simulatePerson(seed = 7, days = 10): PersonSeries {
  const r = rng(seed), P = 144, T = days * P;
  const t0 = Date.UTC(2026, 10, 1);
  const times: string[] = [], values: number[] = [];
  for (let i = 0; i < T; i++) {
    const h = (i % P) / 6;
    const gauss = (r() + r() + r() - 1.5) * 2;
    let x = 62 + 7 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gauss;
    if (h >= 18 && h < 19) x += 18; // the planned walk, every day: part of the cycle, not an anomaly
    if (i >= 7 * P + 84 && i < 7 * P + 90) x += 22; // day 8, 14:00–15:00
    if (i >= 8 * P + 60) x += 9; // from day 9, 10:00 on
    values.push(i >= 9 * P + 30 && i < 9 * P + 34 ? NaN : Math.round(x * 10) / 10);
    times.push(new Date(t0 + i * 600e3).toISOString().slice(0, 16).replace("T", " "));
  }
  return {
    name: { es: "Ritmo cardíaco en reposo", en: "Resting heart rate" }, unit: "lpm", times, values, period: P, validRange: [25, 230], simulated: true,
    truth: [
      { start: 7 * P + 84, end: 7 * P + 89, what: { es: "una hora alta (día 8, 14:00)", en: "one high hour (day 8, 14:00)" } },
      { start: 8 * P + 60, end: T - 1, what: { es: "+9 lpm sostenido desde el día 9, 10:00", en: "+9 bpm sustained from day 9, 10:00" } },
      { start: 9 * P + 30, end: 9 * P + 33, what: { es: "40 minutos sin datos (día 10)", en: "40 minutes without data (day 10)" } },
    ],
  };
}

/**
 * The person's own file: CSV or TSV with a time column and a value column (header optional), e.g. an export of a watch.
 * The cadence is the median step between rows; the period is the number of samples per day (at least 2).
 */
export function parsePersonCsv(text: string, unit = ""): PersonSeries | { error: string } {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, "")));
  const parsed: { t: number; label: string; v: number }[] = [];
  for (const row of rows) {
    if (row.length < 2) continue;
    const t = Date.parse(row[0].includes("T") || row[0].includes(" ") ? row[0].replace(" ", "T") : row[0]);
    const v = Number(row[row.length - 1].replace(",", "."));
    if (Number.isFinite(t) && Number.isFinite(v)) parsed.push({ t, label: row[0], v });
  }
  if (parsed.length < 50) return { error: "few" };
  parsed.sort((a, b) => a.t - b.t);
  const steps = parsed.slice(1).map((p, k) => p.t - parsed[k].t).filter((d) => d > 0).sort((a, b) => a - b);
  const step = steps[steps.length >> 1];
  if (!(step > 0)) return { error: "cadence" };
  // regular grid: one slot per step, missing slots stay missing
  const times: string[] = [], values: number[] = [];
  const t0 = parsed[0].t, n = Math.min(20000, Math.round((parsed[parsed.length - 1].t - t0) / step) + 1);
  const slots = new Array<number>(n).fill(NaN);
  for (const p of parsed) { const k = Math.round((p.t - t0) / step); if (k >= 0 && k < n) slots[k] = p.v; }
  for (let k = 0; k < n; k++) { times.push(new Date(t0 + k * step).toISOString().slice(0, 16).replace("T", " ")); values.push(slots[k]); }
  const period = Math.max(2, Math.round(864e5 / step));
  return { name: { es: "Tu señal", en: "Your signal" }, unit, times, values, period, validRange: [null, null], simulated: false };
}
