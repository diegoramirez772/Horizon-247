// Interface texts, ES and EN.
// Verdict sentences are copied VERBATIM from the contract: SPEC §5 (expert/technical), §8.5b (normal) and §8.5 (plain).
// Text the contract does not define is marked `OWN:` (own translation, pending Estela + Carolina, plan D9).
// Forbidden in any text (checked by scripts/lint-texts.mjs): see FORBIDDEN below.

import type { Verdict } from "@/contract/types";

export type Lang = "es" | "en";
/**
 * Three reading levels over the same numbers (design doc «Modos de profundidad… v2» §2). Internal names stay as in
 * SPEC §8.5 so old links keep working; the screen says Simple / Normal / Experto.
 */
export type Register = "sencillo" | "normal" | "tecnico";
export const REGISTERS: Register[] = ["sencillo", "normal", "tecnico"];

type Templates = Record<Verdict, string>;

// SPEC §5 (technical register → "Experto").
const TECNICO: Record<Lang, Templates> = {
  es: {
    1: "Cambio real: {efecto} {unidad}/década (intervalo {lo} a {hi}). Sobrevive a la corrección por mirar {N} zonas a la vez.",
    2: "Posible cambio, no confirmado: no sobrevive a la corrección o los métodos discrepan ({k} de 3).",
    3: "Aún no se puede saber. Con {n} años solo habríamos visto cambios de ≥ {mde}/década. Para descartar cambios ≥ {δ}/década faltarían ~{años} años.",
    4: "Sin cambio detectable ≥ {δ}/década: si existiera, lo habríamos visto con ≥80 % de probabilidad (según el modelo de ruido).",
    0: "Datos insuficientes ({n} años válidos).",
  },
  en: {
    1: "Real change: {effect} {unit}/decade (interval {lo} to {hi}). Survives correction for testing {N} cells at once.",
    2: "Possible change, not confirmed: it does not survive correction, or methods disagree ({k} of 3).",
    3: "Not yet knowable. With {n} years we could only have seen changes ≥ {mde}/decade. Ruling out changes ≥ {δ}/decade would need ~{years} more years.",
    4: "No detectable change ≥ {δ}/decade: if it existed we would likely have seen it (≥80 %, under the noise model).",
    0: "Insufficient data ({n} valid years).",
  },
};

// SPEC §8.5 (plain register → "Sencillo"). No advice or precautions (SANTUARIO H17).
const SENCILLO: Record<Lang, Templates> = {
  es: {
    1: "Aquí sí hay un cambio real: {variable} {sube/baja} unos {efecto} {unidad} cada 10 años. Es muy poco probable que sea casualidad.",
    2: "Parece haber un cambio, pero aún no estamos seguros: podría ser casualidad o depender de cómo se calcule.",
    3: "Todavía no se puede saber. Con {n} años de datos solo notaríamos cambios de {mde} o más cada 10 años. Habría que esperar unos {años} años más.",
    4: "No vemos cambios grandes (de {δ} o más cada 10 años). Si los hubiera, muy probablemente los habríamos notado.",
    0: "No hay datos suficientes en esta zona.",
  },
  en: {
    1: "There is a real change here: {variable} is {rising/falling} about {effect} {unit} every 10 years. It is very unlikely to be chance.",
    2: "There seems to be a change, but we are not sure yet: it could be chance or depend on how it is calculated.",
    3: "We cannot tell yet. With {n} years of data we could only notice changes of {mde} or more per 10 years. We would need about {years} more years.",
    4: "We see no large changes ({δ} or more per 10 years). If there were, we would likely have noticed.",
    0: "Not enough data in this area.",
  },
};

