// Deterministic intent parser (no LLM: SANTUARIO H17, web-diseno §3.3). Same input → same intent, always.
// It understands Spanish and English at the same time, whatever the interface language is.

import type { Region } from "@/contract/types";
import type { FaunaGroup } from "@/core/live/fauna";
import type { Register } from "@/core/i18n/texts";
import { findPlace, type Where } from "@/core/genui/places";
import { P, normalize } from "./patterns";
import { worldRequest } from "@/core/scene/worlds";
import { type HowKey, howtoOf, speedOf } from "./howto";

/** «abre / muestra / revisa …» + a section of the product: open it directly. */
const OPEN_PANEL = /\b(abre|abrir|open)\b/;
const OPEN_VERB = /\b(abre|abrir|muestra|muestrame|ver|ve|revisa|vigila|vigilar|ensename|open|show|check|watch)\b/;
const FAUNA = /\b(fauna|animales|aves|pajaros|mariposas|anfibios|insectos|mamiferos|reptiles|senales de fauna|wildlife|birds|animal signals)\b/;
/** Which group of animals a question names (null = all six). */
export function faunaGroupOf(text: string): FaunaGroup | null {
  return /\b(mariposas?|polillas?|butterfl\w*|moths?)\b/.test(text) ? "mariposas"
    : /\b(aves?|pajar\w*|birds?)\b/.test(text) ? "aves"
    : /\b(mamifer\w*|mammals?)\b/.test(text) ? "mamiferos"
    : /\b(anfibios?|ranas?|sapos?|amphibians?|frogs?|toads?)\b/.test(text) ? "anfibios"
    : /\b(reptil\w*|lagart\w*|serpientes?|viboras?|snakes?|lizards?)\b/.test(text) ? "reptiles"
    : /\b(insect\w*|abejas?|bees?)\b/.test(text) ? "insectos"
    : null;
}
const PERSON = /\b(persona|ritmo cardiaco|frecuencia cardiaca|mi pulso|person|heart rate)\b/;
const FOCI = /\b(focos?|lo significativo|significativo|foci)\b/;
const GESTURES_ON = /\b(enciende|activa|prende|usar|turn on)\b.*\bgestos?\b|\bgestures? on\b/;
const GESTURES_OFF = /\b(apaga|desactiva|quita)\b.*\bgestos?\b|\bgestures? off\b/;

/** Verbs of going to / building a world (input vocabulary, never shown). */
const TRAVEL = /\b(llevame|muestrame|muestra|ve a|vamos a|viaja|viajar|visita|como se ve|como es|genera|modela|crea|construye|take me|show me|go to|fly to|build|model)\b/;

export type Intent =
  | { t: "greet" }
  | { t: "help" }
  | { t: "advice" }
  | { t: "cause" }
  | { t: "summary" }
  | { t: "area" }
  | { t: "legend" }
  | { t: "contrast" }
  | { t: "provenance" }
  | { t: "detect" }
  | { t: "compare" }
  | { t: "window"; n: number }
  | { t: "year"; y: number | null }
  | { t: "accumulated"; end: number | null }
  | { t: "full" }
  | { t: "register"; r: Register | "+" | "-" }
  | { t: "certainty" }
  | { t: "lang"; l: "es" | "en" }
  | { t: "theme"; th: "light" | "dark" }
  | { t: "profile"; p: "mars" | "person" | "earth" }
  | { t: "filter"; verdicts: number[] | null }
  | { t: "world" }
  | { t: "undo" }
  | { t: "clear" }
  | { t: "topic"; topic: Topic; where: Where | null; group?: FaunaGroup | null; /** The words said, for components that pick from them. */ hint?: string }
  | { t: "imagery"; layer: string }
  | { t: "evolution" }
  | { t: "variable"; v: "T2M" | "PRECTOTCORR" }
  | { t: "report"; text: string; where: Where | null }
  | { t: "scene"; where: Where | null; timeline: boolean; /** A world of the modeler (core/scene/worlds.ts → presets.ts). */ preset?: string | null; /** The real place (relief + satellite), not the generated diorama. */ real?: boolean;
      /** A giant without surface was asked for (jupiter, saturno…): the answer says so and shows its moon. */ from?: string }
  /** «¿Cómo se usa…?»: the assistant explains a part of the product and offers the action (howto.ts). */
  | { t: "howto"; key: HowKey }
  /** Open a section of the side panel; on the map, optionally start the tour of the foci. */
  | { t: "open"; panel: "fauna" | "person" | "zone" | "map" | "live"; tour?: "apoyado" | "no_se_sabe" }
  /** Timeline speed: an absolute factor or one step slower / faster. */
  | { t: "speed"; v: number | "+" | "-" }
  | { t: "gestures"; on: boolean }
  | { t: "unknown" };

