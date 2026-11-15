// Builds the assistant's answer cards (doc 01 §4: action → narration ≤ 2 sentences → origin + «Ver evidencia» → 2–3 chips).
// Every number comes from the bundle; verdict sentences are the contract's (SPEC §5, §8.5) through verdictText.
// Each card is written in both languages and all three registers, so switching ES/EN or Simple/Normal/Experto
// re-reads the whole conversation without losing your place (doc 01 §5).

import type { CellFinding, Verdict } from "@/contract/types";
import type { FaunaGroup } from "@/core/live/fauna";
import { entryWindow, siblings, type IndexEntry, type RegionGeo } from "@/core/contract/extra";
import { cellFinding, type Layer } from "@/core/contract/loader";
import { capitalise, count, deltaValue, digitsFor, num, shortLabel, templateValues } from "@/core/format/format";
import { narrateTrend, planetAverage, type TrendFacts } from "@/core/nlg/realize";
import { topicAnswer, type Widget } from "@/core/genui/topic";
import type { Where } from "@/core/genui/places";
import { LAYERS } from "@/core/map/imagery";
import { NO_SURFACE, WORLDS, WORLD_PRESET, type WorldId } from "@/core/scene/worlds";
import { type HowKey, howtoAnswer } from "./howto";
import { certaintyText } from "@/core/honesty/calibration";
import { limitsFor, type Limit } from "@/core/honesty/limits";
import { LEGEND, REGISTERS, UI, verdictName, verdictText, type Lang, type Register } from "@/core/i18n/texts";
import type { AppState, Selection } from "@/core/state/store";
import type { Command, Topic } from "./parse";

/** «zon»: a record or an operation of the ZON runtime (monitors, alerts, reports), not a HORI calculation (H20). */
export type Origin = "hori" | "sim" | "ui" | "zon";
export type Source = "user" | "map" | "controls" | "system";

export interface Chip { label: Record<Lang, string>; cmd: Command }

export interface Card {
  id: number;
  kind: string;
  source: Source;
  action: Record<Lang, string> | null;
  text: Record<Lang, Record<Register, string>>;
  origin: Origin;
  /** What «Ver evidencia» opens: only valid while that layer is on screen. */
  evidence: { layerId: string; selection: Exclude<Selection, null> } | null;
  chips: Chip[];
  /** Offer «No era eso» (doc 01, HAX G9) under answers to typed or spoken commands. */
  correctable: boolean;
  /**
   * The key result of an answer, frozen when the answer is made (so older answers keep their numbers even if
   * the layer on screen changes): verdict, effect per decade and the yearly series for a sparkline.
   */
  figure?: Figure;
  /** What the answer cannot tell, in the fixed order of doc v2 §3.1 (the screen shows 1 / 3 / all by level). */
  limits?: Limit[];
  /** Generative interface: components built for the topic of the question (clima, ganado, astronauta, Marte…). */
  widgets?: Widget[];
}

export interface Figure {
  verdict: Verdict;
  effect: number;
  lo: number;
  hi: number;
  mde: number;
  unitPerDecade: string;
  unit: string;
  series: number[];
  years: number[];
  window: string;
}

function figureOf(ctx: Ctx, r: Reading): Figure {
  const m = ctx.layer!.manifest;
  return {
    verdict: r.finding.verdict, effect: r.finding.effect, lo: r.finding.ci[0], hi: r.finding.ci[1], mde: r.finding.mde,
    unitPerDecade: m.variable.unit_per_decade, unit: m.variable.unit,
    series: r.finding.series.map((v) => (v === null ? NaN : v)), years: m.series?.years ?? [], window: `${m.window.start}–${m.window.end}`,
  };
}

export interface Ctx {
  layer: Layer | null;
  regions: RegionGeo[];
  entries: IndexEntry[];
  state: AppState;
}

export type CardKind =
  | "greet" | "area" | "summary" | "detect" | "compare" | "contrast" | "legend" | "provenance" | "help"
  | "advice" | "cause" | "unknown1" | "unknown2" | "unknown3" | "noSelection" | "year" | "accumulated"
  | "undo" | "profile" | "noWindow" | "loading" | "done" | "filter" | "world" | "level" | "certainty" | "imagery" | "evolution" | "scene" | "zone"
  | `howto:${HowKey}` | "speed" | "open:fauna" | "open:person" | "open:map" | "open:zone" | "open:live" | "gestures:on" | "gestures:off";

const LANGS: Lang[] = ["es", "en"];
const REGS: Register[] = REGISTERS;

let nextId = 1;

type Txt = { action?: string | null; text: string };

function both(f: (lang: Lang, reg: Register) => Txt): Pick<Card, "action" | "text"> {
  const text = { es: { sencillo: "", normal: "", tecnico: "" }, en: { sencillo: "", normal: "", tecnico: "" } } as Card["text"];
  let action: Card["action"] = null;
  for (const lang of LANGS) for (const reg of REGS) {
    const r = f(lang, reg);
    text[lang][reg] = r.text;
    if (reg === "sencillo" && r.action) action = { ...(action ?? { es: "", en: "" }), [lang]: r.action };
  }
  return { action, text };
}

const L = (es: string, en: string): Record<Lang, string> => ({ es, en });
const chip = (label: Record<Lang, string>, cmd: Command["intent"], place: Command["place"] = null): Chip => ({ label, cmd: { intent: cmd, place } });

// ---------------------------------------------------------------- chips (broad examples, doc 01 §3 NN/g)

