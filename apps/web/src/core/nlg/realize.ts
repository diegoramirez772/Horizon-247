// Natural language WITHOUT an LLM or a local model (Plan de unión total, D4). A small, deterministic generator in
// three steps, the classic NLG pipeline:
//   1. content: the facts HORI computed (verdict, effect, interval, MDE, years needed, window, planet average)
//   2. discourse plan: claim → size you can feel → comparison → how sure → what is missing
//   3. realisation: numbers turned into words people use («algo más de medio grado»), the accumulated change over
//      the years measured, a comparison with the planet, and the certainty ladder of the verdict.
// Same facts → same words, always (no randomness; the variation is a hash of the place). Every number comes from the
// bundle: if a fact is missing, its sentence is left out — nothing is guessed (SANTUARIO H4, H19).

import type { Lang } from "@/core/i18n/texts";

export type Quantity = "temp" | "rain" | "other";

export interface TrendFacts {
  place: string;
  /** Variable code from the manifest (T2M, PRECTOTCORR, CDOD610…). */
  variable: string;
  unit: string;
  verdict: number; // SPEC §3: 1 PROBADO · 2 CANDIDATA · 3 NO_CONCLUYENTE · 4 SIN_CAMBIO · 0 INSUFICIENTE
  effect: number; // per decade
  lo: number;
  hi: number;
  mde: number; // per decade
  delta: number; // smallest change that matters, per decade
  yearsMore: number;
  nYears: number;
  start: number;
  end: number;
  /** Area-weighted average effect of the planet in the same layer (null when the layer is regional). */
  planet: number | null;
}

export function quantityOf(variable: string): Quantity {
  const v = variable.toUpperCase();
  if (v.startsWith("T2M") || v === "TS" || v.includes("TEMP")) return "temp";
  if (v.startsWith("PREC") || v.includes("RAIN") || v.includes("IMERG")) return "rain";
  return "other";
}

const NOUN: Record<Quantity, Record<Lang, string>> = {
  temp: { es: "la temperatura", en: "temperature" },
  rain: { es: "la lluvia", en: "rainfall" },
  other: { es: "el valor medido", en: "the measured value" },
};

function fmt(x: number, lang: Lang, d = 2): string {
  return x.toLocaleString(lang === "es" ? "es-ES" : "en-US", { maximumFractionDigits: d, minimumFractionDigits: 0, useGrouping: false });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic choice: the same place always gets the same wording, different places get some variety. */
function pick<T>(seed: string, list: T[]): T {
  return list[hash(seed) % list.length];
}

const WHOLE_ES = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];
const WHOLE_EN = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * Degrees in words, to the nearest quarter, with an honest qualifier: 0.54 → «algo más de medio grado»,
 * 0.71 → «casi tres cuartos de grado», 1.5 → «grado y medio». Very small or very large values stay as numbers.
 */
export function degreesInWords(x: number, lang: Lang): string {
  const a = Math.abs(x);
  if (!Number.isFinite(a)) return "—";
  if (a < 0.1) return lang === "es" ? `apenas ${fmt(a, lang)} °C` : `barely ${fmt(a, lang)} °C`;
  if (a > 10.4) return `${fmt(a, lang, 1)} °C`;
  const q = Math.round(a * 4) / 4;
  // Below an eighth of a degree there is no fraction to name: say the number.
  if (q === 0) return lang === "es" ? `apenas ${fmt(a, lang)} °C` : `barely ${fmt(a, lang)} °C`;
  const diff = a - q;
  const qual = Math.abs(diff) < 0.035 ? "" : diff > 0 ? (lang === "es" ? "algo más de " : "a little over ") : (lang === "es" ? "casi " : "almost ");
  const whole = Math.floor(q);
  const frac = q - whole;
  let words: string;
  if (lang === "es") {
    if (whole === 0) words = frac === 0.25 ? "un cuarto de grado" : frac === 0.5 ? "medio grado" : "tres cuartos de grado";
    else if (whole === 1 && frac === 0.5) words = "grado y medio";
    else words = `${WHOLE_ES[whole]} ${whole === 1 ? "grado" : "grados"}${frac === 0.25 ? " y cuarto" : frac === 0.5 ? " y medio" : frac === 0.75 ? " y tres cuartos" : ""}`;
  } else {
    if (whole === 0) words = frac === 0.25 ? "a quarter of a degree" : frac === 0.5 ? "half a degree" : "three quarters of a degree";
    else words = `${WHOLE_EN[whole]}${frac === 0.25 ? " and a quarter" : frac === 0.5 ? " and a half" : frac === 0.75 ? " and three quarters" : ""} ${whole === 1 && frac === 0 ? "degree" : "degrees"}`;
  }
  return qual + words;
}

