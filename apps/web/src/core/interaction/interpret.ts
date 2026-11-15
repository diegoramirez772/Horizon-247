// One utterance → what to do with it (doc «Interacción v2» §2.4). Deterministic, no LLM (H19). Order:
//   pending confirmation → «orden: …» → interface commands → «número N» → moving the active view → ZON operations
//   → a visible control by its name (Label in Name, WCAG 2.5.3) → the assistant's own parser.
// In dictation, everything is TEXT except the few commands that end or steer dictation.

import { normalize } from "@/core/assistant/patterns";
import { containsOneOf, rank, saysOneOf } from "./fuzzy";
import { spokenToDigits } from "./numbers";
import { CONFIRM, DEIXIS, MANIP, META, NUMBER_PREFIX, ORDER_PREFIX, SYSTEM } from "./vocab";

export type Mode = "commands" | "dictation" | "conversation";
export type MetaKey = keyof typeof META;
export type ManipKey = keyof typeof MANIP;
export type SystemKey = keyof typeof SYSTEM;

export interface Label { n: number; name: string }

export interface InterpretCtx {
  mode: Mode;
  pendingConfirm: boolean;
  labels: Label[];
  hasManip: boolean;
}

export type Interpretation =
  | { k: "confirm"; yes: boolean }
  | { k: "meta"; what: MetaKey }
  | { k: "number"; n: number }
  | { k: "manip"; what: ManipKey; times: number }
  | { k: "system"; what: SystemKey; deixis: boolean; ordinal: number | null; rest: string }
  | { k: "label"; n: number }
  | { k: "choose"; options: number[] }
  | { k: "dictation"; raw: string }
  | { k: "assistant"; text: string }
  | { k: "none" };

/** Leading verbs people put before a control's name: «abre Mapa», «pulsa Experto», «go to Map». */
const LEAD = ["abre", "abrir", "pulsa", "presiona", "toca", "selecciona", "elige", "ve a", "ir a", "activa", "open", "click", "press", "tap", "select", "go to", "choose"];
/** In dictation only these steer; everything else is written. */
const DICTATION_META: MetaKey[] = ["dictateEnd", "send", "stopListening", "silence", "commandsMode", "handsFree"];

function stripLead(t: string): string {
  for (const l of LEAD) if (t.startsWith(`${l} `)) return t.slice(l.length + 1);
  return t;
}

function stripOrder(t: string): string | null {
  for (const p of ORDER_PREFIX) if (t.startsWith(`${p} `)) return t.slice(p.length + 1);
  return null;
}

function metaOf(t: string, allowed?: MetaKey[]): MetaKey | null {
  for (const k of Object.keys(META) as MetaKey[]) {
    if (allowed && !allowed.includes(k)) continue;
    if (saysOneOf(t, META[k])) return k;
  }
  return null;
}

function numberOf(t: string): number | null {
  const bare = t.match(/^(\d{1,3})$/);
  if (bare) return Number(bare[1]);
  for (const p of NUMBER_PREFIX) {
    const m = t.match(new RegExp(`^${p} (\\d{1,3})$`));
    if (m) return Number(m[1]);
  }
  return null;
}

/** «acerca», «acerca mucho», «gira a la derecha dos veces». */
function manipOf(t: string): { what: ManipKey; times: number } | null {
  let times = 1;
  let s = t;
  const rep = s.match(/^(.*) (\d) veces$|^(.*) (\d) times$/);
  if (rep) { s = (rep[1] ?? rep[3]).trim(); times = Math.min(5, Number(rep[2] ?? rep[4])); }
  const much = s.match(/^(.*) (mucho|mas|bastante|a lot|more)$/);
  if (much) { s = much[1]; times = Math.max(times, 3); }
  for (const k of Object.keys(MANIP) as ManipKey[]) if (saysOneOf(s, MANIP[k], 0.88)) return { what: k, times };
  return null;
}

/** «la alerta 2», «el segundo», «alert 3» → 2 / 3. */
function ordinalOf(t: string): number | null {
  const m = t.match(/(?:alerta|monitor|alert|numero|number|la|el)\s+(\d{1,2})(?:\s|$)/);
  if (m) return Number(m[1]);
  const ORD: Record<string, number> = { primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, ultima: -1, ultimo: -1, last: -1 };
  for (const [w, n] of Object.entries(ORD)) if (` ${t} `.includes(` ${w} `)) return n;
  return null;
}

function systemOf(t: string): { what: SystemKey; deixis: boolean; ordinal: number | null; rest: string } | null {
  // Specific verbs first (they also say «alerta»), then lists.
  const order: SystemKey[] = ["connect", "closeAlert", "ack", "escalate", "watch", "report", "swarm", "health", "monitors", "alerts", "entity"];
  for (const k of order) {
    const hit = containsOneOf(t, SYSTEM[k]);
    if (!hit) continue;
    if (k === "entity" && !/\S/.test(t.replace(hit, ""))) continue;
    if (k === "health" && hit === "zon" && t !== "zon") continue;
    const rest = t.slice(t.indexOf(hit) + hit.length).trim();
    return { what: k, deixis: !!containsOneOf(t, DEIXIS), ordinal: ordinalOf(t), rest };
  }
  return null;
}

function labelOf(t: string, labels: Label[]): Interpretation | null {
  if (!labels.length || t.split(" ").length > 5) return null;
  const want = stripLead(t);
  const items = labels.map((l) => ({ ...l, key: normalize(l.name) })).filter((l) => l.key);
  const exact = items.filter((l) => l.key === want);
  if (exact.length === 1) return { k: "label", n: exact[0].n };
  if (exact.length > 1) return { k: "choose", options: exact.map((l) => l.n) };
  const ranked = rank(want, items, (l) => [l.key], 0.84);
  if (!ranked.length) return null;
  if (ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.08) return { k: "label", n: ranked[0].item.n };
  return { k: "choose", options: ranked.slice(0, 4).map((r) => r.item.n) };
}

export function interpret(raw: string, ctx: InterpretCtx): Interpretation {
  const n0 = normalize(raw);
  if (!n0) return { k: "none" };
  const t = spokenToDigits(n0);

  if (ctx.mode === "dictation") {
    const ordered = stripOrder(t);
    if (ordered !== null) return interpret(ordered, { ...ctx, mode: "commands" });
    const meta = metaOf(t, DICTATION_META);
    return meta ? { k: "meta", what: meta } : { k: "dictation", raw };
  }

  if (ctx.pendingConfirm) {
    if (saysOneOf(t, CONFIRM.yes)) return { k: "confirm", yes: true };
    if (saysOneOf(t, CONFIRM.no)) return { k: "confirm", yes: false };
  }
  const ordered = stripOrder(t);
  const s = ordered ?? t;

  const meta = metaOf(s);
  if (meta) return { k: "meta", what: meta };
  const num = numberOf(s);
  if (num !== null) return { k: "number", n: num };
  if (ctx.hasManip) {
    const m = manipOf(s);
    if (m) return { k: "manip", ...m };
  }
  // Always recognised, even without ZON: the answer then says how to connect it instead of «no entendí».
  const sys = systemOf(s);
  if (sys) return { k: "system", ...sys };
  const lab = labelOf(s, ctx.labels);
  if (lab) return lab;
  return { k: "assistant", text: s };
}
