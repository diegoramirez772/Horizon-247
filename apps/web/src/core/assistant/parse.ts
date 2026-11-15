// Deterministic intent parser (no LLM: SANTUARIO H17, web-diseno §3.3). Same input → same intent, always.
// It understands Spanish and English at the same time, whatever the interface language is.

import type { Region } from "@/contract/types";
import type { Register } from "@/core/i18n/texts";
import { findPlace, type Where } from "@/core/genui/places";
import { P, normalize } from "./patterns";

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
  | { t: "topic"; topic: Topic; where: Where | null }
  | { t: "imagery"; layer: string }
  | { t: "evolution" }
  | { t: "unknown" };

/** What the answer is about when it brings its own components (clima, ganado, astronauta, Marte, planetas, eventos). */
export type Topic = "clima" | "ganado" | "astronauta" | "marte" | "planetas" | "eventos";

/** What a command may carry besides its intent: a place to look at first. */
export type Place = { kind: "region"; id: string } | { kind: "coord"; lat: number; lon: number } | null;

export interface Command { intent: Intent; place: Place }

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
function whereOf(raw: string, place: Place): Where | null {
  const named = findPlace(raw);
  if (named) return named;
  return place?.kind === "coord" ? { name: `${place.lat.toFixed(2)}°, ${place.lon.toFixed(2)}°`, lat: place.lat, lon: place.lon } : null;
}

export function parse(raw: string, regions: Region[]): Command {
  const text = normalize(raw);
  const regionId = findRegion(text, regions);
  const coord = regionId ? null : findCoord(text);
  const place: Place = regionId ? { kind: "region", id: regionId } : coord ? { kind: "coord", ...coord } : null;
  const year = text.match(P.year);
  const win = text.match(P.window);

  // Order matters: limits first (advice, causes), then questions, then commands, then a bare place.
  const intent: Intent =
    !text ? { t: "unknown" }
    : P.advice.test(text) ? { t: "advice" }
    : P.cause.test(text) ? { t: "cause" }
    : P.undo.test(text) ? { t: "undo" }
    : P.clear.test(text) ? { t: "clear" }
    : P.unfilter.test(text) ? { t: "filter", verdicts: null }
    : P.only.test(text) && filterOf(text) ? { t: "filter", verdicts: filterOf(text) }
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
    : P.evolution.test(text) ? { t: "evolution" }
    : P.infrared.test(text) && !P.events.test(text) ? { t: "imagery", layer: "GOES-East_ABI_Band13_Clean_Infrared" }
    : P.livestock.test(text) ? { t: "topic", topic: "ganado", where: whereOf(raw, place) }
    : P.astronaut.test(text) ? { t: "topic", topic: "astronauta", where: null }
    : P.mars.test(text) ? { t: "topic", topic: "marte", where: null }
    : P.planets.test(text) ? { t: "topic", topic: "planetas", where: null }
    : P.events.test(text) ? { t: "topic", topic: "eventos", where: whereOf(raw, place) }
    : P.weatherNow.test(text) ? { t: "topic", topic: "clima", where: whereOf(raw, place) }
    : P.person.test(text) && !place ? { t: "profile", p: "person" }
    : P.earth.test(text) ? { t: "profile", p: "earth" }
    : place ? { t: "area" }
    : P.world.test(text) ? { t: "world" }
    : P.summary.test(text) ? { t: "summary" }
    : year ? { t: "year", y: Number(year[1]) }
    : P.greet.test(text) ? { t: "greet" }
    : { t: "unknown" };

  // «¿Qué cambió en Durango?» is about the place, not the whole map.
  if (intent.t === "summary" && place) return { intent: { t: "area" }, place };
  return { intent, place };
}
