// The 2,478 municipalities of Mexico (INEGI, Marco Geoestadístico + Censo 2020), so «Lerdo», «Gómez Palacio, Durango» or
// «San Miguel de Allende» are found like a state: on the map, in HORI's file and in the real 3D view.
// The gazetteer (bundles/municipios.json, built once by scripts/build_municipios.py) is loaded after the page starts;
// until then the assistant simply does not know municipalities yet. Deterministic rules, no LLM:
//   1. the longest name found in the sentence wins («San Pedro Garza García» over «San Pedro»);
//   2. a state named in the sentence disambiguates («Lerdo, Durango», «Benito Juárez Quintana Roo»);
//   3. a name that is also a state («Durango») is the state, unless it is said twice («Durango, Durango»);
//   4. common words that are also municipalities («Centro», «Progreso», «Victoria»…) count only with their state;
//   5. still several? the options, most populated first (the assistant asks which one).

import { BUNDLES } from "@/components/useBundles";
import { normalize } from "@/core/assistant/patterns";

export interface Municipio {
  cvegeo: string; name: string; ent: string; state: string; pop: number;
  lat: number; lon: number; box: [number, number, number, number];
}

/** Short state names, as people say them (INEGI's are long: «Veracruz de Ignacio de la Llave»). */
const SHORT: Record<string, string> = {
  "01": "Aguascalientes", "02": "Baja California", "03": "Baja California Sur", "04": "Campeche", "05": "Coahuila", "06": "Colima",
  "07": "Chiapas", "08": "Chihuahua", "09": "Ciudad de México", "10": "Durango", "11": "Guanajuato", "12": "Guerrero", "13": "Hidalgo",
  "14": "Jalisco", "15": "Estado de México", "16": "Michoacán", "17": "Morelos", "18": "Nayarit", "19": "Nuevo León", "20": "Oaxaca",
  "21": "Puebla", "22": "Querétaro", "23": "Quintana Roo", "24": "San Luis Potosí", "25": "Sinaloa", "26": "Sonora", "27": "Tabasco",
  "28": "Tamaulipas", "29": "Tlaxcala", "30": "Veracruz", "31": "Yucatán", "32": "Zacatecas",
};
const STATE_KEYS: Record<string, string[]> = {
  "03": ["baja california sur", "bcs"], "02": ["baja california"], "09": ["ciudad de mexico", "cdmx"], "15": ["estado de mexico", "edomex"],
  "19": ["nuevo leon", "nl"], "23": ["quintana roo", "q roo"], "24": ["san luis potosi", "slp"],
};
/** Places people name that are not the municipality's own name: [what they say, municipality, state]. */
const ALIASES: [string, string, string][] = [
  ["ciudad juarez", "Juárez", "08"], ["cd juarez", "Juárez", "08"], ["cancun", "Benito Juárez", "23"], ["playa del carmen", "Solidaridad", "23"],
  ["acapulco", "Acapulco de Juárez", "12"], ["tuxtla", "Tuxtla Gutiérrez", "07"], ["torreon", "Torreón", "05"], ["san cristobal", "San Cristóbal de las Casas", "07"],
];
/** Ordinary words that are also municipalities: only with their state («Progreso, Yucatán»). */
const COMMON = new Set(["centro", "progreso", "reforma", "victoria", "union", "pinos", "mina", "libres", "lagunas", "solidaridad", "general",
  "nacional", "cuenca", "soledad", "zona", "paz", "luz", "rayon", "colon", "jimenez", "juarez", "ocampo", "morelos", "hidalgo", "guerrero",
  "allende", "aldama", "abasolo", "matamoros", "galeana", "bustamante", "escobedo", "arteaga", "zaragoza", "obregon", "madero", "carranza"]);

let all: Municipio[] | null = null;
let byName: Map<string, Municipio[]> | null = null;
let states: { ent: string; key: string }[] = [];
let loading: Promise<void> | null = null;
let source: string | null = null;

export function municipiosReady(): boolean { return !!byName; }
export function municipiosSource(): string | null { return source; }
export function stateName(ent: string): string { return SHORT[ent] ?? ent; }