/** Two significant figures, for amounts people read at a glance (18.6 → 19, 0.0342 → 0.034). */
function round2(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const p = 10 ** (1 - Math.floor(Math.log10(Math.abs(x))));
  return Math.round(x * p) / p;
}

/** The size of a change per decade, in words people use. */
export function amount(perDecade: number, q: Quantity, unit: string, lang: Lang): string {
  if (q === "temp") return degreesInWords(perDecade, lang);
  if (q === "rain") {
    // POWER gives mm/day: a year of it is easier to picture.
    const mmYear = round2(Math.abs(perDecade) * 365.25);
    return lang === "es" ? `unos ${fmt(mmYear, lang)} mm de lluvia al año` : `about ${fmt(mmYear, lang)} mm of rain a year`;
  }
  return `${fmt(round2(Math.abs(perDecade)), lang, 4)} ${unit}`;
}

/** A threshold as a plain number with its unit (no «casi», no «algo más»: it is a limit, not a measurement). */
export function threshold(perDecade: number, q: Quantity, unit: string, lang: Lang): string {
  if (q === "rain") return lang === "es" ? `${fmt(round2(Math.abs(perDecade) * 365.25), lang)} mm al año` : `${fmt(round2(Math.abs(perDecade) * 365.25), lang)} mm a year`;
  return `${fmt(round2(Math.abs(perDecade)), lang, 3)} ${unit}`;
}

/** How the place compares with the planet average in the same layer (only when the difference is worth saying). */
export function comparison(effect: number, planet: number | null, lang: Lang): string | null {
  if (planet === null || !Number.isFinite(planet) || !Number.isFinite(effect) || Math.abs(planet) < 1e-6) return null;
  if (Math.sign(effect) !== Math.sign(planet)) {
    return lang === "es" ? "Va al revés que el promedio del planeta." : "It goes the opposite way to the planet average.";
  }
  const r = Math.abs(effect) / Math.abs(planet);
  const es = (w: string) => `Es ${w} que el promedio del planeta.`;
  const en = (w: string) => `That is ${w} than the planet average.`;
  if (r >= 2.3) return lang === "es" ? es(`${fmt(Math.round(r * 10) / 10, lang, 1)} veces más rápido`) : en(`${fmt(Math.round(r * 10) / 10, lang, 1)} times faster`);
  if (r >= 1.8) return lang === "es" ? es("unas dos veces más rápido") : "That is about twice as fast as the planet average.";
  if (r >= 1.35) return lang === "es" ? es("bastante más rápido") : en("quite a bit faster");
  if (r >= 1.12) return lang === "es" ? es("algo más rápido") : en("a little faster");
  if (r > 0.88) return lang === "es" ? "Va al mismo ritmo que el promedio del planeta." : "It moves at the same pace as the planet average.";
  if (r > 0.6) return lang === "es" ? es("algo más lento") : en("a little slower");
  return lang === "es" ? es("mucho más lento") : en("much slower");
}