/** What the answer is about when it brings its own components (clima, ganado, astronauta, Marte, planetas, eventos). */
export type Topic = "clima" | "ganado" | "astronauta" | "marte" | "planetas" | "eventos" | "red" | "alertas" | "fauna" | "camaras" | "conjunto";

/** What a command may carry besides its intent: a place to look at first. */
export type Place = { kind: "region"; id: string } | { kind: "coord"; lat: number; lon: number } | null;

export interface Command { intent: Intent; place: Place; /** The named place, for follow-ups («¿y en Chihuahua?»). */ where?: Where | null }

function findRegion(text: string, regions: Region[]): string | null {
  for (const r of regions) {
    for (const name of [r.name.es, r.name.en, r.id]) {
      // "Durango (simulado)" → "durango": the first word(s) before any parenthesis.
      const key = normalize(name.replace(/\(.*\)/, ""));
      if (key && new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(text)) return r.id;
    }
  }
  return null;
}

function findCoord(text: string): { lat: number; lon: number } | null {
  const m = text.match(P.coord);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2] === "s") lat = -Math.abs(lat);
  if (m[4] === "o" || m[4] === "w") lon = -Math.abs(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function filterOf(text: string): number[] | null {
  if (P.fNoChange.test(text)) return [4];
  if (P.fUnknown.test(text)) return [3];
  if (P.fPossible.test(text)) return [2];
  if (P.fDetected.test(text)) return [1];
  return null;
}

/** A place for a live question: a named city, else the coordinates typed, else none (the caller picks a default). */
export function whereOf(raw: string, place: Place): Where | null {
  const named = findPlace(raw);
  if (named) return named;
  return place?.kind === "coord" ? { name: `${place.lat.toFixed(2)}°, ${place.lon.toFixed(2)}°`, lat: place.lat, lon: place.lon } : null;
}

export function parse(raw: string, regions: Region[]): Command {
  const text = normalize(raw);
  const regionId = findRegion(text, regions);
  // Regions from the bundle first; then coordinates; then the gazetteer of known places (Chihuahua, Torreón…).
  const named = regionId ? null : findPlace(raw);
  const coord = regionId ? null : findCoord(text) ?? (named ? { lat: named.lat, lon: named.lon } : null);
  const place: Place = regionId ? { kind: "region", id: regionId } : coord ? { kind: "coord", ...coord } : null;
  const year = text.match(P.year);
  const win = text.match(P.window);
  const world = worldRequest(text);
  const speed = speedOf(text);
  const how = world?.preset && TRAVEL.test(text) ? null : howtoOf(text, true);
  const lenient = howtoOf(text, false);

  // Order matters: limits first (advice, causes), then questions, then commands, then a bare place.
  const intent: Intent =
    !text ? { t: "unknown" }
    : P.report.test(text) ? { t: "report", text: raw.replace(/^\s*(quiero reportar|reporta(r)?|reporte|aviso|i want to report|report)\s*(:|que)?\s*/i, "").trim(), where: whereOf(raw, place) }
    : P.swarm.test(text) ? { t: "topic", topic: "red", where: whereOf(raw, place) }
    : P.advice.test(text) ? { t: "advice" }
    : P.cause.test(text) ? { t: "cause" }
    : P.undo.test(text) ? { t: "undo" }
    : P.clear.test(text) ? { t: "clear" }
    : P.unfilter.test(text) ? { t: "filter", verdicts: null }
    : P.only.test(text) && filterOf(text) ? { t: "filter", verdicts: filterOf(text) }
    // The product explains itself first («¿cómo doy clic con gestos?»), then the direct actions it can take.
    : speed !== null ? { t: "speed", v: speed }
    : GESTURES_OFF.test(text) ? { t: "gestures", on: false }
    : GESTURES_ON.test(text) ? { t: "gestures", on: true }
    : how ? { t: "howto", key: how }
    // «¿hay alertas por mi casa?», «¿algo raro aquí?»: everything watched around the place, each anomaly with its component
    : P.alerts.test(text) ? { t: "topic", topic: "alertas", where: whereOf(raw, place) }
    // «cámara de la ISS», «¿cómo se ve el cielo ahora?»: the live views
    : P.cameras.test(text) ? { t: "topic", topic: "camaras", where: whereOf(raw, place), hint: text }
    // «¿qué cambia junto?», «más calor y menos nieve»: HORI's joint change
    : P.joint.test(text) ? { t: "topic", topic: "conjunto", where: null, hint: text }
    // «abre señales de fauna» opens the panel; «muéstrame las aves» prints the card here
    : (OPEN_PANEL.test(text) || /(panel|senales de fauna|animal signals)/.test(text)) && FAUNA.test(text) ? { t: "open", panel: "fauna" }
    : (FAUNA.test(text) || faunaGroupOf(text)) && !P.livestock.test(text) ? { t: "topic", topic: "fauna", where: whereOf(raw, place), group: faunaGroupOf(text) }
    : OPEN_VERB.test(text) && PERSON.test(text) ? { t: "open", panel: "person" }
    : OPEN_VERB.test(text) && FOCI.test(text) ? { t: "open", panel: "map", tour: /(no se sabe|not known)/.test(text) ? "no_se_sabe" : "apoyado" }
    : P.help.test(text) ? { t: "help" }
    : P.legend.test(text) ? { t: "legend" }
    : P.contrast.test(text) ? { t: "contrast" }
    : P.certainty.test(text) ? { t: "certainty" }
    : P.provenance.test(text) ? { t: "provenance" }
    : P.detect.test(text) ? { t: "detect" }
    : P.compare.test(text) ? { t: "compare" }
    : P.accumulated.test(text) ? { t: "accumulated", end: year ? Number(year[1]) : null }
    : P.yearMode.test(text) ? { t: "year", y: year ? Number(year[1]) : null }
    : P.full.test(text) ? { t: "full" }
    : win ? { t: "window", n: Number(win[1]) }
    : P.english.test(text) ? { t: "lang", l: "en" }
    : P.spanish.test(text) ? { t: "lang", l: "es" }
    : P.deeper.test(text) ? { t: "register", r: "+" }
    : P.simpler.test(text) ? { t: "register", r: "-" }
    : P.normal.test(text) ? { t: "register", r: "normal" }
    : P.expert.test(text) ? { t: "register", r: "tecnico" }
    : P.plain.test(text) ? { t: "register", r: "sencillo" }
    : P.dark.test(text) ? { t: "theme", th: "dark" }
    : P.light.test(text) ? { t: "theme", th: "light" }
    // The modeler: «llévame a Venus», «genera Titán en 3D», «cómo se ve Europa» → that world (a giant: its moon, said honestly).
    : (world?.preset && (P.scene.test(text) || TRAVEL.test(text))) ? { t: "scene", where: null, timeline: false, preset: world.preset || null, real: false, from: world.from }
    : P.scene.test(text) ? { t: "scene", where: whereOf(raw, place), timeline: P.timeline.test(text) || P.evolution.test(text), preset: P.mars.test(text) ? "marte" : /\b(luna|moon)\b/.test(text) ? "luna" : null, real: !/(escena|diorama|maqueta|paisaje|generad|scene|linea de(l)? tiempo|timeline|evolucion|marte|mars|luna|moon)/.test(text) }
    : P.evolution.test(text) || P.timeline.test(text) ? { t: "evolution" }
    : P.infrared.test(text) && !P.events.test(text) ? { t: "imagery", layer: "GOES-East_ABI_Band13_Clean_Infrared" }
    : P.livestock.test(text) ? { t: "topic", topic: "ganado", where: whereOf(raw, place) }
    : P.astronaut.test(text) ? { t: "topic", topic: "astronauta", where: null }
    : P.mars.test(text) ? { t: "topic", topic: "marte", where: null }
    : P.planets.test(text) ? { t: "topic", topic: "planetas", where: null }
    : P.events.test(text) ? { t: "topic", topic: "eventos", where: whereOf(raw, place) }
    : P.weatherNow.test(text) ? { t: "topic", topic: "clima", where: whereOf(raw, place) }
    : P.rainVar.test(text) ? { t: "variable", v: "PRECTOTCORR" }
    : P.tempVar.test(text) && !P.livestock.test(text) ? { t: "variable", v: "T2M" }
    : P.person.test(text) && !place ? { t: "profile", p: "person" }
    : P.earth.test(text) ? { t: "profile", p: "earth" }
    : place ? { t: "area" }
    : P.world.test(text) ? { t: "world" }
    : P.summary.test(text) ? { t: "summary" }
    : year ? { t: "year", y: Number(year[1]) }
    : P.greet.test(text) ? { t: "greet" }
    // Nothing else understood it: if it names a part of the product, explain that part instead of «no entendí».
    : lenient ? { t: "howto", key: lenient }
    : { t: "unknown" };

  // «¿Qué cambió en Durango?» is about the place, not the whole map.
  const where = whereOf(raw, place);
  if (intent.t === "summary" && place) return { intent: { t: "area" }, place, where };
  return { intent, place, where };
}