// SPEC §8.5b (normal register): the chart-and-comparison reading, without p/q on screen.
const NORMAL: Record<Lang, Templates> = {
  es: {
    1: "{variable} {sube/baja} {efecto} {unidad} por década (entre {lo} y {hi}). Todos los métodos lo ven. Se mantiene al revisar {N} zonas a la vez.",
    2: "Hay una señal de {efecto} {unidad} por década, pero no pasa todos los filtros ({k} de 3 métodos la ven). Puede ser real o casualidad.",
    3: "Con {n} años de datos solo se distinguen cambios de {mde} o más por década, y lo que buscamos es {δ}. Con ~{años} años más se podría saber.",
    4: "No aparece un cambio de {δ} o más por década. Con estos datos, uno así se habría visto en la gran mayoría de los casos.",
    0: "Solo hay {n} años con datos válidos en esta zona; no alcanzan para este análisis.",
  },
  en: {
    1: "{variable} is {rising/falling} {effect} {unit} per decade (between {lo} and {hi}). All the methods see it. It holds when {N} areas are checked at once.",
    2: "There is a signal of {effect} {unit} per decade, but it does not pass every check ({k} of 3 methods see it). It may be real or chance.",
    3: "With {n} years of data only changes of {mde} or more per decade stand out, and we are looking for {δ}. About {years} more years would tell.",
    4: "No change of {δ} or more per decade shows up. With these data, one like that would have been seen in most cases.",
    0: "There are only {n} years of valid data here; not enough for this analysis.",
  },
};

export interface TemplateValues {
  effect: string;
  unit: string;
  lo: string;
  hi: string;
  N: string;
  k: string;
  n: string;
  mde: string;
  delta: string;
  years: string;
  variable: string;
  rising: boolean;
}

export function verdictText(v: Verdict, reg: Register, lang: Lang, x: TemplateValues): string {
  let t = (reg === "tecnico" ? TECNICO : reg === "normal" ? NORMAL : SENCILLO)[lang][v];
  // A single place is a family of one: «corrección por mirar 1 zonas» says nothing, so that sentence is dropped.
  if (x.N === "1") t = t.replace(/\s*[^.]*\{N\}[^.]*\./, "");
  const map: Record<string, string> = {
    "{efecto}": x.effect, "{effect}": x.effect,
    "{unidad}": x.unit, "{unit}": x.unit,
    "{lo}": x.lo, "{hi}": x.hi, "{N}": x.N, "{k}": x.k, "{n}": x.n,
    "{mde}": x.mde, "{δ}": x.delta,
    "{años}": x.years, "{years}": x.years,
    "{variable}": x.variable,
    "{sube/baja}": x.rising ? "sube" : "baja",
    "{rising/falling}": x.rising ? "rising" : "falling",
  };
  return t.replace(/\{[^}]+\}/g, (m) => map[m] ?? m)
    // The contract template is plural ("{N} zonas"); with N = 1 keep the sentence grammatical.
    .replace(/(^|\D)1 zonas/g, "$11 zona").replace(/(^|\D)1 cells/g, "$11 cell");
}

/** Raw templates, exposed for the text lint and tests. */
export const TEMPLATES = { TECNICO, NORMAL, SENCILLO };

export const OVER_60: Record<Lang, string> = { es: "más de 60", en: "over 60" };

/**
 * Legend: one row per texture, with its sentence (doc 03 §4: "la leyenda lleva la frase").
 * Phrases = the opening of each SPEC §5 sentence, except PROBADO → "Cambio detectado" (decision D6).
 */
export const LEGEND: Record<Lang, Record<Verdict, { phrase: string; texture: string }>> = {
  es: {
    1: { phrase: "Cambio detectado", texture: "sólido" },
    2: { phrase: "Posible cambio, no confirmado", texture: "punteado" },
    3: { phrase: "Aún no se puede saber", texture: "rayado" },
    4: { phrase: "Sin cambio detectable ≥ δ", texture: "gris liso" },
    0: { phrase: "Datos insuficientes", texture: "borde fino" },
  },
  en: {
    1: { phrase: "Change detected", texture: "solid" },
    2: { phrase: "Possible change, not confirmed", texture: "dotted" },
    3: { phrase: "Not yet knowable", texture: "striped" },
    4: { phrase: "No detectable change ≥ δ", texture: "flat grey" },
    0: { phrase: "Insufficient data", texture: "thin border" },
  },
};

/**
 * Everyday names of the verdicts (Sencillo). The same words everywhere — legend, answers, hover, evidence —
 * so a person never has to translate between two vocabularies. Experto uses LEGEND (contract §5 openings).
 */