function placeChip(ctx: Ctx): Chip | null {
  const r = ctx.regions.find((x) => ctx.layer && x.layers[ctx.layer.manifest.id]);
  return r ? chip(L(`¿Qué cambió en ${short(r.name.es)}?`, `What changed in ${short(r.name.en)}?`), { t: "area" }, { kind: "region", id: r.id }) : null;
}
const C = {
  onlyDetected: chip(L("Solo los cambios detectados", "Only detected changes"), { t: "filter", verdicts: [1] }),
  showAll: chip(L("Mostrar todo", "Show everything"), { t: "filter", verdicts: null }),
  detect: chip(L("¿Cuánto falta para estar seguros?", "How long until we can be sure?"), { t: "detect" }),
  compare: chip(L("Compara 24 y 45 años", "Compare 24 and 45 years"), { t: "compare" }),
  legend: chip(L("¿Qué significa el rayado?", "What do the stripes mean?"), { t: "legend" }),
  data: chip(L("¿De dónde salen los datos?", "Where does the data come from?"), { t: "provenance" }),
  summary: chip(L("Resumen del mapa", "Map summary"), { t: "summary" }),
  contrast: chip(L("Ingenuo vs. corregido", "Naive vs. corrected"), { t: "contrast" }),
  accumulated: chip(L("Ver la evidencia acumulada", "Show accumulated evidence"), { t: "accumulated", end: null }),
  certainty: chip(L("¿Qué tan seguro es?", "How sure is it?"), { t: "certainty" }),
  help: chip(L("¿Qué puedes hacer?", "What can you do?"), { t: "help" }),
};

/** 2–3 suggestions, never repeated (doc 01 §4). */
function chips(ctx: Ctx, ...list: (Chip | null | false | undefined)[]): Chip[] {
  const seen = new Set<string>();
  return list.filter((c): c is Chip => !!c && !seen.has(c.label.es) && !!seen.add(c.label.es)).slice(0, 3);
}

function hasSiblings(ctx: Ctx): boolean {
  const e = ctx.entries.find((x) => x.id === ctx.state.layerId) ?? null;
  return siblings(ctx.entries, e).length > 1;
}

// ---------------------------------------------------------------- reading the selection

function short(name: string): string {
  return name.replace(/\s*\(.*\)\s*/, "").trim();
}

function coord(lat: number, lon: number, lang: Lang): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : lang === "es" ? "O" : "W";
  return `${num(Math.abs(lat), lang, 1)}° ${ns}, ${num(Math.abs(lon), lang, 1)}° ${ew}`;
}

export interface Reading { finding: CellFinding; nvalid: number | null; N: number; name: Record<Lang, string>; selection: Exclude<Selection, null>; nCells: number }

export function readSelection(ctx: Ctx, sel: Selection = ctx.state.selection): Reading | null {
  const layer = ctx.layer;
  if (!layer || !sel) return null;
  const m = layer.manifest;
  if (sel.kind === "cell") {
    if (sel.index < 0 || sel.index >= layer.cells) return null;
    const f = cellFinding(layer, sel.index);
    const nv = layer.arrays.nvalid;
    return {
      finding: f, nvalid: nv ? nv[sel.index] : null, N: m.summary.cells_valid ?? NaN, selection: sel, nCells: 1,
      name: { es: `la zona ${coord(f.lat, f.lon, "es")}`, en: `the area ${coord(f.lat, f.lon, "en")}` },
    };
  }
  const region = ctx.regions.find((r) => r.id === sel.id);
  const rl = region?.layers[m.id];
  if (!region || !rl) return null;
  return {
    selection: sel, nvalid: null, N: ctx.regions.length, nCells: rl.n_cells,
    name: { es: short(region.name.es), en: short(region.name.en) },
    finding: {
      index: -1, lat: NaN, lon: NaN, effect: rl.effect, ci: rl.ci, sigma: NaN, r1: NaN, p: rl.pCons, q: rl.qRegions,
      mde: rl.mde, yearsMore: rl.yearsMore, verdict: rl.verdict, flags: rl.flags, nSig: 0, naiveSig: false, series: rl.series,
    },
  };
}

/** The limits of one reading (doc v2 §3): flags of the finding + source facts + scale. */
export function readingLimits(ctx: Ctx, r: Reading): Limit[] {
  const m = ctx.layer!.manifest;
  return limitsFor({
    flags: r.finding.flags, verdict: r.finding.verdict, simulated: m.honesty.simulated, resolutionDeg: m.grid.native_resolution_deg,
    nCells: r.nCells, lat: r.selection.kind === "cell" ? r.finding.lat : undefined, datasetName: m.dataset.name,
  });
}

function originOf(ctx: Ctx): Origin {
  return ctx.layer?.manifest.honesty.simulated ? "sim" : "hori";
}

/** Short context line of an answer: "La temperatura simulada · Durango · 1980–2024". */
function showing(ctx: Ctx, lang: Lang, place?: string): string {
  const m = ctx.layer!.manifest;
  return [capitalise(shortLabel(m, lang)), place ? capitalise(place) : null, `${m.window.start}–${m.window.end}`].filter(Boolean).join(" · ");
}

// Planet average of a grid layer, computed once per layer (it does not change while the layer is on screen).
const planetMemo = new WeakMap<Layer, number | null>();
function planetOf(layer: Layer): number | null {
  if (!planetMemo.has(layer)) {
    const g = layer.manifest.grid;
    // Only a layer that covers the planet has a «planet average»; a box over one state does not.
    const global = g.nlat * Math.abs(g.dlat) > 150 && g.nlon * Math.abs(g.dlon) > 300;
    const { effect, verdict } = layer.arrays;
    planetMemo.set(layer, global && effect && verdict ? planetAverage(effect, verdict, g.lat0, g.dlat, g.nlat, g.nlon) : null);
  }
  return planetMemo.get(layer)!;
}

/** The facts of one reading, as the language generator needs them (every value from the bundle). */
export function trendFacts(ctx: Ctx, r: Reading, lang: Lang): TrendFacts {
  const layer = ctx.layer!;
  const m = layer.manifest;
  const f = r.finding;
  return {
    place: r.name[lang], variable: m.variable.name, unit: m.variable.unit, verdict: f.verdict, effect: f.effect,
    lo: f.ci[0] ?? NaN, hi: f.ci[1] ?? NaN, mde: f.mde, delta: deltaValue(m, f), yearsMore: f.yearsMore ?? NaN,
    nYears: r.nvalid ?? m.window.n, start: m.window.start, end: m.window.end,
    planet: r.selection.kind === "cell" ? planetOf(layer) : null,
  };
}

