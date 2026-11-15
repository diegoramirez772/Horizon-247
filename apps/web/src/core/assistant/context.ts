// Follow-ups (the assistant remembers the last question): «¿y en Chihuahua?», «¿y la lluvia?», «y en 3D».
// Pure: the previous command + the new one → what the new one means. Only fills what the new one leaves out;
// anything it says explicitly wins.

import type { Command, Intent } from "./parse";
import { P, normalize } from "./patterns";

/** Intents that are about a place and can be repeated somewhere else. */
const PLACE_TOPICS = new Set(["clima", "ganado", "eventos"]);

export function followUp(prev: Command | null, next: Command, raw: string): Command {
  if (!prev) return next;
  const text = normalize(raw);
  const p = prev.intent, n = next.intent;
  const short = text.split(" ").length <= 5 || P.followUp.test(text);

  // A bare place after a place-topic → the same topic there («¿mis vacas tienen calor?» → «¿y en Chihuahua?»).
  if (n.t === "area" && next.where && short) {
    if (p.t === "topic" && PLACE_TOPICS.has(p.topic)) return { ...next, intent: { t: "topic", topic: p.topic, where: next.where } };
    if (p.t === "scene") return { ...next, intent: { t: "scene", where: next.where, timeline: p.timeline } };
  }
  // A variable with no place keeps the place of the previous question.
  if (n.t === "variable" && !next.place && prev.place) return { ...next, place: prev.place, where: prev.where };
  // «y en 3D» / «la línea de tiempo» after a place → that place.
  if (n.t === "scene" && !n.where && (prev.where ?? (p.t === "topic" || p.t === "scene" ? (p as Extract<Intent, { where: unknown }>).where : null))) {
    return { ...next, intent: { ...n, where: prev.where ?? (p as Extract<Intent, { where: unknown }>).where } };
  }
  return next;
}