export const PLAIN: Record<Lang, Record<Verdict, string>> = {
  es: { 1: "Ya cambió", 2: "Aún no se sabe", 3: "Aún no se sabe", 4: "No cambió mucho", 0: "Sin datos" },
  en: { 1: "It changed", 2: "Not known yet", 3: "Not known yet", 4: "Did not change much", 0: "No data" },
};

/** Verdict name for the register in use. */
export function verdictName(v: Verdict, lang: Lang, reg: Register): string {
  return reg === "sencillo" ? PLAIN[lang][v] : LEGEND[lang][v].phrase;
}

export const UI = {
  es: {
    brandTagline: "Qué cambia, dónde, cuánto y si ya se puede saber", // OWN
    profiles: { earth: "Tierra", mars: "Marte", person: "Persona" },
    profile: "Perfil",
    tabs: { cambio: "Cambio", contraste: "Contraste", detectabilidad: "Detectabilidad", evidencia: "Evidencia" },
    register: { sencillo: "Simple", normal: "Normal", tecnico: "Experto" },
    registerLabel: "Nivel de detalle",
    lang: "Idioma",
    theme: { label: "Tema", system: "Sistema", light: "Claro", dark: "Oscuro" },
    layer: "Capa",
    window: "Ventana",
    years: (n: number) => `${n} años`,
    time: "Tiempo",
    timeMode: { completa: "Ventana completa", anual: "Año a año", acumulada: "Evidencia acumulada" },
    descriptiveNote: "Descriptivo, sin veredicto",
    accumulatedNote: "Evolución de la evidencia; ventanas anidadas, no independientes entre sí",
    legend: "Leyenda",
    legendColour: (blueIsMore: boolean) => // OWN
      blueIsMore ? "Color solo en «Cambio detectado»: azul = más, rojo = menos; más intenso = mayor" : "Color solo en «Cambio detectado»: rojo = sube, azul = baja; más intenso = mayor",
    legendDescriptive: "Color = valor del año (rojo arriba, azul abajo)", // OWN
    summary: (x: string, y: string) => `En ${x} zonas ya hay cambio detectado; en ${y} aún no se puede saber.`, // OWN (web-diseno S1)
    intro: ["Esto es un mapa de cambio", "Sólido = cambio detectado", "Rayado = aún no se puede saber"],
    introClose: "Cerrar introducción",
    loading: "Cargando capa…",
    loadingIndex: "Cargando…",
    errorTitle: "No se pudo cargar la capa",
    retry: "Reintentar",
    empty: "Aún no hay capas para este perfil.",
    emptyHint: "Para desarrollo: npm run bundle:sim crea capas simuladas rotuladas.",
    pending: "Pendiente: se construye en una fase posterior del plan.",
    personLabel: "Datos simulados · no es tecnología médica",
    simulated: "SIMULADO",
    viewEvidence: "Ver evidencia",
    hideEvidence: "Ocultar evidencia",
    close: "Cerrar panel",
    cell: "Zona",
    flags: "Banderas",
    methods: "Métodos que coinciden",
    regionHori: "Región que cambia junta", regionUp: "Sí: está dentro de una región que sube", regionDown: "Sí: está dentro de una región que baja", regionNo: "No está dentro de ninguna",
    provenance: "Procedencia",
    series: "Serie por año",
    trend: "Recta con la pendiente del bundle", // OWN
    noSeries: "La serie de esta zona no está en el bundle.",
    effect: "Efecto",
    interval: "Intervalo",
    region: "Región",
    regionNone: "Elegir región…",
    mapLabel: (t: string) => `Mapa de cambio: ${t}. Flechas para mover, + y − para acercar, Enter para elegir la zona del centro.`,
    mapHelp: "Flechas: mover · + −: acercar · 0: mundo · Enter: elegir zona",
    zoomIn: "Acercar",
    zoomOut: "Alejar",
    resetView: "Ver el mundo",
    realData: "Datos reales",
    licence: "Licencia",
    deltaNote: (d: string) => `δ = ${d} σ por década`,
    selectHint: "Toca una zona del mapa para ver su evidencia.", // OWN
    panelFullWindow: (w: string) => `El panel muestra la ventana completa (${w}); el mapa, el modo de tiempo elegido.`, // OWN
  },
  en: {
    brandTagline: "What changes, where, how much, and whether it is knowable yet",
    profiles: { earth: "Earth", mars: "Mars", person: "Person" },
    profile: "Profile",
    tabs: { cambio: "Change", contraste: "Contrast", detectabilidad: "Detectability", evidencia: "Evidence" },
    register: { sencillo: "Simple", normal: "Normal", tecnico: "Expert" },
    registerLabel: "Level of detail",
    lang: "Language",
    theme: { label: "Theme", system: "System", light: "Light", dark: "Dark" },
    layer: "Layer",
    window: "Window",
    years: (n: number) => `${n} years`,
    time: "Time",
    timeMode: { completa: "Full window", anual: "Year by year", acumulada: "Accumulated evidence" },
    descriptiveNote: "Descriptive, no verdict",
    accumulatedNote: "Evolution of the evidence; nested windows, not independent of each other",
    legend: "Legend",
    legendColour: (blueIsMore: boolean) =>
      blueIsMore ? "Colour only on “Change detected”: blue = more, red = less; stronger = larger" : "Colour only on “Change detected”: red = rising, blue = falling; stronger = larger",
    legendDescriptive: "Colour = value of the year (red above, blue below)",
    summary: (x: string, y: string) => `In ${x} areas a change is already detected; in ${y} it is not yet knowable.`,
    intro: ["This is a map of change", "Solid = change detected", "Striped = not yet knowable"],
    introClose: "Close introduction",
    loading: "Loading layer…",
    loadingIndex: "Loading…",
    errorTitle: "The layer could not be loaded",
    retry: "Retry",
    empty: "No layers for this profile yet.",
    emptyHint: "For development: npm run bundle:sim creates labelled simulated layers.",
    pending: "Pending: built in a later phase of the plan.",
    personLabel: "Simulated data · not medical technology",
    simulated: "SIMULATED",
    viewEvidence: "View evidence",
    hideEvidence: "Hide evidence",
    close: "Close panel",
    cell: "Area",
    flags: "Flags",
    methods: "Methods in agreement",
    regionHori: "Region changing together", regionUp: "Yes: inside a region that is rising", regionDown: "Yes: inside a region that is falling", regionNo: "Not inside any",
    provenance: "Provenance",
    series: "Series by year",
    trend: "Line with the bundle's slope",
    noSeries: "The series for this area is not in the bundle.",
    effect: "Effect",
    interval: "Interval",
    region: "Region",
    regionNone: "Choose a region…",
    mapLabel: (t: string) => `Map of change: ${t}. Arrows to move, + and − to zoom, Enter to pick the area in the centre.`,
    mapHelp: "Arrows: move · + −: zoom · 0: world · Enter: pick area",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    resetView: "Whole world",
    realData: "Real data",
    licence: "Licence",
    deltaNote: (d: string) => `δ = ${d} σ per decade`,
    selectHint: "Tap an area on the map to see its evidence.",
    panelFullWindow: (w: string) => `The panel shows the full window (${w}); the map shows the chosen time mode.`,
  },
} as const;