/** Load the gazetteer once (≈200 KB, cached by the service worker); safe to call many times. */
export function loadMunicipios(): Promise<void> {
  loading ??= fetch(`${BUNDLES}municipios.json`).then(async (r) => {
    if (!r.ok) throw new Error(`municipios ${r.status}`);
    const d = (await r.json()) as { m: [string, string, string, number, number, number, number, number, number, number][]; source?: { vector?: string } };
    indexMunicipios(d.m.map(([cvegeo, name, ent, pop, lat, lon, a, b, c, e]) => ({ cvegeo, name, ent, state: stateName(ent), pop, lat, lon, box: [a, b, c, e] })));
    source = d.source?.vector ?? null;
  }).catch((e) => { loading = null; console.warn("[h247] municipios:", e); });
  return loading;
}

/** Before reading a question: wait for the gazetteer (at most `ms`), so the first «Lerdo» is not missed. */
export function whenMunicipios(ms = 1500): Promise<void> {
  if (byName) return Promise.resolve();
  return Promise.race([loadMunicipios(), new Promise<void>((ok) => setTimeout(ok, ms))]);
}

/** Build the indexes (exported for tests). */
export function indexMunicipios(list: Municipio[]): void {
  all = list;
  byName = new Map();
  const add = (k: string, m: Municipio) => { const a = byName!.get(k); if (a) { if (!a.includes(m)) a.push(m); } else byName!.set(k, [m]); };
  for (const m of list) add(normalize(m.name), m);
  for (const [said, name, ent] of ALIASES) { const m = list.find((x) => x.name === name && x.ent === ent); if (m) add(said, m); }
  states = Object.entries(SHORT).flatMap(([ent, n]) => [...new Set([normalize(n), ...(STATE_KEYS[ent] ?? [])])].map((key) => ({ ent, key })));
}

export interface MunicipioMatch { hit: Municipio | null; options: Municipio[]; said: string }

const has = (text: string, key: string) => new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(text);

/** The municipality a sentence names (see the rules above); null when it names none. */
export function findMunicipio(raw: string): MunicipioMatch | null {
  if (!byName) return null;
  const text = ` ${normalize(raw)} `;
  const words = text.trim().split(" ");
  // every name present, longest first
  const found: { key: string; start: number; len: number }[] = [];
  for (let i = 0; i < words.length; i++) for (let n = Math.min(7, words.length - i); n >= 1; n--) {
    const key = words.slice(i, i + n).join(" ");
    if (byName.has(key)) found.push({ key, start: i, len: n });
  }
  found.sort((a, b) => b.len - a.len || a.start - b.start);
  const stateHits = states.filter((s) => has(text, s.key));
  // where state names sit in the sentence (word spans): «León» inside «Nuevo León» is the state, not León, Guanajuato
  const stateSpans: [number, number][] = [];
  for (const st of stateHits) {
    const k = st.key.split(" ");
    for (let i = 0; i + k.length <= words.length; i++) if (k.every((w, j) => words[i + j] === w)) stateSpans.push([i, i + k.length]);
  }
  for (const f of found) {
    // a longer name already covers these words
    if (found.some((g) => g.len > f.len && g.start <= f.start && g.start + g.len >= f.start + f.len)) continue;
    if (stateSpans.some(([a, b]) => b - a > f.len && a <= f.start && b >= f.start + f.len)) continue;
    const isState = states.some((s) => s.key === f.key);
    const said = (text.match(new RegExp(`(^|\\s)${f.key}(?=\\s|$)`, "g")) ?? []).length;
    // qualifiers: states named elsewhere in the sentence (not the name itself, unless said twice)
    const qual = new Set(stateHits.filter((s) => s.key !== f.key || said >= 2).map((s) => s.ent));
    if (isState && said < 2) continue;
    if (COMMON.has(f.key) && !qual.size) continue;
    let list = byName.get(f.key)!;
    if (qual.size) { const q = list.filter((m) => qual.has(m.ent)); if (q.length) list = q; }
    const options = [...list].sort((a, b) => b.pop - a.pop);
    return { hit: options.length === 1 ? options[0] : null, options, said: f.key };
  }
  return null;
}