function cap(s: string): string {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/**
 * The answer about one place, in plain words. `detail` adds the likely range and the method (Normal level);
 * without it the text is for anybody (Simple level). The Experto level keeps the contract's own wording.
 */
export function narrateTrend(f: TrendFacts, lang: Lang, detail: boolean): string {
  const q = quantityOf(f.variable);
  const noun = NOUN[q][lang];
  const seed = `${f.place}|${f.variable}`;
  const up = f.effect > 0;
  const out: string[] = [];
  const years = f.end - f.start + 1;

  if (f.verdict === 1) {
    const verb = q === "temp"
      ? (lang === "es" ? (up ? pick(seed, ["sube", "se está calentando", "va en aumento"]) : pick(seed, ["baja", "se está enfriando"])) : (up ? "is rising" : "is falling"))
      : (lang === "es" ? (up ? "aumenta" : "disminuye") : (up ? "is increasing" : "is decreasing"));
    const size = amount(f.effect, q, f.unit, lang);
    out.push(lang === "es"
      ? `${pick(seed, ["En", "Para"])} ${f.place}, ${noun} ${verb}: ${size} cada diez años.`
      : `In ${f.place}, ${noun} ${verb}: ${size} every ten years.`);
    // The size you can feel: what that rate adds up to over the years actually measured (the past, not a forecast).
    if (years >= 10) {
      const total = amount((f.effect * years) / 10, q, f.unit, lang);
      if (q === "rain") {
        out.push(lang === "es"
          ? `Hoy llueve ${total.replace(/ de lluvia al año$/, "")} ${up ? "más" : "menos"} al año que en ${f.start}.`
          : `It now rains ${total.replace(/ of rain a year$/, "")} ${up ? "more" : "less"} a year than in ${f.start}.`);
      } else {
        out.push(lang === "es"
          ? `En los ${years} años medidos (${f.start}–${f.end}) eso suma ${total}.`
          : `Over the ${years} years measured (${f.start}–${f.end}) that adds up to ${total}.`);
      }
    }
    const cmp = comparison(f.effect, f.planet, lang);
    if (cmp) out.push(cmp);
    if (detail && Number.isFinite(f.lo) && Number.isFinite(f.hi)) {
      out.push(lang === "es"
        ? `Lo más probable es que esté entre ${fmt(f.lo, lang)} y ${fmt(f.hi, lang)} ${f.unit} por década; coinciden tres métodos distintos.`
        : `Most likely between ${fmt(f.lo, lang)} and ${fmt(f.hi, lang)} ${f.unit} per decade; three different tests agree.`);
    } else {
      out.push(lang === "es" ? pick(seed + "c", ["Es muy poco probable que sea casualidad.", "No parece casualidad: el cambio es claro."]) : "It is very unlikely to be chance.");
    }
  } else if (f.verdict === 2) {
    out.push(lang === "es"
      ? `En ${f.place} hay indicios de que ${noun} ${up ? "sube" : "baja"}, pero todavía no alcanza para afirmarlo.`
      : `In ${f.place} there are hints that ${noun} is ${up ? "rising" : "falling"}, but not enough to say so yet.`);
    if (detail) out.push(lang === "es" ? "Los métodos no coinciden entre sí, o el resultado depende de cómo se calcule." : "The tests do not agree, or the result depends on how it is computed.");
  } else if (f.verdict === 3) {
    out.push(lang === "es"
      ? `Todavía no se puede saber si ${noun} está cambiando en ${f.place}.`
      : `It cannot be known yet whether ${noun} is changing in ${f.place}.`);
    if (Number.isFinite(f.mde)) {
      out.push(lang === "es"
        ? `Con ${f.nYears} años de datos solo se notaría un cambio de ${threshold(f.mde, q, f.unit, lang)} o más cada diez años.`
        : `With ${f.nYears} years of data only a change of ${threshold(f.mde, q, f.unit, lang)} or more per ten years would show.`);
    }
    if (Number.isFinite(f.yearsMore) && f.yearsMore > 0) {
      out.push(lang === "es"
        ? `Harían falta unos ${Math.round(f.yearsMore)} años más de mediciones.`
        : `About ${Math.round(f.yearsMore)} more years of measurements would be needed.`);
    }
    out.push(lang === "es" ? "Eso no significa que no cambie: significa que aún no se sabe." : "That does not mean it is not changing: it means it is not known yet.");
  } else if (f.verdict === 4) {
    out.push(lang === "es"
      ? `En ${f.place}, ${noun} no cambió mucho entre ${f.start} y ${f.end}.`
      : `In ${f.place}, ${noun} did not change much between ${f.start} and ${f.end}.`);
    if (Number.isFinite(f.delta)) {
      out.push(lang === "es"
        ? `Si cambiara ${threshold(f.delta, q, f.unit, lang)} o más cada diez años, muy probablemente ya lo habríamos visto.`
        : `If it changed by ${threshold(f.delta, q, f.unit, lang)} or more every ten years, we would very probably have seen it.`);
    }
  } else {
    out.push(lang === "es" ? `En ${f.place} no hay datos suficientes para decir nada.` : `There is not enough data in ${f.place} to say anything.`);
  }
  return cap(out.join(" "));
}

/** Area-weighted (cos latitude) average effect of the valid cells of a grid layer. */
export function planetAverage(effect: ArrayLike<number>, verdict: ArrayLike<number>, lat0: number, dlat: number, nlat: number, nlon: number): number | null {
  let s = 0;
  let w = 0;
  for (let r = 0; r < nlat; r++) {
    const c = Math.cos(((lat0 + r * dlat) * Math.PI) / 180);
    for (let k = 0; k < nlon; k++) {
      const i = r * nlon + k;
      const e = effect[i];
      if (verdict[i] === 0 || !Number.isFinite(e)) continue;
      s += c * e;
      w += c;
    }
  }
  return w > 0 ? s / w : null;
}