export const FLAG_LABEL: Record<Lang, Record<string, string>> = {
  es: {
    DEPENDE_DEL_METODO: "Depende del método", CAMBIO_DE_VERSION: "Cambio de versión del dato",
    COBERTURA_BAJA: "Cobertura baja", RESOLUCION_GRUESA: "Resolución gruesa",
    RECONSTRUCCION: "Reconstrucción", SIMULADO: "Simulado", AUTOCORRELACION_ALTA: "Autocorrelación alta",
    QUIEBRE_POSIBLE: "Posible salto",
  },
  en: {
    DEPENDE_DEL_METODO: "Method-dependent", CAMBIO_DE_VERSION: "Data version change",
    COBERTURA_BAJA: "Low coverage", RESOLUCION_GRUESA: "Coarse resolution",
    RECONSTRUCCION: "Reconstruction", SIMULADO: "Simulated", AUTOCORRELACION_ALTA: "High autocorrelation",
    QUIEBRE_POSIBLE: "Possible jump",
  },
};


/** Doc 04 §4: words that must never appear in interface text. */
export const FORBIDDEN = [/prueba/i, /causa/i, /predic/i, /recomend/i, /debería/i, /peligro/i, /diagnós/i, /no hay cambio/i, /riesgo(?!_potencial)/i, /urgente/i];
