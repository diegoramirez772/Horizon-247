// Voice control of the generated scene (doc «Interacción v2» §2.6): every object in the diorama is driven by readings
// or is an entity (cattle, people, devices), so controlling an object = changing what drives it or the entity itself.
//   «más lluvia», «temperatura a 35», «apaga el fuego», «de noche», «agrega 5 vacas», «quita el dron»,
//   «¿qué mueve el pasto?», «muestra la sequía».
// Pure and deterministic (H19): text already normalized with digits → a new spec + what to say. Anything changed by
// voice is marked «simulada · ajustado por voz», so the legend never presents it as observed (H5).

import { normalize } from "@/core/assistant/patterns";
import type { SceneElement } from "./compose";
import type { Body, DeviceType, Entity, Role, SceneSpec, Species, VarKey } from "./spec";
import { VAR_INFO } from "./spec";

export interface SceneCommandResult {
  spec?: SceneSpec;
  presetId?: string;
  /** Element to highlight in «Qué se ve y por qué». */
  focus?: string;
  say: { es: string; en: string };
}

const VARS: [VarKey, string[]][] = [
  ["soil_moisture", ["humedad del suelo", "suelo", "soil moisture", "soil"]],
  ["rh_pct", ["humedad del aire", "humedad relativa", "humedad", "humidity"]],
  ["temp_c", ["temperatura", "calor", "temperature", "heat"]],
  ["precip_mm_h", ["lluvia", "llueve", "lluvias", "rain"]],
  ["cloud_frac", ["nubosidad", "nubes", "nublado", "clouds", "cloud"]],
  ["wind_ms", ["viento", "wind"]],
  ["ndvi", ["vegetacion", "pasto", "verde", "verdor", "ndvi", "vegetation", "grass"]],
  ["spi", ["indice de sequia", "sequia", "spi", "drought index", "drought"]],
  ["fire_frp_mw", ["fuego", "incendio", "llamas", "fire", "flames"]],
  ["burned_frac", ["area quemada", "quemado", "burned"]],
  ["flood_frac", ["inundacion", "flood"]],
  ["snow_frac", ["nieve en el suelo", "nieve", "snow"]],
  ["dust_tau", ["tormenta de polvo", "polvo en marte", "dust storm"]],
  ["aod", ["humo", "polvo", "aerosol", "neblina", "smoke", "dust", "haze"]],
  ["hour", ["hora", "hour", "time"]],
];

const UP = ["sube", "subele", "aumenta", "mas", "incrementa", "pon mas", "increase", "raise", "more", "turn up"];
const DOWN = ["baja", "bajale", "reduce", "disminuye", "menos", "decrease", "lower", "less", "turn down"];
const OFF = ["apaga", "quita", "sin", "elimina", "para", "deten", "no hay", "turn off", "remove", "stop"];
const MAXW = ["maximo", "al maximo", "max", "maximum"];
const ADD = ["agrega", "anade", "pon", "mete", "suma", "add", "put"];
const REMOVE = ["quita", "saca", "elimina", "borra", "remove", "take away", "delete"];
const ASK = ["que mueve", "por que hay", "por que se ve", "que es", "explica", "de donde sale", "que hace", "what drives", "why is there", "explain", "what is"];
const SHOW = ["muestra", "muestrame", "ve a", "abre", "escena", "situacion", "cambia a", "show", "open", "go to", "scene"];

const TIMES: [string[], number][] = [
  [["de noche", "noche", "medianoche", "at night", "night", "midnight"], 22],
  [["amanecer", "de madrugada", "sunrise", "dawn"], 6.5],
  [["mediodia", "de dia", "noon", "daytime"], 12],
  [["atardecer", "tarde", "sunset", "evening"], 18.5],
];

const SPECIES: [Species, string[]][] = [
  ["becerro", ["becerros", "becerro", "becerras", "becerra", "calves", "calf"]],
  ["vaca", ["vacas", "vaca", "reses", "res", "ganado", "cows", "cow", "cattle"]],
  ["toro", ["toros", "toro", "bulls", "bull"]],
  ["borrego", ["borregos", "borrego", "ovejas", "oveja", "sheep"]],
  ["cabra", ["cabras", "cabra", "chivos", "chivo", "goats", "goat"]],
  ["caballo", ["caballos", "caballo", "yeguas", "yegua", "horses", "horse"]],
];
const ROLES: [Role, string[]][] = [
  ["vaquero", ["vaqueros", "vaquero", "cowboys", "cowboy"]],
  ["agricultor", ["agricultores", "agricultor", "campesinos", "campesino", "farmers", "farmer"]],
  ["brigadista", ["brigadistas", "brigadista", "bomberos", "bombero", "firefighters", "firefighter"]],
  ["astronauta", ["astronautas", "astronauta", "astronauts", "astronaut"]],
  ["cientifico", ["cientificos", "cientifico", "cientificas", "cientifica", "scientists", "scientist"]],
  ["habitante", ["personas", "persona", "gente", "habitantes", "habitante", "people", "person"]],
];
const DEVICES: [DeviceType, string[]][] = [
  ["panel_solar", ["paneles solares", "panel solar", "paneles", "solar panels", "solar panel"]],
  ["sensor_suelo", ["sensores de suelo", "sensor de suelo", "sensores", "sensor", "soil sensor"]],
  ["estacion", ["estacion meteorologica", "estacion", "weather station", "station"]],
  ["molino", ["molinos", "molino", "windmill"]],
  ["bebedero", ["bebederos", "bebedero", "abrevadero", "trough"]],
  ["corral", ["corrales", "corral", "pen"]],
  ["casa", ["casas", "casa", "house"]],
  ["rover", ["rovers", "rover"]],
  ["modulo", ["modulos", "modulo", "habitat", "module"]],
  ["dron", ["drones", "dron", "drone"]],
  ["presa", ["presas", "presa", "dam"]],
];

