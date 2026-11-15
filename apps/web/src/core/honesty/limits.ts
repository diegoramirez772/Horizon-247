// What a finding cannot tell you, in words (design doc «Modos de profundidad… v2» §3).
// No level hides the main limit: Simple shows one, Normal up to three, Experto all of them with their contract bit.
// The order is fixed and public (doc v2 §3.1), so the same finding always leads with the same limit.

import { FLAG, type Verdict } from "@/contract/types";
import type { Lang, Register } from "@/core/i18n/texts";
import { num } from "@/core/format/format";

export interface Limit {
  key: string;
  /** Contract flag bit (SPEC §3), or null for limits that are not flags (scale, a measured regional bias). */
  bit: number | null;
  text: Record<Lang, string>;
}

export interface LimitInput {
  flags: number;
  verdict: Verdict;
  simulated: boolean;
  /** Native resolution of the data, in degrees (0 or unknown → no scale sentence). */
  resolutionDeg: number;
  /** Cells averaged into the reading (a region or place); 1 or undefined for a single cell. */
  nCells?: number;
  /** Latitude of a single cell (for regional biases measured on the source). */
  lat?: number;
  datasetName?: string;
  breakYear?: number | null;
}

const L = (es: string, en: string): Record<Lang, string> => ({ es, en });

/** Plain text of each flag (doc v2 §3.2). The same table lives in hori/state.py (FLAG_ES) for the CLI. */
export const FLAG_TEXT: Record<keyof typeof FLAG, Record<Lang, string>> = {
  DEPENDE_DEL_METODO: L("Según cómo se calcule, la señal aparece o no.", "Depending on how it is calculated, the signal shows up or not."),
  CAMBIO_DE_VERSION: L("La fuente cambió de versión a mitad del periodo.", "The source changed version partway through the period."),
  COBERTURA_BAJA: L("Faltan datos en parte del periodo o de la zona.", "Data are missing for part of the period or the area."),
  RESOLUCION_GRUESA: L("La zona es más chica que el detalle de los datos.", "The area is smaller than the detail of the data."),
  RECONSTRUCCION: L("Parte de los datos son reconstruidos, no medidos.", "Part of the data is reconstructed, not measured."),
  SIMULADO: L("Datos simulados, no reales.", "Simulated data, not real."),
  AUTOCORRELACION_ALTA: L("Los años se parecen mucho entre sí; eso hace más difícil estar seguros.", "Years are very similar to each other; that makes it harder to be sure."),
  QUIEBRE_POSIBLE: L("Hay un salto brusco en la serie; podría ser del instrumento y no del fenómeno.", "There is a sudden jump in the series; it could come from the instrument, not the phenomenon."),
};

// doc v2 §3.1: simulated → insufficient/coverage → jump → version/reconstruction → method → autocorrelation → resolution → regional bias → scale.
const ORDER: (keyof typeof FLAG)[] = [
  "SIMULADO", "COBERTURA_BAJA", "QUIEBRE_POSIBLE", "CAMBIO_DE_VERSION", "RECONSTRUCCION", "DEPENDE_DEL_METODO", "AUTOCORRELACION_ALTA", "RESOLUCION_GRUESA",
];

const KM_PER_DEG = 111.32;

/** Every limit that applies, in the fixed order. The last one is always the scale, so there is never «no limit». */
export function limitsFor(x: LimitInput): Limit[] {
  const out: Limit[] = [];
  const has = (k: keyof typeof FLAG) => (x.flags & FLAG[k]) !== 0;
  if (x.simulated || has("SIMULADO")) out.push({ key: "SIMULADO", bit: FLAG.SIMULADO, text: FLAG_TEXT.SIMULADO });
  if (x.verdict === 0) out.push({ key: "INSUFICIENTE", bit: null, text: L("No hay suficientes años con datos para decir algo.", "There are not enough years with data to say anything.") });
  for (const k of ORDER) {
    if (k === "SIMULADO" || !has(k)) continue;
    const text = k === "QUIEBRE_POSIBLE" && x.breakYear
      ? L(`Hay un salto brusco hacia ${x.breakYear}; podría ser del instrumento y no del fenómeno.`, `There is a sudden jump around ${x.breakYear}; it could come from the instrument, not the phenomenon.`)
      : FLAG_TEXT[k];
    out.push({ key: k, bit: FLAG[k], text });
  }
  // Measured on this source (team model card §3.5): MERRA-2 shows ~45 % less Arctic warming than GISTEMP stations.
  if (x.lat !== undefined && x.lat >= 66.5 && /power|merra/i.test(x.datasetName ?? "")) {
    out.push({ key: "ARTICO_MERRA2", bit: null, text: L(
      "En el Ártico esta fuente marca cerca de 45 % menos calentamiento que las estaciones (GISTEMP); medido.",
      "In the Arctic this source shows about 45 % less warming than stations (GISTEMP); measured.") });
  }
  if (x.resolutionDeg > 0) {
    const km = Math.round(x.resolutionDeg * KM_PER_DEG);
    const n = x.nCells && x.nCells > 1 ? x.nCells : 0;
    out.push({ key: "ESCALA", bit: null, text: n
      ? L(`Es el promedio de ${num(n, "es", 0)} celdas de ~${km} km: describe la región, no una calle.`, `It is the average of ${num(n, "en", 0)} cells of ~${km} km: it describes the region, not a street.`)
      : L(`Es una celda de ~${km} km: no describe una calle ni un terreno.`, `It is one cell of ~${km} km: it does not describe a street or a plot.`) });
  }
  return out;
}

/** How many limits each level shows (doc v2 §2.2): one, up to three, all. */
export function shownLimits(all: Limit[], reg: Register): Limit[] {
  return reg === "sencillo" ? all.slice(0, 1) : reg === "normal" ? all.slice(0, 3) : all;
}