function sentence(ctx: Ctx, r: Reading, lang: Lang, reg: Register, v: Verdict = r.finding.verdict): string {
  // Simple and Normal: the generator writes it in plain words (Plan de unión D4). Experto keeps the contract wording.
  if (reg !== "tecnico" && v === r.finding.verdict) return narrateTrend(trendFacts(ctx, r, lang), lang, reg === "normal");
  const tv = templateValues(ctx.layer!.manifest, r.finding, r.nvalid, lang, reg, r.N);
  return capitalise(verdictText(v, reg, lang, tv));
}

// ---------------------------------------------------------------- the cards

function allRegs(t: Record<Lang, string>): Card["text"] {
  return { es: { sencillo: t.es, normal: t.es, tecnico: t.es }, en: { sencillo: t.en, normal: t.en, tecnico: t.en } };
}

const TOPIC_CHIPS: Record<Topic, Chip[]> = {
  clima: [
    chip(L("¿Cómo está el ganado aquí?", "How is the livestock here?"), { t: "topic", topic: "ganado", where: null }),
    chip(L("Infrarrojo en vivo", "Live infrared"), { t: "imagery", layer: "GOES-East_ABI_Band13_Clean_Infrared" }),
  ],
  ganado: [
    chip(L("¿Qué cambió en el clima de aquí?", "What changed in the climate here?"), { t: "area" }),
    chip(L("Eventos cerca", "Events nearby"), { t: "topic", topic: "eventos", where: null }),
  ],
  astronauta: [chip(L("¿Y Marte?", "And Mars?"), { t: "topic", topic: "marte", where: null })],
  marte: [chip(L("Marte en 3D", "Mars in 3D"), { t: "scene", where: null, timeline: false, preset: "marte" }), chip(L("Otros planetas", "Other planets"), { t: "topic", topic: "planetas", where: null }), chip(L("Volver a la Tierra", "Back to Earth"), { t: "summary" })],
  planetas: [chip(L("Polvo en Marte", "Dust on Mars"), { t: "topic", topic: "marte", where: null }), chip(L("Monitoreo de astronautas", "Astronaut monitoring"), { t: "topic", topic: "astronauta", where: null })],
  camaras: [
    chip(L("¿Hay alertas aquí?", "Any alerts here?"), { t: "topic", topic: "alertas", where: null }),
    chip(L("Infrarrojo en vivo", "Live infrared"), { t: "imagery", layer: "GOES-East_ABI_Band13_Clean_Infrared" }),
  ],
  conjunto: [
    chip(L("Ver lo significativo", "Show what is significant"), { t: "open", panel: "map", tour: "apoyado" }),
    chip(L("¿Hay alertas aquí?", "Any alerts here?"), { t: "topic", topic: "alertas", where: null }),
  ],
  alertas: [
    chip(L("Todas las señales de fauna", "All animal signals"), { t: "topic", topic: "fauna", where: null }),
    chip(L("Tormentas y eventos", "Storms and events"), { t: "topic", topic: "eventos", where: null }),
  ],
  fauna: [
    chip(L("¿Hay alertas aquí?", "Any alerts here?"), { t: "topic", topic: "alertas", where: null }),
    chip(L("Abrir Señales de fauna", "Open Animal signals"), { t: "open", panel: "fauna" }),
  ],
  red: [chip(L("Eventos naturales de la NASA", "NASA natural events"), { t: "topic", topic: "eventos", where: null })],
  eventos: [
    chip(L("Infrarrojo en vivo", "Live infrared"), { t: "imagery", layer: "GOES-East_ABI_Band13_Clean_Infrared" }),
    chip(L("Clima en Durango", "Weather in Durango"), { t: "topic", topic: "clima", where: { name: "Durango", lat: 24.02, lon: -104.67 } }),
  ],
};

/**
 * An answer that builds its own interface (Plan de unión U3). For clima and ganado, when the layer on screen
 * covers the place, HORI's long-term reading is added to the text and the figure (the «now» and the «trend» together).
 */
export function topicCard(topic: Topic, where: Where | null, ctx: Ctx, source: Source, draft: string | null = null, group: FaunaGroup | null = null): Card {
  const a = topicAnswer(topic, where, draft, group);
  const r = (topic === "clima" || topic === "ganado") && ctx.state.selection?.kind === "cell" ? readSelection(ctx) : null;
  const text = { es: { sencillo: "", normal: "", tecnico: "" }, en: { sencillo: "", normal: "", tecnico: "" } } as Card["text"];
  for (const lang of LANGS) for (const reg of REGS) {
    const trend = r ? ` ${lang === "es" ? "Y a largo plazo:" : "And in the long run:"} ${narrateTrend({ ...trendFacts(ctx, r, lang), place: where?.name ?? r.name[lang] }, lang, reg !== "sencillo")}` : "";
    text[lang][reg] = a.text[lang] + trend;
  }
  return {
    id: nextId++, kind: `topic:${topic}`, source, correctable: source === "user", action: a.action, text, origin: a.origin,
    evidence: r ? { layerId: ctx.layer!.manifest.id, selection: r.selection } : null,
    figure: r ? figureOf(ctx, r) : undefined, widgets: a.widgets, chips: TOPIC_CHIPS[topic],
  };
}

