// Fills verdict templates from a cell (or region) and its manifest. Every number comes from the bundle.

import type { CellFinding, Manifest } from "@/contract/types";
import { isOver60 } from "@/core/contract/loader";
import { OVER_60, type Lang, type Register, type TemplateValues } from "@/core/i18n/texts";

const LOCALE: Record<Lang, string> = { es: "es-MX", en: "en-US" };

export function num(x: number, lang: Lang, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(x: number, lang: Lang, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  return (x > 0 ? "+" : x < 0 ? "−" : "") + num(Math.abs(x), lang, digits);
}

/** Integer with thousands separator (counts). */
export function count(x: number, lang: Lang): string {
  return num(x, lang, 0);
}

/**
 * δ in physical units per decade = delta_sigma_per_decade × σ of the cell (PREGUNTAS #4, pending Diego:
 * `delta.f32` in the bundle would replace this conversion).
 */
export function deltaValue(m: Manifest, c: CellFinding): number {
  return m.params.delta_sigma_per_decade * c.sigma;
}

/**
 * Plain register rounds to 1 decimal; expert to 2 (web-diseno §4.3) — but never so far that a non-zero
 * value prints as 0.0, which would read as "nothing".
 */
export function digitsFor(reg: Register, x?: number): number {
  const base = reg === "sencillo" ? 1 : 2;
  if (x === undefined || !Number.isFinite(x) || x === 0) return base;
  const needed = Math.ceil(-Math.log10(Math.abs(x)) + 0.0001);
  return Math.min(4, Math.max(base, needed));
}

export function templateValues(
  m: Manifest, c: CellFinding, nvalid: number | null, lang: Lang, reg: Register, N: number,
): TemplateValues {
  const unit = m.variable.unit;
  const withUnit = (x: number) => (Number.isFinite(x) ? `${num(x, lang, digitsFor(reg, x))} ${unit}` : "—");
  const d = digitsFor(reg, c.effect);
  const years = c.yearsMore === null ? "—" : isOver60(c.yearsMore) ? OVER_60[lang] : String(Math.round(c.yearsMore));
  // {n}: window years; for INSUFICIENTE the contract says "{n} valid years" → nvalid.u8 (PREGUNTAS #8).
  const n = c.verdict === 0 ? (nvalid === null ? "—" : String(nvalid)) : String(m.window.n);
  // Plain register: no sign, "sube/baja" carries the direction (PREGUNTAS #13).
  const variable = shortLabel(m, lang);
  return {
    effect: reg === "sencillo" ? num(Math.abs(c.effect), lang, d) : signed(c.effect, lang, d),
    unit,
    lo: signed(c.ci[0], lang, d),
    hi: signed(c.ci[1], lang, d),
    N: count(N, lang),
    k: String(c.nSig),
    n,
    mde: withUnit(c.mde),
    delta: withUnit(deltaValue(m, c)),
    years,
    variable,
    rising: c.effect > 0,
  };
}

/**
 * Short variable name with article for the plain sentence ("la temperatura"). The contract has no field yet
 * (D8 asks for `variable.short_label`); until then the manifest title is used as is.
 */
export function shortLabel(m: Manifest, lang: Lang): string {
  const v = m.variable as Manifest["variable"] & { short_label?: { es?: string; en?: string } };
  return v.short_label?.[lang] ?? m.title[lang];
}

/** Sentence case for the start of a sentence built from a template. */
export function capitalise(s: string): string {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/**
 * Line through the series with the BUNDLE's slope (effect is per decade → /10 per year).
 * Only the intercept is placed here: median of (y − b·x), the usual companion of Sen's slope.
 * It is drawing aid, not a result: no verdict or number shown to the reader comes from it.
 */
export function trendLine(series: number[], years: number[], effectPerDecade: number): [number, number][] | null {
  if (!Number.isFinite(effectPerDecade) || years.length < 2) return null;
  const b = effectPerDecade / 10;
  const r = series.map((y, i) => y - b * years[i]).filter(Number.isFinite).sort((p, q) => p - q);
  if (r.length < 2) return null;
  const mid = Math.floor(r.length / 2);
  const a = r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2;
  const x0 = years[0], x1 = years[years.length - 1];
  return [[x0, a + b * x0], [x1, a + b * x1]];
}
