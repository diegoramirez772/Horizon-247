// Bundle loader (contract v0.1 + v0.2). The web only READS the contract: no verdict is computed here.
// Ported from the Vite prototype (web/src/contract/loader.ts) without changing its behaviour.

import type { CellFinding, ContextCard, HomeDoc, Manifest, RegionLayer, Verdict } from "@/contract/types";
import { fetchContextCards } from "@/core/live/db";
import { type IndexEntry, type RegionGeo, YEARS_MORE_OVER_60 } from "./extra";

export type ArrayName =
  | "effect" | "ci_lo" | "ci_hi" | "sigma" | "r1" | "p_cons" | "q_cons" | "mde" | "years_more"
  | "verdict" | "flags" | "nvalid" | "nsig_methods" | "naive_sig" | "region";

export type NumArray = Float32Array | Uint8Array;

export interface Layer {
  basePath: string;
  manifest: Manifest;
  cells: number;
  arrays: Partial<Record<ArrayName, NumArray>>;
  series: Float32Array | null; // [cell × year], loaded on demand
}

export class ContractError extends Error {
  constructor(message: string, readonly file?: string) {
    super(message);
    this.name = "ContractError";
  }
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function join(base: string, file: string): string {
  return base.endsWith("/") ? base + file : `${base}/${file}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ContractError(`No se pudo leer ${url}`, url);
  }
  if (!res.ok) throw new ContractError(`No se pudo leer ${url} (${res.status})`, url);
  return (await res.json()) as T;
}

/** Decodes a little-endian binary array and checks its size against the grid (SPEC §1). */
export function decodeBinary(buf: ArrayBuffer, dtype: "f32" | "u8", expected: number, url = "array"): NumArray {
  const bytes = dtype === "f32" ? 4 : 1;
  if (buf.byteLength !== expected * bytes) {
    throw new ContractError(`${url}: se esperaban ${expected * bytes} bytes y llegaron ${buf.byteLength}`, url);
  }
  if (dtype === "u8") return new Uint8Array(buf);
  if (LITTLE_ENDIAN) return new Float32Array(buf);
  const view = new DataView(buf);
  const out = new Float32Array(expected);
  for (let i = 0; i < expected; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

async function fetchBinary(url: string, dtype: "f32" | "u8", expected: number): Promise<NumArray> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ContractError(`No se pudo leer ${url}`, url);
  }
  if (!res.ok) throw new ContractError(`No se pudo leer ${url} (${res.status})`, url);
  return decodeBinary(await res.arrayBuffer(), dtype, expected, url);
}

export function loadIndex(root: string): Promise<IndexEntry[]> {
  return fetchJson<IndexEntry[]>(join(root, "index.json"));
}

/** Validates the parts of a manifest the web depends on. Unknown fields are ignored (SPEC §8). */
export function checkManifest(m: Manifest, url = "manifest.json"): void {
  // Every version up to 0.4 is additive over 0.1 (SPEC §8–§10): the fields the web reads keep their meaning.
  if (!["0.1", "0.2", "0.3", "0.4"].includes(m.contract)) {
    throw new ContractError(`${url}: versión de contrato desconocida (${String(m.contract)})`, url);
  }
  const g = m.grid;
  if (!g || !(g.nlat > 0) || !(g.nlon > 0)) throw new ContractError(`${url}: grid inválido`, url);
  if (!m.arrays?.verdict || !m.arrays?.effect) throw new ContractError(`${url}: faltan verdict o effect`, url);
  if (!m.honesty) throw new ContractError(`${url}: falta honesty (real/simulado)`, url);
}

/** Loads the manifest and its arrays. series.f32 is heavy and loads separately. */
export async function loadLayer(basePath: string): Promise<Layer> {
  const url = join(basePath, "manifest.json");
  const manifest = await fetchJson<Manifest>(url);
  checkManifest(manifest, url);
  const cells = manifest.grid.nlat * manifest.grid.nlon;
  const arrays: Layer["arrays"] = {};
  await Promise.all((Object.keys(manifest.arrays) as ArrayName[]).map(async (name) => {
    const spec = manifest.arrays[name];
    if (!spec) return;
    arrays[name] = await fetchBinary(join(basePath, spec.file), spec.dtype, cells);
  }));
  return { basePath, manifest, cells, arrays, series: null };
}

export async function loadSeries(layer: Layer): Promise<Float32Array | null> {
  if (layer.series) return layer.series;
  const spec = layer.manifest.series;
  if (!spec) return null;
  const n = layer.manifest.window.n;
  layer.series = (await fetchBinary(join(layer.basePath, spec.file), "f32", layer.cells * n)) as Float32Array;
  return layer.series;
}

/** SPEC §8.1: arrays of one expanding window (windows/{end}/...). */
export async function loadWindow(layer: Layer, end: number): Promise<Partial<Record<ArrayName, NumArray>>> {
  const base = join(layer.basePath, `windows/${end}/`);
  const files: [ArrayName, string, "f32" | "u8"][] = [
    ["verdict", "verdict.u8", "u8"], ["effect", "effect.f32", "f32"], ["q_cons", "q_cons.f32", "f32"],
    ["mde", "mde.f32", "f32"], ["years_more", "years_more.f32", "f32"], ["flags", "flags.u8", "u8"],
  ];
  const out: Partial<Record<ArrayName, NumArray>> = {};
  await Promise.all(files.map(async ([name, file, dtype]) => {
    out[name] = await fetchBinary(join(base, file), dtype, layer.cells);
  }));
  return out;
}

// ---- Cells ----

/** SPEC §1: row-major, north to south, west to east. Returns the cell centre. */
export function cellLatLon(m: Manifest, index: number): { lat: number; lon: number } {
  const row = Math.floor(index / m.grid.nlon);
  const col = index % m.grid.nlon;
  return { lat: m.grid.lat0 + row * m.grid.dlat, lon: m.grid.lon0 + col * m.grid.dlon };
}

export function cellIndexAt(m: Pick<Manifest, "grid">, lat: number, lon: number): number {
  const { nlat, nlon, lat0, dlat, lon0, dlon } = m.grid;
  const row = Math.round((lat - lat0) / dlat);
  const col = Math.round((lon - lon0) / dlon);
  if (row < 0 || row >= nlat || col < 0 || col >= nlon) return -1;
  return row * nlon + col;
}

function at(a: NumArray | undefined, i: number): number {
  return a ? a[i] : NaN;
}

export function cellFinding(layer: Layer, index: number): CellFinding {
  const a = layer.arrays;
  const { lat, lon } = cellLatLon(layer.manifest, index);
  const ym = at(a.years_more, index);
  const n = layer.manifest.window.n;
  const series = layer.series ? Array.from(layer.series.subarray(index * n, index * n + n)) : [];
  return {
    index, lat, lon,
    effect: at(a.effect, index),
    ci: [at(a.ci_lo, index), at(a.ci_hi, index)],
    sigma: at(a.sigma, index),
    r1: at(a.r1, index),
    p: at(a.p_cons, index),
    q: at(a.q_cons, index),
    mde: at(a.mde, index),
    yearsMore: Number.isNaN(ym) ? null : ym,
    verdict: (a.verdict ? a.verdict[index] : 0) as Verdict,
    flags: a.flags ? a.flags[index] : 0,
    nSig: (a.nsig_methods ? Math.min(4, a.nsig_methods[index]) : 0) as 0 | 1 | 2 | 3 | 4,
    naiveSig: a.naive_sig ? a.naive_sig[index] === 1 : false,
    series,
    ...(a.region ? { region: Math.min(2, a.region[index]) as 0 | 1 | 2 } : {}),
  };
}

export function isOver60(yearsMore: number | null): boolean {
  return yearsMore === YEARS_MORE_OVER_60;
}

// ---- SPEC §8.2 and §8.4 (optional files) ----

// regions.json is snake_case; the §8.7 type is camelCase. Translated here (PREGUNTAS #3).
interface RegionLayerRaw {
  n_cells: number; flags: number; series: number[]; effect: number; ci: [number, number];
  p_cons: number; q_regions: number; verdict: Verdict; mde: number; years_more: number | null; emergence_year: number | null;
}
interface RegionRaw { id: string; name: { es: string; en: string }; layers: Record<string, RegionLayerRaw>; bbox?: unknown }

function bbox(v: unknown): RegionGeo["bbox"] {
  return Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === "number" && Number.isFinite(x))
    ? (v as [number, number, number, number]) : undefined;
}

export function parseRegions(raw: RegionRaw[]): RegionGeo[] {
  return raw.map((r) => ({
    id: r.id,
    name: r.name,
    bbox: bbox(r.bbox),
    layers: Object.fromEntries(Object.entries(r.layers).map(([k, l]): [string, RegionLayer] => [k, {
      n_cells: l.n_cells, flags: l.flags, series: l.series, effect: l.effect, ci: l.ci,
      pCons: l.p_cons, qRegions: l.q_regions, verdict: l.verdict, mde: l.mde,
      yearsMore: l.years_more, emergenceYear: l.emergence_year,
    }])),
  }));
}

export async function loadRegions(root: string): Promise<RegionGeo[]> {
  return parseRegions(await fetchJson<RegionRaw[]>(join(root, "regions.json")));
}

/** SPEC §8.4: a card without source, in draft, or of level ACCION is never shown. */
export function visibleContext(cards: ContextCard[]): ContextCard[] {
  return cards.filter((c) => c.status === "revisado" && !!c.source?.url && c.level !== "ACCION");
}

/** SPEC §15: «Mis monitores». Rejected (→ usual start screen) unless it is a home document with entities. */
export function checkHome(d: unknown): HomeDoc | null {
  const h = d as HomeDoc | null;
  return h && h.kind === "home" && Array.isArray(h.entities) && Array.isArray(h.events) ? h : null;
}

export async function loadHome(root: string): Promise<HomeDoc | null> {
  return checkHome(await fetchJson<unknown>(join(root, "home.json")));
}

/** Cards from context.json and from the team database (reviewed ones only, by RLS); the database wins on the same id. */
export async function loadContext(root: string): Promise<ContextCard[]> {
  const [file, db] = await Promise.all([
    fetchJson<ContextCard[]>(join(root, "context.json")).catch(() => [] as ContextCard[]),
    fetchContextCards().catch(() => [] as ContextCard[]),
  ]);
  const byId = new Map<string, ContextCard>();
  for (const c of [...(Array.isArray(file) ? file : []), ...db]) byId.set(c.id, c);
  return visibleContext([...byId.values()]);
}
