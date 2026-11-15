// «¿Qué tan seguro?» (design doc «Modos de profundidad… v2» §3.4): how often HORI is wrong, as MEASURED, never as promised.
// Numbers: the team model card §3.1 (AR(1) simulation) and §3.9 (real null: the planet's own noise without trend).
// home.json (SPEC §15) carries the same numbers; these are the fallback when it is absent, and a test keeps them equal.

import type { HomeCalibration } from "@/contract/types";
import type { Lang, Register } from "@/core/i18n/texts";
import { num } from "@/core/format/format";

export const MEASURED: HomeCalibration = {
  source: "the team model card §3.1 and §3.9",
  fdr_probado_real_null: { optimistic: 0.059, pessimistic: 0.238 },
  fdr_ebh_real_null: { optimistic: 0.011, pessimistic: 0.093 },
  power_at_delta: { optimistic: 0.697, pessimistic: 0.462 },
  sim_false_alarms: { "phi_0.3": 0.052, "phi_0.5": 0.068 },
  sim_power_2sigma: { "phi_0.3": 0.92, "phi_0.5": 0.78 },
  note: "Mapa del planeta (T2M 1981–2025, 30 realizaciones con nulo real). Una consulta regional es una familia de 1: su FDR no se midió aparte.",
};

const pct = (x: number, lang: Lang, d = 0) => `${num(100 * x, lang, d)} %`;
const per100 = (x: number) => Math.round(100 * x);

/** One paragraph per level; Simple carries no percentages (doc v2 §3.4), Normal plain counts, Experto the table. */
export function certaintyText(reg: Register, lang: Lang, c: HomeCalibration = MEASURED): string {
  const f = c.fdr_probado_real_null, e = c.fdr_ebh_real_null, p = c.power_at_delta;
  if (reg === "sencillo") {
    return lang === "es"
      ? "Cuando HORIZON dice «cambio real», casi siempre lo es, pero no siempre. Lo comprobamos con datos del planeta a los que les quitamos la tendencia: ahí no tendría que aparecer ningún cambio, y contamos cuántas veces aparecía."
      : "When HORIZON says “real change”, it almost always is, but not always. We checked it with the planet's data with the trend removed: no change should appear there, and we counted how often one did.";
  }
  if (reg === "normal") {
    return lang === "es"
      ? `De los cambios marcados como reales en todo el planeta, se estima que entre ${per100(f.optimistic)} y ${per100(f.pessimistic)} de cada 100 podrían no serlo, según cómo se modele el ruido. Si de verdad hay un cambio del tamaño buscado, se detecta entre ${per100(p.pessimistic)} y ${per100(p.optimistic)} de cada 100 veces. Medido con datos reales sin tendencia, 30 repeticiones.`
      : `Of the changes marked as real across the planet, an estimated ${per100(f.optimistic)} to ${per100(f.pessimistic)} in every 100 may not be, depending on how the noise is modelled. If a change of the size we look for really exists, it is detected ${per100(p.pessimistic)} to ${per100(p.optimistic)} times in 100. Measured on real data with the trend removed, 30 repetitions.`;
  }
  const s3 = c.sim_false_alarms["phi_0.3"], s5 = c.sim_false_alarms["phi_0.5"];
  const w3 = c.sim_power_2sigma["phi_0.3"], w5 = c.sim_power_2sigma["phi_0.5"];
  return lang === "es"
    ? `FDR real de PROBADO con nulo real (fases de Fourier comunes, T2M 1981–2025, 30 realizaciones, q = 10 %): ${pct(f.optimistic, lang, 1)} (optimista) a ${pct(f.pessimistic, lang, 1)} (pesimista). e-BH: ${pct(e.optimistic, lang, 1)} a ${pct(e.pessimistic, lang, 1)}. Potencia a δ: ${pct(p.optimistic, lang, 1)} a ${pct(p.pessimistic, lang, 1)}. Simulación AR(1), n = 23: falsas alarmas ${pct(s3, lang, 1)} (φ = 0.3) y ${pct(s5, lang, 1)} (φ = 0.5); potencia a 2σ/década ${pct(w3, lang)} y ${pct(w5, lang)}. Una consulta de lugar es una familia de 1 serie: su FDR no se midió aparte. Fuente: ${c.source}.`
    : `Real FDR of PROBADO under a real null (shared Fourier phases, T2M 1981–2025, 30 realizations, q = 10 %): ${pct(f.optimistic, lang, 1)} (optimistic) to ${pct(f.pessimistic, lang, 1)} (pessimistic). e-BH: ${pct(e.optimistic, lang, 1)} to ${pct(e.pessimistic, lang, 1)}. Power at δ: ${pct(p.optimistic, lang, 1)} to ${pct(p.pessimistic, lang, 1)}. AR(1) simulation, n = 23: false alarms ${pct(s3, lang, 1)} (φ = 0.3) and ${pct(s5, lang, 1)} (φ = 0.5); power at 2σ/decade ${pct(w3, lang)} and ${pct(w5, lang)}. A place query is a family of one series: its FDR was not measured separately. Source: ${c.source}.`;
}