export function compose(kind: CardKind, ctx: Ctx, source: Source, extra: { correctable?: boolean } = {}): Card {
  const base = { id: nextId++, kind, source, correctable: !!extra.correctable && source === "user" };
  const ui = (es: string, en: string, list: Chip[], action: Record<Lang, string> | null = null): Card => ({
    ...base, origin: "ui", evidence: null, chips: list, action,
    text: { es: { sencillo: es, normal: es, tecnico: es }, en: { sencillo: en, normal: en, tecnico: en } },
  });
  const m = ctx.layer?.manifest;
  const sib = hasSiblings(ctx);

  // «¿Cómo se usa…?» and the product's own actions: they never need a layer on screen.
  if (kind.startsWith("howto:")) {
    const a = howtoAnswer(kind.slice(6) as HowKey);
    return ui(a.text.es, a.text.en, a.chips.map((c) => chip(L(c.label.es, c.label.en), c.intent)));
  }
  if (kind === "speed") {
    const v = ctx.state.speed;
    return ui(`Línea de tiempo a ×${num(v, "es", v % 1 ? 1 : 0)}: un año cada ${num(1.1 / v, "es", 1)} s. Pausa con ❚❚ o arrastra la barra para ir año por año.`,
      `Timeline at ×${num(v, "en", v % 1 ? 1 : 0)}: one year every ${num(1.1 / v, "en", 1)} s. Pause with ❚❚ or drag the bar to go year by year.`,
      [chip(L("Más lento", "Slower"), { t: "speed", v: "-" }), chip(L("Más rápido", "Faster"), { t: "speed", v: "+" }), chip(L("Velocidad normal", "Normal speed"), { t: "speed", v: 1 })]);
  }
  if (kind.startsWith("open:")) {
    const what = kind.slice(5);
    const T: Record<string, [string, string]> = {
      fauna: ["Abrí Señales de fauna. Pulsa «Revisar los 6 grupos»; con «Vigilar y avisarme» te aviso de lo nuevo.", "I opened Animal signals. Press «Check the 6 groups»; «Watch and notify me» tells you what is new."],
      person: ["Abrí Persona: una semana simulada (rotulada) o tu propio archivo, que no sale de tu navegador.", "I opened Person: a simulated (labelled) week or your own file, which never leaves your browser."],
      map: ["Te llevo por lo significativo: usa «Siguiente foco» o di «siguiente foco». «¿Por qué va en este orden?» muestra la cuenta.", "Touring what is significant: use «Next focus» or say «next focus». «Why this order?» shows the numbers."],
      zone: ["Abrí la zona en 3D real con el veredicto de HORI encima.", "I opened the real 3D zone with HORI's verdict on top."],
      live: ["Abrí En vivo: satélite cada 10 minutos, clima de tus lugares y eventos abiertos.", "I opened Live: satellite every 10 minutes, weather at your places and open events."],
    };
    const [es, en] = T[what] ?? T.map;
    return ui(es, en, [chip(L("¿Cómo funciona la detección?", "How does detection work?"), { t: "howto", key: "deteccion" })]);
  }
  if (kind === "gestures:on" || kind === "gestures:off") {
    return kind === "gestures:on"
      ? ui("Encendí los gestos (la cámara no sale del equipo). Clic = pellizco rápido sin mover la mano; puño = congelar el puntero; palma abierta quieta = regresar.",
        "Gestures on (the camera never leaves the device). Click = quick pinch without moving; fist = freeze the pointer; open palm held = back.",
        [chip(L("¿Por qué brinca el puntero?", "Why does the pointer jump?"), { t: "howto", key: "gestos_loco" }), chip(L("Apagar gestos", "Turn gestures off"), { t: "gestures", on: false })])
      : ui("Apagué los gestos y la cámara.", "Gestures and camera off.", [chip(L("Encender gestos", "Turn gestures on"), { t: "gestures", on: true })]);
  }
  if (!m && !["help", "advice", "cause", "profile", "done", "level", "certainty"].includes(kind) && !kind.startsWith("unknown")) {
    return ui("Cargando capa…", "Loading layer…", []);
  }

  switch (kind) {
    case "greet":
    case "area": {
      const r = readSelection(ctx);
      if (!r) return compose("summary", ctx, source, extra);
      return {
        ...base, origin: originOf(ctx), evidence: { layerId: m!.id, selection: r.selection }, figure: figureOf(ctx, r),
        limits: readingLimits(ctx, r),
        ...both((lang, reg) => ({ action: showing(ctx, lang, r.name[lang]), text: sentence(ctx, r, lang, reg) })),
        chips: r.finding.verdict === 1
          ? chips(ctx, sib && C.compare, C.certainty, C.data)
          : chips(ctx, C.detect, sib && C.compare, C.legend),
      };
    }
    case "summary": {
      const s = m!.summary;
      return {
        ...base, origin: originOf(ctx), evidence: null,
        ...both((lang) => ({
          action: showing(ctx, lang),
          text: Number.isFinite(s.probado) && Number.isFinite(s.no_concluyente)
            ? `${UI[lang].summary(count(s.probado, lang), count(s.no_concluyente, lang))} ${lang === "es" ? "Toca una zona para ver su evidencia." : "Tap an area to see its evidence."}`
            : UI[lang].selectHint,
        })),
        chips: chips(ctx, placeChip(ctx), C.onlyDetected, sib ? C.compare : C.legend),
      };
    }
    case "detect": {
      const r = readSelection(ctx);
      if (!r) return compose("noSelection", ctx, source, extra);
      const f = r.finding;
      const n = m!.window.n;
      return {
        ...base, origin: originOf(ctx), evidence: { layerId: m!.id, selection: r.selection }, figure: figureOf(ctx, r),
        limits: readingLimits(ctx, r),
        ...both((lang, reg) => {
          const mde = Number.isFinite(f.mde) ? `${num(f.mde, lang, digitsFor(reg, f.mde))} ${m!.variable.unit}` : "—";
          let text: string;
          if (f.verdict === 1) {
            text = lang === "es"
              ? `En ${r.name.es} ya se puede saber: con ${n} años se notan cambios de ${mde} o más cada 10 años, y este es mayor.`
              : `In ${r.name.en} it is already knowable: with ${n} years, changes of ${mde} or more per 10 years show up, and this one is larger.`;
          } else if (f.verdict === 2) {
            text = lang === "es"
              ? `En ${r.name.es} aún no está confirmado. Con ${n} años solo se notan con seguridad cambios de ${mde} o más cada 10 años.`
              : `In ${r.name.en} it is not confirmed yet. With ${n} years only changes of ${mde} or more per 10 years show up reliably.`;
          } else {
            text = sentence(ctx, r, lang, reg); // NO_CONCLUYENTE, SIN_CAMBIO and INSUFICIENTE already say it (SPEC §5, §8.5)
          }
          return { action: showing(ctx, lang, r.name[lang]), text };
        }),
        chips: chips(ctx, sib && C.compare, m!.windows && C.accumulated, C.legend),
      };
    }
    case "compare": {
      const sel = ctx.state.selection;
      const entry = ctx.entries.find((e) => e.id === m!.id) ?? null;
      const sibs = siblings(ctx.entries, entry);
      const region = sel?.kind === "region" ? ctx.regions.find((x) => x.id === sel.id) : null;
      if (sibs.length < 2) return compose("noWindow", ctx, source, extra);
      if (!region) {
        // Cells live in two different layers; the map shows the other window and the card says what to look at.
        return {
          ...base, origin: originOf(ctx), evidence: null,
          ...both((lang) => ({
            action: showing(ctx, lang),
            text: lang === "es"
              ? `Mostrando ${m!.window.n} años. Compara el rayado: con más años de datos se pueden notar cambios más pequeños.`
              : `Showing ${m!.window.n} years. Compare the stripes: with more years of data, smaller changes can show up.`,
          })),
          chips: chips(ctx, placeChip(ctx), C.legend, C.detect),
        };
      }
      const rows = sibs.map((e) => ({ w: entryWindow(e)!, v: region.layers[e.id]?.verdict })).filter((x) => x.v !== undefined);
      return {
        ...base, origin: originOf(ctx), evidence: { layerId: m!.id, selection: sel! },
        ...both((lang, reg) => ({
          action: showing(ctx, lang, short(region.name[lang])),
          text: rows.map((x) => `${lang === "es" ? "Con" : "With"} ${x.w.n} ${lang === "es" ? "años" : "years"}: ${verdictName(x.v as Verdict, lang, reg).toLocaleLowerCase(lang)}.`).join(" ")
            + (lang === "es" ? " Con más años de datos se notan cambios más pequeños." : " With more years of data, smaller changes show up."),
        })),
        chips: chips(ctx, m!.windows && C.accumulated, C.data, C.legend),
      };
    }
    case "contrast": {
      const s = m!.summary;
      return {
        ...base, origin: originOf(ctx), evidence: null,
        ...both((lang) => ({
          action: showing(ctx, lang),
          text: lang === "es"
            ? `Un análisis ingenuo marcaría ${count(s.naive_marked, lang)} zonas. Con la corrección por mirar muchas zonas a la vez sobreviven ${count(s.probado, lang)}.`
            : `A naive analysis would flag ${count(s.naive_marked, lang)} areas. With the correction for looking at many areas at once, ${count(s.probado, lang)} remain.`,
        })),
        chips: chips(ctx, C.legend, C.data, placeChip(ctx)),
      };
    }
    case "legend":
      return ui(
        "Sólido = cambio detectado. Punteado = posible cambio, no confirmado. Rayado = aún no se puede saber: no significa que no cambie, sino que con estos años solo se notarían cambios grandes. Gris = sin cambio de δ o más.",
        "Solid = change detected. Dotted = possible change, not confirmed. Striped = not yet knowable: it does not mean nothing changes, only that with these years only large changes would show up. Grey = no change of δ or more.",
        chips(ctx, placeChip(ctx), C.detect, C.summary),
      );
    case "provenance": {
      const d = m!.dataset;
      return {
        ...base, origin: originOf(ctx), evidence: null,
        ...both((lang, reg) => ({
          action: showing(ctx, lang),
          text: `${lang === "es" ? m!.honesty.label_es : m!.honesty.label_en}. ${d.name} · ${d.provider} · ${d.version}${reg === "sencillo" ? ""
            : ` · ${m!.grid.native_resolution_deg}° (~${Math.round(m!.grid.native_resolution_deg * 111.32)} km)`}${reg === "tecnico" ? ` · ${m!.methods.join(", ")} · α = ${m!.params.alpha} · FDR q = ${m!.params.fdr_q}` : ""}.`,
        })),
        chips: chips(ctx, C.contrast, C.summary, C.legend),
      };
    }
    case "help":
      return ui(
        "Muestro qué cambia, dónde, cuánto y si ya se puede saber, con datos de la NASA. No doy consejos ni explico por qué ocurre un cambio. También te muestro lo último que midió la NASA en un lugar, el estrés por calor del ganado, los eventos naturales abiertos, el infrarrojo en vivo, señales de fauna con avisos, el monitoreo de una persona, y escenas 3D de la Tierra y de otros mundos. Pregúntame cómo se usa cualquier parte. Puedes escribir, hablar o tocar el globo.",
        "I show what changes, where, how much and whether it is knowable yet, with NASA data. I don't give advice or explain why a change happens. I can also show the latest NASA measurements at a place, livestock heat stress, open natural events, live infrared, animal signals with notices, a person monitor, and 3D scenes of Earth and other worlds. Ask me how to use any part. You can type, speak or tap the globe.",
        [chip(L("¿Cómo funciona la detección?", "How does detection work?"), { t: "howto", key: "deteccion" }), chip(L("Recorrer lo significativo", "Tour what is significant"), { t: "open", panel: "map", tour: "apoyado" }), chip(L("Señales de fauna", "Animal signals"), { t: "open", panel: "fauna" }), chip(L("¿Qué gestos hay?", "Which gestures?"), { t: "howto", key: "gestos" }), chip(L("La evolución de la Tierra", "How Earth has changed"), { t: "evolution" })],
      );
    case "advice":
      return ui("No doy consejos. Sí puedo mostrar qué cambió en tu zona y con qué datos.", "I don't give advice. I can show what changed in your area and with what data.",
        chips(ctx, placeChip(ctx) ?? C.summary, C.data));
    case "cause":
      return ui("HORIZON detecta cambios; no explica por qué ocurren. Sí puedo mostrar qué cambió y con qué datos.", "HORIZON detects changes; it does not explain why they happen. I can show what changed and with what data.",
        chips(ctx, placeChip(ctx) ?? C.summary, C.data));
    case "unknown1":
      return ui("No lo entendí. Puedes preguntarme cómo se usa algo («¿cómo funciona la detección?», «¿cómo doy clic con gestos?») o probar:", "I didn't catch that. Ask me how to use something («how does detection work?», «how do I click with gestures?») or try:",
        chips(ctx, placeChip(ctx) ?? C.summary, chip(L("¿Cómo funciona la detección?", "How does detection work?"), { t: "howto", key: "deteccion" }), C.legend));
    case "unknown2":
      return ui("Sigo sin entenderlo. Estas son las opciones:", "I still didn't get it. These are the options:",
        [placeChip(ctx) ?? C.summary, C.detect, C.legend, C.data, C.contrast, C.help].filter(Boolean) as Chip[]);
    case "unknown3":
      return ui("Estas son todas las opciones. También puedes tocar el mapa.", "These are all the options. You can also tap the map.",
        [placeChip(ctx) ?? C.summary, C.detect, C.compare, C.legend, C.data, C.contrast].filter(Boolean) as Chip[]);
    case "noSelection":
      return ui("¿De qué zona? Toca el mapa o elige una región.", "Which area? Tap the map or choose a region.", chips(ctx, placeChip(ctx), C.summary));
    case "noWindow":
      return ui("Esta capa solo tiene una ventana de años.", "This layer has a single window of years.", chips(ctx, C.detect, C.legend));
    case "year": {
      const y = ctx.state.year;
      return ui(
        `Mostrando el año ${y ?? ""}. Es descriptivo: el color es el valor de ese año, sin veredicto.`,
        `Showing the year ${y ?? ""}. This is descriptive: colour is that year's value, with no verdict.`,
        chips(ctx, chip(L("Volver a la ventana completa", "Back to the full window"), { t: "full" }), C.legend), { es: showing(ctx, "es"), en: showing(ctx, "en") });
    }
    case "accumulated": {
      const w = m!.windows;
      if (!w) return ui("Esta capa no trae ventanas acumuladas.", "This layer has no accumulated windows.", chips(ctx, C.detect));
      const end = ctx.state.windowEnd ?? w.ends.at(-1);
      return ui(
        `Evidencia acumulada de ${w.start} a ${end}. Mueve el control para ver cuándo aparece el cambio; son ventanas anidadas, no independientes entre sí.`,
        `Accumulated evidence from ${w.start} to ${end}. Move the slider to see when the change appears; the windows are nested, not independent of each other.`,
        chips(ctx, chip(L("Volver a la ventana completa", "Back to the full window"), { t: "full" }), C.detect), { es: showing(ctx, "es"), en: showing(ctx, "en") });
    }
    case "filter": {
      const f = ctx.state.filter;
      const s = m!.summary;
      const key = ["insuficiente", "probado", "candidata", "no_concluyente", "sin_cambio"];
      if (!f) return ui("Mostrando todas las zonas.", "Showing every area.", chips(ctx, C.onlyDetected, placeChip(ctx), C.legend), { es: showing(ctx, "es"), en: showing(ctx, "en") });
      return {
        ...base, origin: originOf(ctx), evidence: null,
        ...both((lang) => ({
          action: showing(ctx, lang),
          text: (lang === "es" ? "Resaltando solo: " : "Highlighting only: ")
            + f.map((v) => `${verdictName(v as Verdict, lang, ctx.state.register).toLocaleLowerCase(lang)} (${count(s[key[v]] ?? NaN, lang)} ${lang === "es" ? "zonas" : "areas"})`).join(", ")
            + (lang === "es" ? ". Lo demás queda atenuado." : ". Everything else is dimmed."),
        })),
        chips: chips(ctx, C.showAll, placeChip(ctx), C.detect),
      };
    }
    case "world":
      return compose("summary", ctx, source, extra);
    case "imagery": {
      const l = LAYERS.find((x) => x.id === ctx.state.imagery);
      const others = LAYERS.filter((x) => x.live && x.id !== l?.id);
      return {
        ...base, origin: "zon", evidence: null,
        action: L("Monitoreo · imagen en vivo", "Monitoring · live imagery"),
        text: allRegs(l
          ? L(`Puse en el globo: ${l.title}. Es la imagen más reciente de la NASA (cada 10 minutos, con unos 30 de retraso). ${l.caveat ?? ""}`.trim(),
            `On the globe now: ${l.title}. It is NASA's latest image (every 10 minutes, about 30 behind). ${l.caveat ?? ""}`.trim())
          : L("Volví a la vista base (Blue Marble).", "Back to the base view (Blue Marble).")),
        chips: [
          ...others.slice(0, 2).map((x) => chip(L(x.title.replace("Infrarrojo en vivo · ", "Infrarrojo · "), x.title), { t: "imagery", layer: x.id })),
          chip(L("¿Qué está pasando en el mundo?", "What is happening in the world?"), { t: "topic", topic: "eventos", where: null }),
        ],
      };
    }
    case "zone": {
      const z = ctx.state.zone ?? { name: "Durango", lat: 24.02, lon: -104.67 };
      return {
        ...base, origin: "zon", evidence: null, action: L("Monitoreo · zona en 3D real", "Monitoring · real 3D zone"),
        text: allRegs(L(
          `Abrí ${z.name} en 3D real: el relieve medido y la imagen de satélite Sentinel-2 (10 m), 12 × 12 km. No es generado. Gíralo arrastrando; si quieres ver cómo se vería con sus datos de clima, abre la escena generada.`,
          `I opened ${z.name} in real 3D: measured relief and Sentinel-2 satellite imagery (10 m), 12 × 12 km. Nothing is generated. Drag to turn it; to see it with its climate data, open the generated scene.`)),
        chips: [chip(L("Escena generada con línea de tiempo", "Generated scene with timeline"), { t: "scene", where: { name: z.name, lat: z.lat, lon: z.lon }, timeline: true })],
      };
    }
    case "scene": {
      const sc = ctx.state.scene;
      if (sc?.preset) {
        const wid = (Object.keys(WORLD_PRESET) as WorldId[]).find((k) => WORLD_PRESET[k] === sc.preset);
        const wo = wid ? WORLDS[wid] : null;
        const what = sc.preset === "luna" ? L("la Luna", "the Moon") : wo ? L(wo.name.es, wo.name.en) : L("Marte", "Mars");
        const giant = sc.from ? NO_SURFACE[sc.from] : null;
        const facts = wo && wid !== "earth" ? L(` Con datos de referencia de la NASA: gravedad ${wo.facts.gravity} m/s², ${wo.facts.tempC} °C de media, ${wo.facts.atmosphere.es}.`,
          ` With NASA reference data: gravity ${wo.facts.gravity} m/s², ${wo.facts.tempC} °C on average, ${wo.facts.atmosphere.en}.`) : L("", "");
        return {
          ...base, origin: "zon", evidence: null, action: L("Monitoreo · escena 3D", "Monitoring · 3D scene"),
          text: allRegs(L(`${giant ? `${giant.es} ` : ""}Abrí la escena 3D de ${what.es}.${facts.es} Mueve las barras (hora, viento) y la escena se rehace al momento; es una ilustración, no una foto.`,
            `${giant ? `${giant.en} ` : ""}I opened the 3D scene of ${what.en}.${facts.en} Move the sliders (hour, wind) and it rebuilds right away; it illustrates, it is not a photo.`)),
          chips: [chip(L("Polvo en Marte (HORI)", "Dust on Mars (HORI)"), { t: "topic", topic: "marte", where: null })],
        };
      }
      const name = sc?.name ?? "Durango";
      return {
        ...base, origin: "zon", evidence: null,
        action: L("Monitoreo · escena 3D", "Monitoring · 3D scene"),
        text: allRegs(L(
          `Abrí la escena 3D de ${name}. Está hecha con lo último que midió la NASA (POWER) en ese punto${sc?.timeline ? ", y la línea de tiempo recorre los años con la serie de HORI" : ""}. Es una ilustración de los datos, no una foto.`,
          `I opened the 3D scene of ${name}. It is built from NASA POWER's latest values at that point${sc?.timeline ? ", and the timeline walks through the years with HORI's series" : ""}. It illustrates the data; it is not a photo.`)),
        chips: [
          chip(L("Con línea de tiempo", "With timeline"), { t: "scene", where: sc ? { name, lat: sc.lat, lon: sc.lon } : null, timeline: true }),
          chip(L("¿Mis vacas tienen calor?", "Is my cattle too hot?"), { t: "topic", topic: "ganado", where: sc ? { name, lat: sc.lat, lon: sc.lon } : null }),
        ],
      };
    }
    case "evolution": {
      const ys = m?.series?.years ?? [];
      return {
        ...base, origin: originOf(ctx), evidence: null, action: L(showing(ctx, "es"), showing(ctx, "en")),
        text: allRegs(ys.length
          ? L(`Así ha cambiado la Tierra, año por año de ${ys[0]} a ${ys.at(-1)}: cada año pinta su diferencia con lo normal de cada zona. El globo lo reproduce solo; puedes pausarlo o moverlo.`,
            `This is how Earth has changed, year by year from ${ys[0]} to ${ys.at(-1)}: each year paints its difference from what is normal for each area. The globe plays it by itself; you can pause or move it.`)
          : L("Esta capa no tiene serie por año para reproducir.", "This layer has no yearly series to play.")),
        chips: chips(ctx, C.summary, placeChip(ctx), C.legend),
      };
    }
    case "level": {
      const lv = ctx.state.register;
      return {
        ...base, origin: "ui", evidence: null,
        ...both((lang) => ({
          text: lang === "es"
            ? `Listo, modo ${UI.es.register[lv]}. Mismos datos, ${lv === "sencillo" ? "lo esencial" : lv === "normal" ? "con gráficas y comparación" : "con método y procedencia completos"}.`
            : `Done, ${UI.en.register[lv]} mode. Same data, ${lv === "sencillo" ? "just the essentials" : lv === "normal" ? "with charts and comparison" : "with full method and provenance"}.`,
        })),
        chips: chips(ctx, placeChip(ctx) ?? (m ? C.summary : null), C.certainty, C.help),
      };
    }
    case "certainty":
      // How often HORI is wrong, as measured (doc v2 §3.4). The same numbers in every level, more of them as you go deeper.
      return {
        ...base, origin: "hori", evidence: null,
        ...both((lang, reg) => ({ text: certaintyText(reg, lang) })),
        chips: chips(ctx, m && C.detect, m && C.contrast, C.help),
      };
    case "done":
      return ui("Listo.", "Done.", chips(ctx, placeChip(ctx) ?? C.summary, C.help));
    case "undo":
      return ui("¿Qué querías ver?", "What did you want to see?", chips(ctx, placeChip(ctx) ?? C.summary, C.detect, C.legend));
    case "profile":
      return ui("Ese perfil es una visión o desarrollo posterior. Por ahora el mapa muestra la Tierra.", "That profile is a vision or later development. For now the map shows Earth.",
        chips(ctx, placeChip(ctx) ?? C.summary, C.help));
    default:
      return ui("Cargando capa…", "Loading layer…", []);
  }
}