export function municipioLabel(m: Municipio): string { return `${m.name}, ${m.state}`; }
export function allMunicipios(): Municipio[] { return all ?? []; }

// ---------------------------------------------------------------- «¿Dónde caí?»: from a point to its municipality

type Ring = [number, number][];
const shapes = new Map<string, Promise<Record<string, Ring[]>>>();
const shapesReady = new Map<string, Record<string, Ring[]>>();

/** The simplified outlines of one state's municipalities (bundles/municipios/{ent}.json, ~50–150 KB, once). */
function loadShapes(ent: string): Promise<Record<string, Ring[]>> {
  let p = shapes.get(ent);
  if (!p) {
    p = fetch(`${BUNDLES}municipios/${ent}.json`).then(async (r) => {
      if (!r.ok) throw new Error(`contornos ${ent} ${r.status}`);
      const d = (await r.json()) as { m: Record<string, Ring[]> };
      shapesReady.set(ent, d.m);
      return d.m;
    });
    p.catch(() => shapes.delete(ent));
    shapes.set(ent, p);
  }
  return p;
}

/** Ray casting: is (lon, lat) inside the ring? */
export function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const candidates = (lat: number, lon: number) =>
  (all ?? []).filter((m) => lon >= m.box[0] && lon <= m.box[2] && lat >= m.box[1] && lat <= m.box[3]);

function pick(lat: number, lon: number, cands: Municipio[], get: (ent: string) => Record<string, Ring[]> | undefined): Municipio | null {
  for (const m of cands) if ((get(m.ent)?.[m.cvegeo] ?? []).some((r) => inRing(lon, lat, r))) return m;
  return null;
}

/** The municipality that contains a point (exact against INEGI's outline, ~300 m); null outside Mexico or at sea. */
export async function municipioAt(lat: number, lon: number): Promise<Municipio | null> {
  await whenMunicipios(3000);
  const cands = candidates(lat, lon);
  if (!cands.length) return null;
  await Promise.all([...new Set(cands.map((m) => m.ent))].map((e) => loadShapes(e).catch(() => null)));
  return pick(lat, lon, cands, (e) => shapesReady.get(e));
}

/** Same, only with what is already loaded (for the hover label, which cannot wait). */
export function municipioAtNow(lat: number, lon: number): Municipio | null {
  const cands = candidates(lat, lon);
  for (const e of new Set(cands.map((m) => m.ent))) if (!shapesReady.has(e)) void loadShapes(e).catch(() => {});
  return pick(lat, lon, cands, (e) => shapesReady.get(e));
}

/** The outline of one municipality (to draw its real shape on the map). */
export async function municipioShape(cvegeo: string): Promise<Ring[] | null> {
  const ent = cvegeo.slice(0, 2);
  const s = await loadShapes(ent).catch(() => null);
  return s?.[cvegeo] ?? null;
}

/**
 * Outside Mexico (or no municipality): ask OpenStreetMap what is there («Texas, Estados Unidos»). One request per
 * tap, 4 s at most; null at sea or offline.
 */
export async function placeAtOSM(lat: number, lon: number, lang: "es" | "en"): Promise<{ name: string; box?: [number, number, number, number] } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=8&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&accept-language=${lang}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const d = (await r.json()) as { address?: Record<string, string>; boundingbox?: string[]; error?: string };
    if (d.error || !d.address) return null;
    const a = d.address;
    const parts = [a.county ?? a.city ?? a.town ?? a.region, a.state ?? a.province, a.country].filter((x, i, xs): x is string => !!x && xs.indexOf(x) === i);
    if (!parts.length) return null;
    const bb = d.boundingbox?.map(Number);
    return { name: parts.slice(-3).join(", "), box: bb && bb.length === 4 && bb.every(Number.isFinite) ? [bb[2], bb[0], bb[3], bb[1]] : undefined };
  } catch { return null; } finally { clearTimeout(t); }
}
