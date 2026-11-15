// Words for a focus (no LLM, H19): what HORI holds there, how sure, and why it is shown in this place of the order.
// Every number comes from the bundle through `findFoci`; nothing here adds a claim.

import type { Manifest } from "@/contract/types";
import { YEARS_MORE_OVER_60 } from "@/core/contract/extra";
import { num, signed } from "@/core/format/format";
import { FLAG_LABEL, type Lang } from "@/core/i18n/texts";
import type { Focus } from "./focos";

function area(km2: number, lang: Lang): string {
  if (km2 >= 1e6) return `${num(km2 / 1e6, lang, 1)} ${lang === "es" ? "millones de km²" : "million km²"}`;
  if (km2 >= 1e4) return `${num(km2 / 1e3, lang, 0)} ${lang === "es" ? "mil km²" : "thousand km²"}`;
  return `${num(km2, lang, 0)} km²`;
}

function q(x: number, lang: Lang): string {
  if (!Number.isFinite(x)) return "—";
  return x < 0.001 ? `< ${num(0.001, lang, 3)}` : num(x, lang, 3);
}

function where(f: Focus, lang: Lang): string {
  const ns = f.lat >= 0 ? "N" : "S";
  const ew = f.lon >= 0 ? "E" : lang === "es" ? "O" : "W";
  return `${num(Math.abs(f.lat), lang, 1)}°${ns} ${num(Math.abs(f.lon), lang, 1)}°${ew}`;
}

export interface FocusWords {
  /** «Foco 1 · 41,2°N 3,5°E». */
  title: string;
  /** One sentence: what HORI holds there. */
  line: string;
  /** Numbers for the expert: interval, δ, q, e-BH, flags. */
  detail: string;
  /** Why it is in this place of the order (the three factors of the score). */
  why: string;
  /** Short label over the 3D view. */
  tag: string;
}

export function focusWords(f: Focus, m: Manifest, lang: Lang): FocusWords {
  const es = lang === "es";
  const u = m.variable.unit_per_decade ?? "";
  const flags = f.flags.map((k) => FLAG_LABEL[lang][k] ?? k).join(", ");
  const cells = `${f.cells.length} ${es ? "celdas" : "cells"}`;
  if (f.kind === "apoyado") {
    const dir = f.sign > 0 ? (es ? "Sube" : "Rising") : (es ? "Baja" : "Falling");
    const eff = `${signed(f.effect, lang, 2)} ${u}`;
    return {
      title: `${es ? "Foco" : "Focus"} ${f.rank} · ${where(f, lang)}`,
      line: es
        ? `${dir} ${eff} en ${area(f.areaKm2, lang)} contiguos: HORI lo da por apoyado y todo el intervalo queda más allá de δ.`
        : `${dir} ${eff} over ${area(f.areaKm2, lang)} of contiguous area: HORI marks it supported and the whole interval lies beyond δ.`,
      detail: [
        `${es ? "Intervalo típico" : "Typical interval"} ${signed(f.ciLo, lang, 2)} … ${signed(f.ciHi, lang, 2)} ${u} (${es ? "celdas" : "cells"} ${signed(f.ciMin, lang, 2)} … ${signed(f.ciMax, lang, 2)})`,
        `δ ${num(f.delta, lang, 2)}`,
        `q ${es ? "mediano" : "median"} ${q(f.qMedian, lang)}`,
        f.ebhShare === null ? "" : `e-BH ${es ? "coincide en" : "agrees on"} ${num(f.ebhShare * 100, lang, 0)} %`,
        cells,
        flags ? `${es ? "Avisos" : "Flags"}: ${flags}` : "",
      ].filter(Boolean).join(" · "),
      why: es
        ? `Va en el lugar ${f.rank}: área ${area(f.why.areaKm2, lang)} × efecto/δ ${num(f.why.effectOverDelta, lang, 1)} × evidencia ${num(f.why.evidence, lang, 2)}.`
        : `Ranked ${f.rank}: area ${area(f.why.areaKm2, lang)} × effect/δ ${num(f.why.effectOverDelta, lang, 1)} × evidence ${num(f.why.evidence, lang, 2)}.`,
      tag: `${f.rank} · ${eff}`,
    };
  }
  const ym = f.yearsMore;
  const years = ym === null ? "" : ym >= YEARS_MORE_OVER_60
    ? (es ? "harían falta más de 60 años" : "more than 60 years would be needed")
    : (es ? `harían falta unos ${num(ym, lang, 0)} años más` : `about ${num(ym, lang, 0)} more years would be needed`);
  return {
    title: `${es ? "Aún no se sabe" : "Not known yet"} ${f.rank} · ${where(f, lang)}`,
    line: es
      ? `${area(f.areaKm2, lang)} contiguos donde HORI todavía no puede decir si el cambio supera δ${years ? `; ${years}` : ""}.`
      : `${area(f.areaKm2, lang)} of contiguous area where HORI cannot yet say whether the change exceeds δ${years ? `; ${years}` : ""}.`,
    detail: [
      `${num(f.candidateShare * 100, lang, 0)} % ${es ? "con indicios (candidatas)" : "with hints (candidates)"}`,
      `MDE ${num(f.mde, lang, 2)} ${u}`,
      `δ ${num(f.delta, lang, 2)}`,
      cells,
      flags ? `${es ? "Avisos" : "Flags"}: ${flags}` : "",
    ].filter(Boolean).join(" · "),
    why: es ? `Va en el lugar ${f.rank} por su área (${area(f.areaKm2, lang)}).` : `Ranked ${f.rank} by its area (${area(f.areaKm2, lang)}).`,
    tag: `? ${f.rank}`,
  };
}

/** Caption of the generated scene of a focus: what HORI holds there, and that the scene only illustrates it (H4/H5). */
export function sceneCaption(f: Focus, m: Manifest, lang: Lang): string {
  const es = lang === "es";
  const u = m.variable.unit_per_decade ?? "";
  if (f.kind === "apoyado") {
    return es
      ? `HORI · ${m.title.es}: la escena ilustra una tendencia apoyada de ${signed(f.effect, lang, 2)} ${u} (intervalo típico ${signed(f.ciLo, lang, 2)} … ${signed(f.ciHi, lang, 2)}), con los años medios del foco ${f.rank}.`
      : `HORI · ${m.title.en}: the scene illustrates a supported trend of ${signed(f.effect, lang, 2)} ${u} (typical interval ${signed(f.ciLo, lang, 2)} … ${signed(f.ciHi, lang, 2)}), with the mean years of focus ${f.rank}.`;
  }
  return es
    ? `HORI · ${m.title.es}: aquí aún no se sabe si el cambio supera δ. La escena muestra los años tal como fueron, sin afirmar una tendencia.`
    : `HORI · ${m.title.en}: here it is not known yet whether the change exceeds δ. The scene shows the years as they were, without claiming a trend.`;
}