const has = (t: string, w: string) => ` ${t} `.includes(` ${w} `);
const first = (t: string, ws: string[]) => ws.find((w) => has(t, w)) ?? null;

function findVar(t: string, body: Body): VarKey | null {
  for (const [k, words] of VARS) {
    if (k === "dust_tau" && body !== "mars") continue;
    if (k === "aod" && body === "mars" && first(t, words)) return "dust_tau";
    if (first(t, words)) return k;
  }
  return null;
}

function numberIn(t: string): number | null {
  const m = t.match(/(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function fmt(k: VarKey, v: number): string {
  const info = VAR_INFO[k];
  if (k.endsWith("_frac") || k === "cloud_frac") return `${Math.round(v * 100)} %`;
  const r = Math.round(v / info.step) * info.step;
  return `${Number(r.toFixed(2))}${info.unit ? ` ${info.unit}` : ""}`;
}

function setVar(spec: SceneSpec, k: VarKey, value: number): SceneSpec {
  const info = VAR_INFO[k];
  const v = Math.max(info.min, Math.min(info.max, Math.round(value / info.step) * info.step));
  return { ...spec, vars: { ...spec.vars, [k]: { value: Number(v.toFixed(4)), unit: info.unit, source: "ajustado por voz", kind: "simulada" } } };
}

function current(spec: SceneSpec, k: VarKey): number {
  const info = VAR_INFO[k];
  return spec.vars[k]?.value ?? (k === "spi" || k.endsWith("_frac") || k === "fire_frp_mw" || k === "precip_mm_h" || k === "aod" ? 0 : (info.min + info.max) / 2);
}

/** Percent and fraction variables may be said in % («nubes al 80») — 0…1 internally. */
function scaleSaid(k: VarKey, n: number): number {
  return (k.endsWith("_frac") || k === "cloud_frac") && n > 1 ? n / 100 : n;
}

type EntityMatch = { kind: "ganado"; key: Species } | { kind: "personas"; key: Role } | { kind: "dispositivo"; key: DeviceType };

function findEntity(t: string): { m: EntityMatch; word: string } | null {
  for (const [key, ws] of SPECIES) { const w = first(t, ws); if (w) return { m: { kind: "ganado", key }, word: w }; }
  for (const [key, ws] of ROLES) { const w = first(t, ws); if (w) return { m: { kind: "personas", key }, word: w }; }
  for (const [key, ws] of DEVICES) { const w = first(t, ws); if (w) return { m: { kind: "dispositivo", key }, word: w }; }
  return null;
}

function sameEntity(e: Entity, m: EntityMatch): boolean {
  return (e.kind === "ganado" && m.kind === "ganado" && e.species === m.key)
    || (e.kind === "personas" && m.kind === "personas" && e.role === m.key)
    || (e.kind === "dispositivo" && m.kind === "dispositivo" && e.type === m.key);
}

function countOf(e: Entity): number { return e.kind === "dispositivo" ? e.count ?? 1 : e.count; }

function withCount(spec: SceneSpec, m: EntityMatch, next: (cur: number) => number): { spec: SceneSpec; before: number; after: number } {
  const i = spec.entities.findIndex((e) => sameEntity(e, m));
  const before = i >= 0 ? countOf(spec.entities[i]) : 0;
  const cap = m.kind === "dispositivo" ? 6 : m.kind === "personas" ? 12 : 40; // vertex budget of the 2-core laptop
  const after = Math.max(0, Math.min(cap, Math.round(next(before))));
  const entities = spec.entities.slice();
  if (i >= 0) {
    if (after === 0) entities.splice(i, 1);
    else entities[i] = { ...entities[i], count: after } as Entity;
  } else if (after > 0) {
    entities.push(m.kind === "ganado" ? { kind: "ganado", species: m.key, count: after } : m.kind === "personas" ? { kind: "personas", role: m.key, count: after } : { kind: "dispositivo", type: m.key, count: after });
  }
  return { spec: { ...spec, entities }, before, after };
}

/**
 * Interprets one utterance for the scene. `t` must be normalized with digits (spokenToDigits). Returns null when
 * the text is not about the scene (the caller then tries the rest: interface, assistant…).
 */
export function sceneCommand(t: string, spec: SceneSpec, elements: SceneElement[], presets: { id: string; label: string }[]): SceneCommandResult | null {
  // 1) a situation: «muestra la sequía», or its exact name
  for (const p of presets) {
    const name = normalize(p.label);
    const id = normalize(p.id);
    const named = t === name || t === id || (first(t, SHOW) && (has(t, id) || t.includes(name)));
    if (named) return { presetId: p.id, say: { es: `Escena: ${p.label}.`, en: `Scene: ${p.label}.` } };
  }

  // 2) asking about an object: «¿qué mueve el pasto?», «explica el fuego»
  if (first(t, ASK) || t.startsWith("por que")) {
    const el = elements.find((e) => t.includes(normalize(e.label)) || has(t, normalize(e.id)) || normalize(e.label).split(" ").some((w) => w.length > 3 && has(t, w)));
    if (el) {
      const readings = el.drivenBy.map((k) => {
        const r = spec.vars[k];
        return r ? `${VAR_INFO[k].label} ${fmt(k, r.value)} (${r.kind})` : `${VAR_INFO[k].label} (valor típico)`;
      }).join(", ");
      return { focus: el.id, say: { es: `${el.label}: ${el.rule}. Lo mueve: ${readings}.`, en: `${el.label}: ${el.rule}. Driven by: ${readings}.` } };
    }
  }

  // 3) time of day: «de noche», «hora 18»
  for (const [ws, h] of TIMES) {
    if (first(t, ws) && !first(t, SHOW) && !findVar(t.replace(/\bhora\b/, ""), spec.body)) {
      return { spec: setVar(spec, "hour", h), focus: undefined, say: { es: `Hora solar ${fmt("hour", h)}.`, en: `Solar hour ${fmt("hour", h)}.` } };
    }
  }

  // 4) entities: «agrega 5 vacas», «quita el dron», «más caballos», «3 vaqueros»
  const ent = findEntity(t);
  if (ent) {
    const n = numberIn(t);
    const add = first(t, ADD), rem = first(t, REMOVE), more = first(t, UP), less = first(t, DOWN);
    let r: ReturnType<typeof withCount> | null = null;
    if (rem && !add) r = withCount(spec, ent.m, (c) => (n !== null ? c - n : 0));
    else if (add) r = withCount(spec, ent.m, (c) => c + (n ?? 1));
    else if (more) r = withCount(spec, ent.m, (c) => c + (n ?? Math.max(1, Math.round(c * 0.5))));
    else if (less) r = withCount(spec, ent.m, (c) => c - (n ?? Math.max(1, Math.round(c * 0.5))));
    else if (n !== null) r = withCount(spec, ent.m, () => n);
    if (r) {
      const word = ent.word;
      return {
        spec: r.spec,
        say: r.after === r.before
          ? { es: `Sin cambio: ${r.after} ${word} (límite de esta escena).`, en: `No change: ${r.after} ${word} (limit of this scene).` }
          : { es: `${word[0].toUpperCase()}${word.slice(1)}: ${r.before} → ${r.after}. Simulado.`, en: `${word}: ${r.before} → ${r.after}. Simulated.` },
      };
    }
  }

  // 5) a reading: «más lluvia», «temperatura a 35», «apaga el fuego», «nubes al 80», «viento al máximo»
  const k = findVar(t, spec.body);
  if (!k) return null;
  const info = VAR_INFO[k];
  const cur = current(spec, k);
  const n = numberIn(t);
  // «más sequía» means a LOWER drought index (SPI ≤ −1 is drought, McKee 1993)
  const inverted = k === "spi" && !!first(t, ["sequia", "drought"]);
  const big = has(t, "mucho") || has(t, "much") || has(t, "a lot") ? 2 : 1;
  let next: number | null = null;
  if (n !== null && k !== "hour") next = scaleSaid(k, n);
  else if (n !== null && k === "hour") next = n;
  else if (first(t, MAXW)) next = info.max;
  else if (first(t, OFF) && !first(t, UP)) next = k === "spi" ? 0 : info.min;
  else if (first(t, UP)) next = cur + (info.max - info.min) * 0.15 * big * (inverted ? -1 : 1);
  else if (first(t, DOWN)) next = cur - (info.max - info.min) * 0.15 * big * (inverted ? -1 : 1);
  if (next === null) return null;
  const s2 = setVar(spec, k, next);
  const after = s2.vars[k]!.value;
  const el = elements.find((e) => e.drivenBy.includes(k));
  return {
    spec: s2,
    focus: el?.id,
    say: { es: `${info.label}: ${fmt(k, cur)} → ${fmt(k, after)}. Valor simulado.`, en: `${info.label}: ${fmt(k, cur)} → ${fmt(k, after)}. Simulated value.` },
  };
}
