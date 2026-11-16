// «Ficha de HORI»: the seven capacities of HORI for one place, computed in the browser from the published bundles and
// the live sources, in the order a person would ask: identify → observe → detect → supervise → prioritise → what is
// not known → explain. Nothing is invented: every sentence carries numbers read from a bundle or a live source.
//
// Light on purpose: of each variable only the bytes of ONE cell are read (HTTP Range, a few hundred bytes); the
// verification downloads the verdict map of each variable (65–200 KB) and checks its published SHA-256.

import { BUNDLES } from "@/components/useBundles";
import { fetchEvents, km, type NaturalEvent } from "@/core/live/eonet";
import type { LiveDetection } from "@/core/map/weather";

export type StepKey = "identifica" | "observa" | "detecta" | "supervisa" | "prioriza" | "nosabe" | "explica";
export const STEPS: StepKey[] = ["identifica", "observa", "detecta", "supervisa", "prioriza", "nosabe", "explica"];

export interface Place {
  name: string; lat: number; lon: number;
  /** A municipality: its extent and INEGI identity (core/genui/municipios.ts). */
  box?: [number, number, number, number]; inegi?: { cvegeo: string; pop: number };
}

/** Width × height of a box in km. */
export function boxKm(b: [number, number, number, number]): [number, number] {
  const lat = (b[1] + b[3]) / 2;
  return [Math.round((b[2] - b[0]) * 111.32 * Math.cos((lat * Math.PI) / 180)), Math.round((b[3] - b[1]) * 110.574)];
}

interface IndexItem {
  id: string; kind?: string; path: string; profile?: string; cells?: number;
  title: { es: string; en: string } | string;
  variable?: { name?: string; unit?: string };
  window?: { start: number; end: number; n: number };
  files?: Record<string, { bytes: number; sha256: string }>;
}
interface Grid { nlat: number; nlon: number; lat0: number; dlat: number; lon0: number; dlon: number }
interface LayerManifest {
  id: string; title: { es: string; en: string }; grid: Grid; window: { start: number; end: number; n: number };
  variable: { name: string; unit: string; unit_per_decade: string };
  arrays: Record<string, { file: string; dtype: "f32" | "u8" }>;
  dataset: { name: string; kind: string; url?: string; doi?: string; version?: string; known_breaks?: { years: number[] } };
  honesty?: { data_real?: boolean; simulated?: boolean };
  entity?: { source?: { input_sha256?: string; card_sha256?: string } };
}

export interface VarReading {
  id: string; variable: string; name: Record<"es" | "en", string>; unit: string; perDecade: string;
  window: { start: number; end: number; n: number };
  verdict: number; effect: number; lo: number; hi: number; delta: number; mde: number; yearsMore: number | null;
  flags: number; nvalid: number; breakYear: number | null; q: number;
  dataset: string; datasetKind: string; doi?: string; cellKm: number; real: boolean;
  verified: boolean | null; sha: string | null;
}

export interface Timeline { firstProbado: number | null; emergence: number | null; event: string; tier: string; lastWindow: number }
export interface JointHit { rule: string; name: Record<"es" | "en", string>; level: number }
export interface FaunaHit { group: string; name: string; level: "leve" | "media" | "alta" | null; text: string }
export interface Priority { p: 0 | 1 | 2 | 3 | 4; key: string; text: Record<"es" | "en", string>; why: Record<"es" | "en", string> }

// ---- names and units (input to the sentences) ----

const VAR_NAME: Record<string, Record<"es" | "en", string>> = {
  T2M: { es: "Temperatura del aire", en: "Air temperature" },
  PRECTOTCORR: { es: "Lluvia", en: "Rain" },
  NDVI: { es: "Vegetación (NDVI)", en: "Vegetation (NDVI)" },
  SNOW_COVER: { es: "Nieve", en: "Snow" },
  AOD: { es: "Aerosoles (humo y polvo)", en: "Aerosols (smoke and dust)" },
  SEA_ICE: { es: "Hielo marino", en: "Sea ice" },
};
const UNIT: Record<string, string> = { C: "°C", "mm/day": "mm/día", "1": "", "": "" };