/** Plain text of a card, for speech and for the screen-reader announcement. */
export function spoken(card: Card, lang: Lang, reg: Register): string {
  return card.text[lang][reg];
}


/** One-line reading of a cell for the hover label: what it is, in words (doc 01 §1 «te lo cuenta sin ruido»). */
/**
 * What the map is painting right now for one cell (it differs from the layer in year-by-year and accumulated modes).
 * The hover label must describe THIS, never the full-window verdict, or it would contradict the map.
 */
export interface Shown { mode: "verdict" | "descriptive" | "sequential"; verdict: number; effect: number }

export function hoverText(ctx: Ctx, index: number, shown?: Shown): { title: string; line: string; where: string } | null {
  const r = readSelection(ctx, { kind: "cell", index });
  if (!r) return null;
  const { lang, register: reg } = ctx.state;
  const m = ctx.layer!.manifest;
  const es0 = lang === "es";
  const m0 = ctx.layer!.manifest;
  const sgn = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(Math.abs(x), lang, digitsFor(reg, x))}`;
  const CODE = ["INSUFICIENTE", "PROBADO", "CANDIDATA", "NO_CONCLUYENTE", "SIN_CAMBIO_MAYOR_QUE_DELTA"];
  // Experto metrics (full window): describe the metric the map is painting.
  if (ctx.state.timeMode === "completa" && ctx.state.metric !== "verdict" && shown) {
    const f0 = r.finding;
    const where = capitalise(r.name[lang]);
    if (ctx.state.metric === "effect") {
      return { where, title: es0 ? "Efecto estimado" : "Estimated effect",
        line: Number.isFinite(f0.effect) ? `${sgn(f0.effect)} ${m0.variable.unit_per_decade} · ${CODE[f0.verdict]}` : (es0 ? "Sin dato" : "No data") };
    }
    if (ctx.state.metric === "mde") {
      return { where, title: es0 ? "Mínimo detectable (MDE)" : "Minimum detectable effect (MDE)",
        line: Number.isFinite(f0.mde) ? `${num(f0.mde, lang, digitsFor(reg, f0.mde))} ${m0.variable.unit_per_decade} · n = ${m0.window.n}` : (es0 ? "Sin dato" : "No data") };
    }
    const y = f0.yearsMore;
    return { where, title: es0 ? "Años que faltan" : "Years still needed",
      line: y === null ? (es0 ? "No aplica: aquí no es «aún no se puede saber»" : "Not applicable: this area is not “not yet knowable”")
        : y === 255 ? (es0 ? "Más de 60 años" : "More than 60 years") : `~${Math.round(y)} ${es0 ? "años" : "years"}` };
  }
  if (shown?.mode === "descriptive") {
    const y = ctx.state.year ?? m.series?.years.at(-1);
    const v = shown.effect;
    return {
      where: capitalise(r.name[lang]),
      title: `${es0 ? "Valor en" : "Value in"} ${y}`,
      line: Number.isFinite(v)
        ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), lang, digitsFor(reg, v))} ${m.variable.unit} · ${es0 ? "descriptivo, sin veredicto" : "descriptive, no verdict"}`
        : (es0 ? "Sin dato ese año" : "No data that year"),
    };
  }
  if (ctx.state.timeMode === "acumulada" && shown) {
    const end = ctx.state.windowEnd ?? m.windows?.ends.at(-1);
    return {
      where: capitalise(r.name[lang]),
      title: verdictName(shown.verdict as Verdict, lang, reg),
      line: es0 ? `Con los datos de ${m.windows?.start ?? m.window.start} a ${end}` : `With data from ${m.windows?.start ?? m.window.start} to ${end}`,
    };
  }
  const f = r.finding;
  const u = m.variable.unit;
  const n = m.window.n;
  const val = (x: number) => `${num(Math.abs(x), lang, digitsFor(reg, x))} ${u}`;
  const es = lang === "es";
  let line: string;
  if (reg === "tecnico") {
    const parts = [
      Number.isFinite(f.effect) ? `${sgn(f.effect)} ${m.variable.unit_per_decade}` : null,
      Number.isFinite(f.ci[0]) ? `[${sgn(f.ci[0])}, ${sgn(f.ci[1])}]` : null,
      Number.isFinite(f.q) ? `q ${num(f.q, lang, 3)}` : null,
      Number.isFinite(f.mde) ? `MDE ${num(f.mde, lang, digitsFor(reg, f.mde))}` : null,
    ].filter(Boolean);
    return { title: `${LEGEND[lang][f.verdict].phrase} · ${CODE[f.verdict]}`, line: parts.join(" · ") || (es ? "Sin dato" : "No data"), where: capitalise(r.name[lang]) };
  }
  switch (f.verdict) {
    case 1:
      line = es ? `${f.effect > 0 ? "Sube" : "Baja"} unos ${val(f.effect)} cada 10 años` : `${f.effect > 0 ? "Rising" : "Falling"} about ${val(f.effect)} every 10 years`;
      break;
    case 2:
      line = es ? "Hay indicios, pero aún no se confirma" : "There are hints, but it is not confirmed yet";
      break;
    case 3:
      line = es ? `Con ${n} años solo se notarían cambios de ${val(f.mde)} o más` : `With ${n} years only changes of ${val(f.mde)} or more would show`;
      break;
    case 4:
      line = es ? "Ningún cambio grande en estos años" : "No large change in these years";
      break;
    default:
      line = es ? "No hay suficientes años con datos" : "Not enough years with data";
  }
  return { title: verdictName(f.verdict, lang, reg), line, where: capitalise(r.name[lang]) };
}
