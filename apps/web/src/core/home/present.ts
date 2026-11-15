// Pure presentation of home.json (SPEC §15) for the three reading levels (design doc «Modos de profundidad… v2» §2, §5).
// presentMonitor() is a function of (monitor, level, language) only: changing the level re-reads, never recomputes or fetches.
// Every number comes from HORI through home.json; the sentences are the contract's templates (SPEC §5, §8.5, §8.5b).

import type { HomeDoc, HomeEntity, HomeEvent, HomeMonitor, StateItem, Verdict } from "@/contract/types";
import { capitalise, digitsFor, num, prettyUnit, signed } from "@/core/format/format";
import { limitsFor, shownLimits, type Limit } from "@/core/honesty/limits";
import { LEGEND, OVER_60, verdictText, type Lang, type Register, type TemplateValues } from "@/core/i18n/texts";

const L = (es: string, en: string): Record<Lang, string> => ({ es, en });
const MONTHS: Record<Lang, string[]> = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** "2026-09" → "sep 2026" / "Sep 2026". Anything else passes through. */
export function monthLabel(ym: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  return m ? `${MONTHS[lang][Number(m[2]) - 1]} ${m[1]}` : ym;
}

/** "2026-11-15T03:10:00Z" → "15 nov 2026". */
export function dayLabel(iso: string | null, lang: Lang): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${Number(m[3])} ${MONTHS[lang][Number(m[2]) - 1]} ${m[1]}` : "—";
}

function values(mon: HomeMonitor, reg: Register, lang: Lang): TemplateValues {
  const f = mon.finding;
  const unit = prettyUnit(mon.variable.unit, lang);
  const eff = f.effect ?? NaN;
  const d = digitsFor(reg, eff);
  const withUnit = (x: number | null) => (x !== null && Number.isFinite(x) ? `${num(x, lang, digitsFor(reg, x))} ${unit}` : "—");
  return {
    effect: reg === "tecnico" ? signed(eff, lang, d) : num(Math.abs(eff), lang, d),
    unit,
    lo: signed(f.ci[0] ?? NaN, lang, d),
    hi: signed(f.ci[1] ?? NaN, lang, d),
    N: "1", // a place is a family of one regional series (SPEC §15): the «N zonas» sentence is dropped
    k: String(f.n_sig),
    n: String(f.n),
    mde: withUnit(f.mde),
    delta: withUnit(f.delta),
    years: f.years_more === null ? "—" : f.years_more >= 255 ? OVER_60[lang] : String(Math.round(f.years_more)),
    variable: mon.variable.label[lang],
    rising: eff > 0,
  };
}

export interface MonitorView {
  verdict: Verdict;
  phrase: string;
  sentence: string;
  /** The number that matters, already formatted for the level (null when the verdict has no magnitude to state). */
  figure: string | null;
  /** «Desde cuándo se sabe» (doc v2 §2.2), when the time machine has it. */
  since: string | null;
  limits: Limit[];
  /** Data date and computed date are different things (doc v2 rule 7). */
  dataLine: string;
  /** Normal/Experto: what this monitor can and cannot do yet (capabilities, doc v2 §4.1). */
  capability: string | null;
  /** Experto: the diagnostic table. */
  expert: [string, string][] | null;
}

export function allLimits(mon: HomeMonitor): Limit[] {
  const f = mon.finding;
  return limitsFor({
    flags: f.flags, verdict: f.verdict, simulated: !mon.data.data_real, resolutionDeg: mon.data.resolution_deg,
    nCells: mon.data.n_cells, datasetName: mon.data.source, breakYear: f.break_year,
  });
}

export function presentMonitor(mon: HomeMonitor, reg: Register, lang: Lang, sources = 1): MonitorView {
  const f = mon.finding;
  const unit = prettyUnit(mon.variable.unit, lang);
  const per = lang === "es" ? "por década" : "per decade";
  const tv = values(mon, reg, lang);
  const sentence = capitalise(verdictText(f.verdict, reg, lang, tv));
  let figure: string | null = null;
  if (f.effect !== null && (f.verdict === 1 || reg !== "sencillo")) {
    figure = reg === "sencillo"
      ? `${lang === "es" ? (f.effect > 0 ? "Sube" : "Baja") : (f.effect > 0 ? "Rising" : "Falling")} ${num(Math.abs(f.effect), lang, digitsFor(reg, f.effect))} ${unit} ${lang === "es" ? "cada 10 años" : "every 10 years"}`
      : `${signed(f.effect, lang, digitsFor(reg, f.effect))} ${unit} ${per} (${tv.lo} … ${tv.hi})`;
  }
  const tl = mon.timeline;
  let since: string | null = null;
  if (tl?.emergence_year && f.verdict === 1) {
    since = lang === "es" ? `Se puede afirmar desde ${tl.emergence_year}.` : `It can be stated since ${tl.emergence_year}.`;
    if (reg === "tecnico") {
      since += lang === "es"
        ? ` Primer PROBADO ${tl.first_probado ?? "—"}; retiros ${tl.withdrawals}; la última ventana ${tl.consistent ? "reproduce" : "NO reproduce"} el veredicto completo.`
        : ` First PROBADO ${tl.first_probado ?? "—"}; withdrawals ${tl.withdrawals}; the last window ${tl.consistent ? "reproduces" : "does NOT reproduce"} the full verdict.`;
    }
  }
  const src = mon.data.source;
  const dataLine = reg === "sencillo"
    ? (lang === "es" ? `Datos de la NASA hasta ${monthLabel(mon.data.last_month, lang)}` : `NASA data up to ${monthLabel(mon.data.last_month, lang)}`)
    : `${src}${mon.data.version ? ` ${mon.data.version}` : ""} · ${lang === "es" ? "datos hasta" : "data up to"} ${monthLabel(mon.data.last_month, lang)} · ${lang === "es" ? "calculado el" : "computed on"} ${dayLabel(mon.data.computed_at, lang)}`;
  const capability = reg === "sencillo" ? null : sources > 1
    ? (lang === "es" ? `Lo confirman ${sources} fuentes de la NASA.` : `${sources} NASA sources confirm it.`)
    : (lang === "es" ? "Una sola fuente: falta una segunda (GISTEMP o IMERG) para confirmarlo." : "One source only: a second one (GISTEMP or IMERG) is still needed to confirm it.");
  const n = (x: number | null, d = 3) => (x === null ? "—" : num(x, lang, d));
  const expert: [string, string][] | null = reg !== "tecnico" ? null : [
    ["β (Sen)", `${signed(f.effect ?? NaN, lang, 3)} ${mon.variable.unit_per_decade}`],
    ["IC 95 %", `${signed(f.ci[0] ?? NaN, lang, 3)} … ${signed(f.ci[1] ?? NaN, lang, 3)}`],
    ["p · q", `${n(f.p, 4)} · ${n(f.q, 4)} (${mon.method.family})`],
    [lang === "es" ? "Métodos" : "Methods", `${f.n_sig}/3 · ${mon.method.methods.join(", ")}`],
    ["e · e-BH", `${f.e_value !== null && f.e_value >= 1e4 ? f.e_value.toExponential(1) : n(f.e_value, 2)} · ${f.ebh === null ? "—" : f.ebh ? (lang === "es" ? "sí" : "yes") : "no"}`],
    ["MDE · δ", `${n(f.mde)} · ${n(f.delta)} (${f.delta_source ?? "—"})`],
    ["σ · r̂₁ · n", `${n(f.sigma)} · ${n(f.r1, 2)} · ${f.n}`],
    [lang === "es" ? "Ventana" : "Window", `${f.window.start}–${f.window.end}`],
    [lang === "es" ? "Celdas" : "Cells", `${mon.data.n_cells} × ${mon.data.resolution_deg}° (~${mon.data.cell_km} km)`],
    ["sha256", (mon.data.input_sha256 ?? "—").slice(0, 16)],
  ];
  return {
    verdict: f.verdict, phrase: LEGEND[lang][f.verdict].phrase, sentence, figure, since,
    limits: shownLimits(allLimits(mon), reg), dataLine, capability, expert,
  };
}

/** Name used in lists: «Durango · la temperatura» → «Temperatura en Durango». */
export function monitorName(ent: HomeEntity, mon: HomeMonitor, lang: Lang): string {
  const v = mon.variable.label[lang].replace(/^(la|el|los|las) /, "");
  return lang === "es" ? `${capitalise(v)} en ${ent.entity.name.es}` : `${capitalise(v)} in ${ent.entity.name.en}`;
}

/** One line per event, in words, for the «qué cambió» and «calidad» trays. */
export function eventText(ev: HomeEvent, doc: HomeDoc, lang: Lang): string {
  const ent = doc.entities.find((e) => e.monitors.some((m) => m.id === ev.monitor));
  const mon = ent?.monitors.find((m) => m.id === ev.monitor);
  const who = ent && mon ? monitorName(ent, mon, lang) : ev.monitor;
  const z = (ev.peak_z ?? ev.mean_z) as number | undefined;
  const when = (x: unknown) => monthLabel(String(x ?? ""), lang);
  switch (ev.type) {
    case "EMERGENCIA": return lang === "es" ? `${who}: desde ${ev.year} ya se puede afirmar el cambio.` : `${who}: since ${ev.year} the change can be stated.`;
    case "CRUZO": return lang === "es" ? `${who}: con el último año el cambio pasó a ser real.` : `${who}: with the last year the change became real.`;
    case "SE_DEBILITO": return lang === "es" ? `${who}: con el último año el cambio dejó de estar probado.` : `${who}: with the last year the change is no longer proven.`;
    case "CAMBIO_SIGNO": return lang === "es" ? `${who}: la señal cambió de sentido con el último año.` : `${who}: the signal changed direction with the last year.`;
    case "NUEVO": return lang === "es" ? `${who}: ya hay datos suficientes para analizarlo.` : `${who}: there are now enough data to analyse it.`;
    case "CAMBIO_DE_VERSION": return lang === "es" ? `${who}: la fuente cambió de versión.` : `${who}: the source changed version.`;
    case "ANOMALIA_SIN_DATOS": return lang === "es" ? `${who}: faltan datos desde ${when(ev.t_start)}.` : `${who}: data missing since ${when(ev.t_start)}.`;
    case "ANOMALIA_CONGELADO": return lang === "es" ? `${who}: el dato no cambia desde ${when(ev.t_start)}; puede ser el sensor.` : `${who}: the value has not changed since ${when(ev.t_start)}; it may be the sensor.`;
    case "ANOMALIA_FUERA_DE_RANGO": return lang === "es" ? `${who}: valores imposibles en ${when(ev.t_start)}.` : `${who}: impossible values in ${when(ev.t_start)}.`;
  }
  if (ev.type.startsWith("ANOMALIA_")) {
    const span = ev.t_start === ev.t_end ? when(ev.t_start) : `${when(ev.t_start)}–${when(ev.t_end)}`;
    const zz = typeof z === "number" && Number.isFinite(z) ? ` (${signed(z, lang, 1)}σ)` : "";
    return lang === "es"
      ? `${who}: ${span} estuvo fuera de lo esperable${zz}. Es solo una desviación estadística.`
      : `${who}: ${span} was outside the expected range${zz}. It is only a statistical deviation.`;
  }
  return `${who}: ${ev.type}`;
}

/** «Lo que aún no se sabe» (diferenciador D2): from the findings, in both languages, never hidden. */
export function unknowns(doc: HomeDoc, lang: Lang): string[] {
  const out: string[] = [];
  for (const ent of doc.entities) for (const mon of ent.monitors) {
    const f = mon.finding;
    const who = monitorName(ent, mon, lang);
    if (f.verdict === 3) {
      const y = f.years_more === null ? null : f.years_more >= 255 ? OVER_60[lang] : String(Math.round(f.years_more));
      const one = y === "1";
      out.push(lang === "es" ? `${who}: aún no se puede saber${y ? `; faltan ~${y} ${one ? "año" : "años"} de datos` : ""}.` : `${who}: not yet knowable${y ? `; about ${y} more ${one ? "year" : "years"} of data needed` : ""}.`);
    } else if (f.verdict === 2) {
      out.push(lang === "es" ? `${who}: hay una señal, pero no está confirmada.` : `${who}: there is a signal, but it is not confirmed.`);
    } else if (f.verdict === 0) {
      out.push(lang === "es" ? `${who}: no hay datos suficientes.` : `${who}: not enough data.`);
    }
  }
  return out;
}

/** Sources still on time? POWER publishes with ~2 months of lag; more than 4 months is reported as a data-quality item. */
export function staleSources(doc: HomeDoc, today: Date, lang: Lang): string[] {
  const out: string[] = [];
  const now = today.getUTCFullYear() * 12 + today.getUTCMonth();
  for (const ent of doc.entities) for (const mon of ent.monitors) {
    const m = /^(\d{4})-(\d{2})/.exec(mon.data.last_month);
    if (!m) continue;
    const lag = now - (Number(m[1]) * 12 + Number(m[2]) - 1);
    if (lag > 4) {
      out.push(lang === "es"
        ? `${monitorName(ent, mon, lang)}: la fuente no trae datos nuevos desde ${monthLabel(mon.data.last_month, lang)}.`
        : `${monitorName(ent, mon, lang)}: the source has no new data since ${monthLabel(mon.data.last_month, lang)}.`);
    }
  }
  return out;
}

/** «Qué atender» (P0–P1 from HORI's entity_state), in words and in both languages; never HORI's raw Spanish line. */
export function attentionText(item: StateItem, ent: HomeEntity, lang: Lang): string {
  const mon = ent.monitors.find((m) => m.variable.label.es === item.variable);
  const who = mon ? monitorName(ent, mon, lang) : `${item.variable ?? ""} · ${ent.entity.name[lang]}`;
  const z = (item.peak_z ?? item.mean_z) as number | undefined;
  const zz = typeof z === "number" && Number.isFinite(z) ? ` (${signed(z, lang, 1)}σ)` : "";
  if (item.kind === "anomalia") {
    const span = item.t_start === item.t_end ? monthLabel(String(item.t_start), lang) : `${monthLabel(String(item.t_start), lang)}–${monthLabel(String(item.t_end), lang)}`;
    return lang === "es" ? `${who}: ${span} fuera de lo esperable${zz}. Es solo una desviación estadística.` : `${who}: ${span} outside the expected range${zz}. It is only a statistical deviation.`;
  }
  if (item.kind === "tendencia") {
    return lang === "es" ? `${who}: la evidencia cambió con el último año.` : `${who}: the evidence changed with the last year.`;
  }
  if (item.kind === "conjunto") {
    return lang === "es" ? `Dos señales coinciden en el tiempo en ${ent.entity.name.es}; juntas pesan más, no dicen el origen.` : `Two signals coincide in time in ${ent.entity.name.en}; together they weigh more, they do not tell the origin.`;
  }
  return lang === "es" ? `${ent.entity.name.es}: señal ciudadana (no verificada).` : `${ent.entity.name.en}: citizen signal (unverified).`;
}

/** Status of an entity (from HORI's entity_state) in words. */
export const STATUS: Record<HomeEntity["state"]["status"], Record<Lang, string>> = {
  atencion: L("Pide atención", "Needs attention"),
  hallazgos: L("Hay hallazgos", "Findings"),
  vigilando: L("Vigilando", "Watching"),
  sin_novedad: L("Sin novedad", "Nothing new"),
};

/** Sources per variable label across the home (multisource capability, doc v2 §4.1). Today: one per monitor. */
export function sourcesFor(mon: HomeMonitor): number {
  return mon.data.source ? 1 : 0;
}