/** «0,42 °C» / «0,021» : two significant decimals for small indices. */
export function fmtNum(x: number, lang: "es" | "en", unit = ""): string {
  if (!Number.isFinite(x)) return "—";
  const a = Math.abs(x), d = a >= 10 ? 0 : a >= 1 ? 1 : a >= 0.1 ? 2 : 3;
  const s = x.toLocaleString(lang === "es" ? "es-MX" : "en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const u = UNIT[unit] ?? unit;
  return u ? `${s} ${u}` : s;
}

// ---- reading bytes ----

const json = new Map<string, Promise<unknown>>();
function getJson<T>(url: string): Promise<T> {
  let p = json.get(url);
  if (!p) { p = fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }); json.set(url, p); p.catch(() => json.delete(url)); }
  return p as Promise<T>;
}

/** One value of a flat binary array: a Range request of 1 or 4 bytes (a full answer is sliced, e.g. from a cache). */
export async function readAt(url: string, dtype: "f32" | "u8", index: number): Promise<number> {
  const size = dtype === "f32" ? 4 : 1, from = index * size;
  const r = await fetch(url, { headers: { Range: `bytes=${from}-${from + size - 1}` } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  let buf = await r.arrayBuffer();
  if (r.status === 200) buf = buf.slice(from, from + size);
  const v = new DataView(buf);
  return dtype === "f32" ? v.getFloat32(0, true) : v.getUint8(0);
}

export function cellIndex(g: Grid, lat: number, lon: number): number {
  const row = Math.round((lat - g.lat0) / g.dlat), col = Math.round((lon - g.lon0) / g.dlon);
  if (row < 0 || row >= g.nlat || col < 0 || col >= g.nlon) return -1;
  return row * g.nlon + col;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- 1. which layers describe this place ----

export async function layersFor(): Promise<{ layers: IndexItem[]; timeline: IndexItem | null; joint: IndexItem[] }> {
  const idx = await getJson<IndexItem[]>(`${BUNDLES}index.json`);
  const earth = idx.filter((e) => (e.profile ?? "earth") === "earth");
  // one global layer per variable: the widest grid, then the longest window (the Durango boxes and the 2° copy stay out)
  const best = new Map<string, IndexItem>();
  for (const e of earth.filter((x) => (x.kind ?? "layer") === "layer" && (x.cells ?? 0) >= 10000)) {
    const v = e.variable?.name ?? e.id, cur = best.get(v);
    if (!cur || (e.cells ?? 0) > (cur.cells ?? 0) || ((e.cells ?? 0) === (cur.cells ?? 0) && (e.window?.n ?? 0) > (cur.window?.n ?? 0))) best.set(v, e);
  }
  const order = ["T2M", "PRECTOTCORR", "NDVI", "SNOW_COVER", "AOD", "SEA_ICE"];
  const layers = [...best.entries()].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99).map(([, e]) => e);
  return { layers, timeline: earth.find((e) => e.kind === "timeline") ?? null, joint: earth.filter((e) => e.kind === "joint") };
}

// ---- 2. one variable at the place ----

export async function readVariable(e: IndexItem, p: Place): Promise<VarReading | null> {
  const base = `${BUNDLES}${e.path}/`;
  const m = await getJson<LayerManifest>(`${base}manifest.json`);
  const i = cellIndex(m.grid, p.lat, p.lon);
  if (i < 0) return null;
  const want = ["verdict", "effect", "ci_lo", "ci_hi", "delta", "mde", "years_more", "flags", "nvalid", "break_year", "q_cons"] as const;
  const vals = await Promise.all(want.map((k) => m.arrays[k] ? readAt(base + m.arrays[k].file, m.arrays[k].dtype, i).catch(() => NaN) : Promise.resolve(NaN)));
  const [verdict, effect, lo, hi, delta, mde, ym, flags, nvalid, brk, q] = vals;
  const v = m.variable.name;
  return {
    id: m.id, variable: v, name: VAR_NAME[v] ?? { es: m.title.es, en: m.title.en },
    unit: m.variable.unit, perDecade: `${UNIT[m.variable.unit] ?? m.variable.unit}`.trim(),
    window: m.window, verdict: Number.isFinite(verdict) ? verdict : 0, effect, lo, hi, delta, mde,
    yearsMore: Number.isFinite(ym) ? (ym >= 255 ? 61 : Math.round(ym)) : null,
    flags: Number.isFinite(flags) ? flags : 0, nvalid: Number.isFinite(nvalid) ? nvalid : 0,
    breakYear: Number.isFinite(brk) && brk > 1900 ? Math.round(brk) : null, q,
    dataset: m.dataset.name, datasetKind: m.dataset.kind, doi: m.dataset.doi,
    cellKm: Math.abs(m.grid.dlat) * 111.32, real: m.honesty?.data_real !== false && !m.honesty?.simulated,
    verified: null, sha: e.files?.["verdict.u8"]?.sha256 ?? null,
  };
}

/** Download the verdict map and compare its SHA-256 with the one published in the index. */
export async function verifyVariable(e: IndexItem): Promise<boolean | null> {
  const want = e.files?.["verdict.u8"]?.sha256;
  if (!want || typeof crypto === "undefined" || !crypto.subtle) return null;
  const r = await fetch(`${BUNDLES}${e.path}/verdict.u8`);
  if (!r.ok) return null;
  return (await sha256Hex(await r.arrayBuffer())) === want;
}

// ---- 3. how the evidence evolved (temperature timeline) ----

export async function readTimeline(e: IndexItem, p: Place): Promise<Timeline | null> {
  const base = `${BUNDLES}${e.path}/`;
  const t = await getJson<{ grid: Grid; event_codes: Record<string, string>; tier_codes: Record<string, string>; windows: { ends: number[] } }>(`${base}timeline.json`);
  const i = cellIndex(t.grid, p.lat, p.lon);
  if (i < 0) return null;
  const [fp, em, ev, tier] = await Promise.all([
    readAt(base + "first_probado_year.f32", "f32", i), readAt(base + "emergence_year.f32", "f32", i),
    readAt(base + "event.u8", "u8", i), readAt(base + "priority_tier.u8", "u8", i),
  ]);
  return {
    firstProbado: Number.isFinite(fp) && fp > 1900 ? Math.round(fp) : null, emergence: Number.isFinite(em) && em > 1900 ? Math.round(em) : null,
    event: t.event_codes[String(ev)] ?? "NINGUNO", tier: t.tier_codes[String(tier)] ?? "RESTO", lastWindow: t.windows.ends.at(-1) ?? 0,
  };
}

// ---- 4. two variables changing together ----

export async function readJoint(items: IndexItem[], p: Place): Promise<JointHit[]> {
  const out: JointHit[] = [];
  await Promise.all(items.map(async (e) => {
    const base = `${BUNDLES}${e.path}/`;
    const m = await getJson<{ grid: Grid; rules: { rule: string; name: Record<"es" | "en", string> }[]; arrays: Record<string, { file: string }> }>(`${base}manifest.json`);
    const i = cellIndex(m.grid, p.lat, p.lon);
    if (i < 0) return;
    for (const r of m.rules) {
      const f = m.arrays[`level_${r.rule}`]?.file;
      if (!f) continue;
      const lv = await readAt(base + f, "u8", i).catch(() => 0);
      if (lv >= 3) out.push({ rule: r.rule, name: r.name, level: lv });
    }
  }));
  return out.sort((a, b) => b.level - a.level);
}

// ---- 5. live sources near the place ----

export async function eventsNear(p: Place, maxKm = 400): Promise<{ e: NaturalEvent; km: number }[]> {
  const ev = await fetchEvents(30);
  return ev.map((e) => ({ e, km: km(p, e) })).filter((x) => x.km <= maxKm).sort((a, b) => a.km - b.km);
}

export function stormsNear(list: LiveDetection[], p: Place, maxKm = 600): { d: LiveDetection; km: number }[] {
  return list.map((d) => ({ d, km: km(p, d) })).filter((x) => x.km <= maxKm).sort((a, b) => a.km - b.km);
}

// ---- 6. priorities: one list, explicit rules ----

export const RULES: Record<"es" | "en", string[]> = {
  es: [
    "P0 · Ahora: tormenta o lluvia intensa detectada a 150 km o menos; evento de la NASA activo a 150 km o menos.",
    "P1 · Requiere atención: tendencia que se volvió clara con el último dato; tendencia probada de al menos 2 veces el umbral δ; anomalía media o alta en fauna; tormenta a 600 km o menos; evento a 400 km o menos.",
    "P2 · Cambio claro: tendencia probada más allá de δ; cambio conjunto probado en la zona.",
    "P3 · Por confirmar: posible cambio sin confirmar; anomalía leve en fauna; dos variables probadas por separado.",
    "P4 · Sin señal o aún no se sabe: sin cambio mayor que δ, datos insuficientes o falta tiempo para saber.",
  ],
  en: [
    "P0 · Now: storm or heavy rain detected within 150 km; NASA event open within 150 km.",
    "P1 · Needs attention: a trend that became clear with the latest data; a proven trend of at least twice the threshold δ; medium or high wildlife anomaly; storm within 600 km; event within 400 km.",
    "P2 · Clear change: proven trend beyond δ; proven joint change in the area.",
    "P3 · To be confirmed: possible change not yet confirmed; mild wildlife anomaly; two variables proven separately.",
    "P4 · No signal or not known yet: no change larger than δ, too few data or not enough time to know.",
  ],
};

const STORM = { tormenta: { es: "Tormenta", en: "Storm" }, lluvia_intensa: { es: "Lluvia intensa", en: "Heavy rain" }, nieve: { es: "Nieve o lluvia helada", en: "Snow or freezing rain" } };

export function trendLine(v: VarReading, lang: "es" | "en"): string {
  const es = lang === "es", up = v.effect > 0;
  const per = es ? `por década` : `per decade`;
  switch (v.verdict) {
    case 1: return es
      ? `${up ? "Sube" : "Baja"} ${fmtNum(Math.abs(v.effect), lang, v.unit)} ${per} (entre ${fmtNum(v.lo, lang)} y ${fmtNum(v.hi, lang)}), más que el umbral δ = ${fmtNum(v.delta, lang, v.unit)}.`
      : `${up ? "Rising" : "Falling"} ${fmtNum(Math.abs(v.effect), lang, v.unit)} ${per} (between ${fmtNum(v.lo, lang)} and ${fmtNum(v.hi, lang)}), beyond the threshold δ = ${fmtNum(v.delta, lang, v.unit)}.`;
    case 4: return es ? `Sin cambio mayor que δ = ${fmtNum(v.delta, lang, v.unit)} ${per}.` : `No change larger than δ = ${fmtNum(v.delta, lang, v.unit)} ${per}.`;
    case 2: return es ? `Posible cambio (${fmtNum(v.effect, lang, v.unit)} ${per}), todavía sin confirmar.` : `Possible change (${fmtNum(v.effect, lang, v.unit)} ${per}), not confirmed yet.`;
    case 3: return es
      ? `Aún no se sabe: con estos datos solo se distinguiría un cambio de ${fmtNum(v.mde, lang, v.unit)} ${per}${v.yearsMore !== null ? `; harían falta ~${v.yearsMore > 60 ? "más de 60" : v.yearsMore} años más` : ""}.`
      : `Not known yet: these data could only tell a change of ${fmtNum(v.mde, lang, v.unit)} ${per}${v.yearsMore !== null ? `; ~${v.yearsMore > 60 ? "over 60" : v.yearsMore} more years needed` : ""}.`;
    default: return es ? "Datos insuficientes para juzgar aquí." : "Too few data to judge here.";
  }
}

export function prioritize(x: {
  vars: VarReading[]; timeline: Timeline | null; joint: JointHit[]; storms: { d: LiveDetection; km: number }[];
  events: { e: NaturalEvent; km: number }[]; fauna: FaunaHit[]; place: Place;
}): Priority[] {
  const out: Priority[] = [];
  const L = (es: string, en: string) => ({ es, en });
  for (const { d, km: k } of x.storms) {
    const p = k <= 150 ? 0 : 1;
    out.push({ p, key: `storm:${d.id}`, text: L(`${STORM[d.kind].es} detectada a ${Math.round(k)} km (${d.trend.replace("_", " ")})`, `${STORM[d.kind].en} detected ${Math.round(k)} km away (${d.trend.replace("_", " ")})`),
      why: L(`Infrarrojo GOES e IMERG de ahora; regla ${p === 0 ? "P0: a 150 km o menos" : "P1: a 600 km o menos"}.`, `GOES infrared and IMERG now; rule ${p === 0 ? "P0: within 150 km" : "P1: within 600 km"}.`) });
  }
  for (const { e, k } of x.events.map((v) => ({ e: v.e, k: v.km }))) {
    const p = k <= 150 ? 0 : 1;
    out.push({ p, key: `event:${e.id}`, text: L(`${e.title} a ${Math.round(k)} km`, `${e.title}, ${Math.round(k)} km away`),
      why: L(`Evento abierto de la NASA (EONET, ${e.date.slice(0, 10)}); regla ${p === 0 ? "P0: a 150 km o menos" : "P1: a 400 km o menos"}.`, `Open NASA event (EONET, ${e.date.slice(0, 10)}); rule ${p === 0 ? "P0: within 150 km" : "P1: within 400 km"}.`) });
  }
  for (const v of x.vars) {
    const ratio = Math.abs(v.effect) / Math.max(1e-9, Math.abs(v.delta));
    const justNow = v.variable === "T2M" && x.timeline?.event === "CRUZO";
    if (v.verdict === 1) {
      const p = justNow || ratio >= 2 ? 1 : 2;
      out.push({ p, key: `trend:${v.variable}`, text: L(`${v.name.es}: ${trendLine(v, "es")}`, `${v.name.en}: ${trendLine(v, "en")}`),
        why: justNow
          ? L(`Se volvió claro con el dato de ${x.timeline!.lastWindow} (regla P1).`, `Became clear with the ${x.timeline!.lastWindow} data (rule P1).`)
          : L(`Efecto ${fmtNum(ratio, "es")} veces δ; regla ${p === 1 ? "P1: al menos 2δ" : "P2: más allá de δ"}.`, `Effect ${fmtNum(ratio, "en")}×δ; rule ${p === 1 ? "P1: at least 2δ" : "P2: beyond δ"}.`) });
    } else if (v.verdict === 2) {
      out.push({ p: 3, key: `trend:${v.variable}`, text: L(`${v.name.es}: ${trendLine(v, "es")}`, `${v.name.en}: ${trendLine(v, "en")}`), why: L("Regla P3: posible cambio sin confirmar.", "Rule P3: possible change not yet confirmed.") });
    } else {
      out.push({ p: 4, key: `trend:${v.variable}`, text: L(`${v.name.es}: ${trendLine(v, "es")}`, `${v.name.en}: ${trendLine(v, "en")}`), why: L("Regla P4: sin señal mayor que δ o aún no se sabe.", "Rule P4: no signal beyond δ or not known yet.") });
    }
  }
  for (const j of x.joint) {
    out.push({ p: j.level === 4 ? 2 : 3, key: `joint:${j.rule}`, text: L(`${j.name.es}, al mismo tiempo`, `${j.name.en}, at the same time`),
      why: j.level === 4 ? L("Cambio conjunto probado en la zona (q ≤ 0,10); regla P2. No dice que uno provoque el otro.", "Joint change proven here (q ≤ 0.10); rule P2. It does not say one drives the other.")
        : L("Cada variable probada por separado; la afirmación conjunta aún no; regla P3.", "Each variable proven separately; the joint claim not yet; rule P3.") });
  }
  for (const f of x.fauna) {
    if (!f.level) continue;
    const p = f.level === "leve" ? 3 : 1;
    out.push({ p, key: `fauna:${f.group}`, text: L(`${f.name}: ${f.text}`, `${f.name}: ${f.text}`), why: L(`Anomalía ${f.level} frente a su propio pasado (iNaturalist); regla P${p}.`, `${f.level} anomaly against its own past (iNaturalist); rule P${p}.`) });
  }
  return out.sort((a, b) => a.p - b.p);
}

// ---- 7. the paragraph that explains it all ----

export function explain(x: { place: Place; vars: VarReading[]; pri: Priority[]; timeline: Timeline | null; unknown: VarReading[] }, lang: "es" | "en"): string {
  const es = lang === "es";
  const top = x.pri.filter((p) => p.p <= 2);
  const changed = x.vars.filter((v) => v.verdict === 1);
  const parts: string[] = [];
  parts.push(es
    ? `En ${x.place.name} revisé ${x.vars.length} variables con datos de la NASA${changed.length ? ` y ${changed.length} ya cambiaron de forma clara` : " y ninguna cambió de forma clara todavía"}.`
    : `In ${x.place.name} I checked ${x.vars.length} variables with NASA data${changed.length ? ` and ${changed.length} have clearly changed` : " and none has clearly changed yet"}.`);
  // «temperatura del aire sube 0.52 °C por década (entre …), más que el umbral δ = 0.3 °C»: one clause per item
  const clause = (t: string) => { const [head, ...rest] = t.split(": "); const body = rest.join(": ").replace(/\.+$/, ""); return rest.length ? `${head.split(" (")[0].toLowerCase()} ${body.charAt(0).toLowerCase()}${body.slice(1)}` : body.charAt(0).toLowerCase() + body.slice(1); };
  if (top.length) parts.push(es ? `Lo primero que vería: ${top.slice(0, 2).map((p) => clause(p.text.es)).join("; ")}.` : `What I would look at first: ${top.slice(0, 2).map((p) => clause(p.text.en)).join("; ")}.`);
  const t = x.timeline;
  if (t?.firstProbado) parts.push(es ? `La subida de temperatura se volvió clara en ${t.firstProbado}${t.emergence && t.emergence !== t.firstProbado ? ` y se mantiene desde ${t.emergence}` : ""}.` : `The temperature rise became clear in ${t.firstProbado}${t.emergence && t.emergence !== t.firstProbado ? ` and has held since ${t.emergence}` : ""}.`);
  if (x.unknown.length) parts.push(es ? `Aún no se sabe para ${x.unknown.map((v) => v.name.es.split(" (")[0].toLowerCase()).join(", ")}: con estos años el cambio que se podría distinguir es más grande que el umbral.` : `Not known yet for ${x.unknown.map((v) => v.name.en.split(" (")[0].toLowerCase()).join(", ")}: with these years the change that could be told apart is larger than the threshold.`);
  parts.push(es ? "Esto dice dónde, cuánto y desde cuándo; no dice por qué." : "This says where, how much and since when; it does not say why.");
  return parts.join(" ");
}
