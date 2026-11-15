// Real imagery for the globe: NASA GIBS (Earth) and NASA Trek (Mars, Moon), geographic grid (EPSG:4326),
// so lat/lon map to image pixels with a rule of three — no reprojection.
//
// Measured 2026-11-15 from Durango: both services answer `Access-Control-Allow-Origin: *` and need no key.
// GIBS tiles are 512 px, level z spans 288/2^z degrees; Trek tiles are 256 px, level z spans 180/2^z degrees.
// Every GIBS answer carries `layer-time-actual` (the date really served), kept as provenance.
//
// Honesty rules (SANTUARIO H4/H5): a layer says what it is (`kind`), its real resolution, and its caveat.
// Zooming past `maxLevel` never invents detail.

export type Body = "earth" | "mars" | "moon";
export type Provider = "gibs" | "trek";
export type LayerRole = "base" | "evidence" | "variable" | "night" | "live";

export interface LayerDef {
  id: string;
  body: Body;
  provider: Provider;
  role: LayerRole;
  /** Short name for the corner label. */
  title: string;
  /** "observacion" = that day's measurement; "compuesto" = mosaic without a date (illustrative base). */
  kind: "observacion" | "compuesto";
  /** GIBS tile matrix set (resolution family) or Trek path prefix. */
  tms: string;
  ext: "jpg" | "jpeg" | "png";
  maxLevel: number;
  resolution_m: number;
  daily: boolean;
  /** First date with data (ISO), for daily layers. */
  start?: string;
  attribution: string;
  caveat?: string;
  /** Geostationary layer every 10 minutes: the "date" is a UTC time slot (see liveSlot), never a day. */
  live?: true;
}

const GIBS = "NASA EOSDIS GIBS";
const TREK = "NASA Solar System Treks";

export const LAYERS: LayerDef[] = [
  // ---- Earth ----
  { id: "BlueMarble_ShadedRelief_Bathymetry", body: "earth", provider: "gibs", role: "base", title: "Blue Marble", kind: "compuesto", tms: "500m", ext: "jpeg", maxLevel: 7, resolution_m: 500, daily: false, attribution: GIBS, caveat: "Vista ilustrativa: compuesto sin nubes de 2004, no corresponde a la fecha" },
  { id: "VIIRS_CityLights_2012", body: "earth", provider: "gibs", role: "night", title: "Luces nocturnas 2012", kind: "compuesto", tms: "500m", ext: "jpeg", maxLevel: 7, resolution_m: 500, daily: false, attribution: GIBS, caveat: "Luces del año 2012" },
  { id: "MODIS_Terra_CorrectedReflectance_TrueColor", body: "earth", provider: "gibs", role: "evidence", title: "MODIS Terra · color real", kind: "observacion", tms: "250m", ext: "jpg", maxLevel: 8, resolution_m: 250, daily: true, start: "2000-02-24", attribution: GIBS, caveat: "Franjas negras = el satélite no pasó ese día" },
  { id: "VIIRS_SNPP_CorrectedReflectance_TrueColor", body: "earth", provider: "gibs", role: "evidence", title: "VIIRS · color real", kind: "observacion", tms: "250m", ext: "jpg", maxLevel: 8, resolution_m: 250, daily: true, start: "2015-11-24", attribution: GIBS },
  { id: "HLS_S30_Nadir_BRDF_Adjusted_Reflectance", body: "earth", provider: "gibs", role: "evidence", title: "Sentinel-2 (HLS) · 30 m", kind: "observacion", tms: "31.25m", ext: "png", maxLevel: 11, resolution_m: 30, daily: true, start: "2015-11-28", attribution: GIBS, caveat: "Solo hay imagen algunos días; puede tener nubes" },
  { id: "HLS_L30_Nadir_BRDF_Adjusted_Reflectance", body: "earth", provider: "gibs", role: "evidence", title: "Landsat (HLS) · 30 m", kind: "observacion", tms: "31.25m", ext: "png", maxLevel: 11, resolution_m: 30, daily: true, start: "2013-03-22", attribution: GIBS, caveat: "Solo hay imagen algunos días; puede tener nubes" },
  // In real time (every 10 min, ~30 min behind): thermal infrared = cloud tops, storms and night, from three geostationary satellites
  { id: "GOES-East_ABI_Band13_Clean_Infrared", body: "earth", provider: "gibs", role: "live", title: "Infrarrojo en vivo · América (GOES-Este)", kind: "observacion", tms: "2km", ext: "png", maxLevel: 5, resolution_m: 2000, daily: true, live: true, start: "2019-01-01", attribution: GIBS, caveat: "Brillo = nubes frías y altas (tormentas); cubre América y el Atlántico" },
  { id: "GOES-West_ABI_Band13_Clean_Infrared", body: "earth", provider: "gibs", role: "live", title: "Infrarrojo en vivo · Pacífico (GOES-Oeste)", kind: "observacion", tms: "2km", ext: "png", maxLevel: 5, resolution_m: 2000, daily: true, live: true, start: "2019-01-01", attribution: GIBS, caveat: "Cubre el Pacífico oriental y el oeste de América" },
  { id: "Himawari_AHI_Band13_Clean_Infrared", body: "earth", provider: "gibs", role: "live", title: "Infrarrojo en vivo · Asia y Oceanía (Himawari)", kind: "observacion", tms: "2km", ext: "png", maxLevel: 5, resolution_m: 2000, daily: true, live: true, start: "2019-01-01", attribution: GIBS, caveat: "Cubre Asia oriental, Oceanía y el Pacífico occidental" },
  { id: "MODIS_Terra_Cloud_Fraction_Day", body: "earth", provider: "gibs", role: "variable", title: "Nubes · fracción", kind: "observacion", tms: "2km", ext: "png", maxLevel: 5, resolution_m: 2000, daily: true, start: "2000-02-24", attribution: GIBS },
  { id: "IMERG_Precipitation_Rate", body: "earth", provider: "gibs", role: "variable", title: "Lluvia · IMERG", kind: "observacion", tms: "2km", ext: "png", maxLevel: 5, resolution_m: 10000, daily: true, start: "2000-06-01", attribution: GIBS, caveat: "Resolución real ≈ 10 km" },
  { id: "MODIS_Terra_L3_NDVI_Monthly", body: "earth", provider: "gibs", role: "variable", title: "Vegetación · NDVI mensual", kind: "observacion", tms: "1km", ext: "png", maxLevel: 6, resolution_m: 1000, daily: false, start: "2000-03-01", attribution: GIBS },
  { id: "MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day", body: "earth", provider: "gibs", role: "variable", title: "Temperatura de superficie", kind: "observacion", tms: "2km", ext: "png", maxLevel: 5, resolution_m: 2000, daily: false, start: "2000-03-01", attribution: GIBS },
  { id: "LPRM_AMSR2_Surface_Soil_Moisture_C1_Band_Day_Daily", body: "earth", provider: "gibs", role: "variable", title: "Humedad del suelo (sequía)", kind: "observacion", tms: "2km", ext: "png", maxLevel: 5, resolution_m: 25000, daily: true, start: "2012-07-03", attribution: GIBS, caveat: "Resolución real ≈ 25 km" },
  { id: "MODIS_Combined_Flood_2-Day", body: "earth", provider: "gibs", role: "variable", title: "Inundación · 2 días", kind: "observacion", tms: "250m", ext: "png", maxLevel: 8, resolution_m: 250, daily: true, start: "2021-01-01", attribution: GIBS },
  { id: "MODIS_Terra_NDSI_Snow_Cover", body: "earth", provider: "gibs", role: "variable", title: "Nieve", kind: "observacion", tms: "500m", ext: "png", maxLevel: 7, resolution_m: 500, daily: true, start: "2000-02-24", attribution: GIBS },
  { id: "MODIS_Terra_Aerosol", body: "earth", provider: "gibs", role: "variable", title: "Humo y polvo · aerosol", kind: "observacion", tms: "2km", ext: "png", maxLevel: 5, resolution_m: 10000, daily: true, start: "2000-02-24", attribution: GIBS, caveat: "Resolución real ≈ 10 km" },
  { id: "GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies", body: "earth", provider: "gibs", role: "variable", title: "Mar · anomalía de temperatura", kind: "observacion", tms: "1km", ext: "png", maxLevel: 6, resolution_m: 1000, daily: true, start: "2019-07-23", attribution: GIBS },
  // ---- Mars ----
  { id: "Mars_Viking_MDIM21_ClrMosaic_global_232m", body: "mars", provider: "trek", role: "base", title: "Marte · Viking color", kind: "compuesto", tms: "Mars/EQ", ext: "jpg", maxLevel: 7, resolution_m: 232, daily: false, attribution: TREK, caveat: "Mosaico sin fecha: el tiempo lo pone la capa de datos" },
  { id: "Mars_MGS_MOLA_ClrShade_merge_global_463m", body: "mars", provider: "trek", role: "variable", title: "Marte · relieve MOLA", kind: "compuesto", tms: "Mars/EQ", ext: "jpg", maxLevel: 6, resolution_m: 463, daily: false, attribution: TREK, caveat: "Color = altura, no es el color real" },
  // ---- Moon ----
  { id: "LRO_WAC_Mosaic_Global_303ppd_v02", body: "moon", provider: "trek", role: "base", title: "Luna · LRO WAC", kind: "compuesto", tms: "Moon/EQ", ext: "jpg", maxLevel: 6, resolution_m: 100, daily: false, attribution: TREK, caveat: "Mosaico sin fecha" },
];

/**
 * Latest 10-minute slot GIBS already has for a geostationary layer, as the time GIBS expects in the tile URL
 * (e.g. "2026-11-15T07:40:00Z"). 30 minutes of margin: GIBS publishes each image ~20 min after it is taken.
 */
export function liveSlot(now = Date.now()): string {
  const t = new Date(Math.floor((now - 30 * 60e3) / 600e3) * 600e3);
  return t.toISOString().slice(0, 16) + ":00Z";
}

export function layer(id: string): LayerDef {
  const l = LAYERS.find((x) => x.id === id);
  if (!l) throw new Error(`capa desconocida: ${id}`);
  return l;
}

export function baseLayer(body: Body): LayerDef {
  return LAYERS.find((l) => l.body === body && l.role === "base")!;
}

// ---- tile geometry ----

export interface LevelGeometry { tileDeg: number; px: number; cols: number; rows: number }

export function levelGeometry(provider: Provider, z: number): LevelGeometry {
  if (provider === "gibs") {
    const tileDeg = 288 / 2 ** z;
    return { tileDeg, px: 512, cols: Math.ceil(360 / tileDeg - 1e-9), rows: Math.ceil(180 / tileDeg - 1e-9) };
  }
  const tileDeg = 180 / 2 ** z;
  return { tileDeg, px: 256, cols: 2 ** (z + 1), rows: 2 ** z };
}

/** Degrees per image pixel at a level. */
export function degPerPx(provider: Provider, z: number): number {
  const g = levelGeometry(provider, z);
  return g.tileDeg / g.px;
}

/** Where tiles are read from. Set to a local folder (written by `zon visual pack`) to run without internet. */
let tileRoot: string | null = null;
export function setTileRoot(root: string | null): void { tileRoot = root ? root.replace(/\/$/, "") : null; }
// `?sinred=1` → read the pack written by `python -m zon.visual pack` into apps/web/public/tiles (demo without internet).
try { if (new URLSearchParams(location.search).has("sinred")) tileRoot = "tiles"; } catch { /* server render or tests */ }

export function tileUrl(l: LayerDef, z: number, row: number, col: number, date?: string): string {
  if (tileRoot) return `${tileRoot}/${l.provider}/${l.id}/${(l.daily || l.start) && date ? date : "static"}/${z}/${row}/${col}.${l.ext}`;
  if (l.provider === "gibs") {
    const d = l.daily || l.start ? `${date ?? "default"}/` : "";
    return `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${l.id}/default/${d}${l.tms}/${z}/${row}/${col}.${l.ext}`;
  }
  return `https://trek.nasa.gov/tiles/${l.tms}/${l.id}/1.0.0/default/default028mm/${z}/${row}/${col}.${l.ext}`;
}

/** Highest level whose pixels are at least as fine as `wantDegPerPx`, capped by the layer. */
export function levelFor(l: LayerDef, wantDegPerPx: number): number {
  for (let z = 0; z <= l.maxLevel; z++) if (degPerPx(l.provider, z) <= wantDegPerPx) return z;
  return l.maxLevel;
}

export interface TileRef { z: number; row: number; col: number }

/** Tiles covering [lonMin, latMin, lonMax, latMax] at level z (no wrap across the antimeridian). */
export function tilesFor(provider: Provider, z: number, bbox: [number, number, number, number]): TileRef[] {
  const g = levelGeometry(provider, z);
  const [x0, y0, x1, y1] = bbox;
  const c0 = Math.max(0, Math.floor((x0 + 180) / g.tileDeg)), c1 = Math.min(g.cols - 1, Math.floor((x1 + 180 - 1e-9) / g.tileDeg));
  const r0 = Math.max(0, Math.floor((90 - y1) / g.tileDeg)), r1 = Math.min(g.rows - 1, Math.floor((90 - y0 - 1e-9) / g.tileDeg));
  const out: TileRef[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push({ z, row: r, col: c });
  return out;
}

// ---- loading ----

export interface Mosaic {
  canvas: HTMLCanvasElement;
  /** Geographic extent of the canvas: lonMin, latMin, lonMax, latMax. */
  bbox: [number, number, number, number];
  layer: LayerDef;
  level: number;
  /** Real resolution of what is shown (never better than the layer's). */
  resolution_m: number;
  /** Date really served (GIBS header), or null for undated mosaics. */
  servedDate: string | null;
  missing: number;
  total: number;
}

const memory = new Map<string, ImageBitmap | HTMLImageElement>();
const MEMORY_MAX = 96;
const served = new Map<string, string>();

function remember(url: string, img: ImageBitmap | HTMLImageElement): void {
  memory.set(url, img);
  while (memory.size > MEMORY_MAX) {
    const k = memory.keys().next().value as string;
    const old = memory.get(k);
    if (old && "close" in old) old.close();
    memory.delete(k);
  }
}

/** Never waits on storage for long: some browsers (private mode, file://, headless) leave CacheStorage hanging. */
function soon<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((ok) => setTimeout(() => ok(fallback), ms))]);
}

let cacheP: Promise<Cache | null> | null = null;
function openCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return Promise.resolve(null);
  cacheP ??= soon(caches.open("h247-tiles-v1"), 500, null);
  return cacheP;
}

/** Past dates and undated mosaics never change, so they are kept on disk even though GIBS says no-store. */
function immutable(l: LayerDef, date?: string): boolean {
  if (l.live) return false;
  if (!l.daily) return true;
  if (!date) return false;
  return date < new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
}

async function fetchTile(url: string, keep: boolean, signal?: AbortSignal): Promise<ImageBitmap | HTMLImageElement | null> {
  const hit = memory.get(url);
  if (hit) { memory.delete(url); memory.set(url, hit); return hit; }
  const cache = keep ? await openCache() : null;
  let res: Response | undefined;
  try {
    res = cache ? await soon(cache.match(url), 300, undefined) : undefined;
    if (!res) {
      res = await fetch(url, { signal, mode: "cors" });
      if (!res.ok) return null;
    }
  } catch {
    return null;
  }
  const t = res.headers.get("layer-time-actual");
  // live layers keep the time of the image (HH:MM UTC); daily layers the day
  if (t) served.set(url, /T\d\d:\d\d/.test(t) && !t.includes("T00:00:00") ? `${t.slice(0, 10)} ${t.slice(11, 16)} UTC` : t.slice(0, 10));
  let blob: Blob;
  try { blob = await res.blob(); } catch { return null; }
  // Store a fresh copy after reading (a cloned body would make the read wait on a slow cache write).
  if (cache) void cache.put(url, new Response(blob, { headers: res.headers })).catch(() => {});
  // A GIBS tile outside the day's swath is a ~1 KB transparent PNG: count it as missing.
  if (blob.size < 1500) return null;
  try {
    const img = typeof createImageBitmap === "function" ? await createImageBitmap(blob) : await blobImage(blob);
    remember(url, img);
    return img;
  } catch {
    return null;
  }
}

function blobImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(img.src); ok(img); };
    img.onerror = bad;
    img.src = URL.createObjectURL(blob);
  });
}

/** Runs `jobs` with at most `n` in flight. */
async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  return out;
}

/**
 * Builds one image from the tiles of `l` covering `bbox` at level `z` (tile-aligned, clipped to the world).
 * `onProgress` is called as tiles land, so the globe can show partial results.
 */
export async function loadMosaic(
  l: LayerDef, z: number, bbox: [number, number, number, number],
  opts: { date?: string; signal?: AbortSignal; concurrency?: number; onProgress?: (m: Mosaic) => void } = {},
): Promise<Mosaic> {
  const g = levelGeometry(l.provider, z);
  const tiles = tilesFor(l.provider, z, bbox);
  const cMin = Math.min(...tiles.map((t) => t.col)), cMax = Math.max(...tiles.map((t) => t.col));
  const rMin = Math.min(...tiles.map((t) => t.row)), rMax = Math.max(...tiles.map((t) => t.row));
  const lonMin = -180 + cMin * g.tileDeg, lonMax = Math.min(180, -180 + (cMax + 1) * g.tileDeg);
  const latMax = 90 - rMin * g.tileDeg, latMin = Math.max(-90, 90 - (rMax + 1) * g.tileDeg);
  const ppd = g.px / g.tileDeg;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((lonMax - lonMin) * ppd);
  canvas.height = Math.round((latMax - latMin) * ppd);
  const ctx = canvas.getContext("2d")!;
  const keep = immutable(l, opts.date);
  const m: Mosaic = {
    canvas, bbox: [lonMin, latMin, lonMax, latMax], layer: l, level: z,
    resolution_m: Math.max(l.resolution_m, Math.round(degPerPx(l.provider, z) * 111_320)),
    servedDate: null, missing: 0, total: tiles.length,
  };
  let landed = 0;
  await pool(tiles.map((t) => async () => {
    if (opts.signal?.aborted) return;
    const url = tileUrl(l, t.z, t.row, t.col, opts.date);
    const img = await fetchTile(url, keep, opts.signal);
    if (opts.signal?.aborted) return;
    if (!img) { m.missing++; return; }
    ctx.drawImage(img, (t.col - cMin) * g.px, (t.row - rMin) * g.px);
    m.servedDate ??= served.get(url) ?? null;
    if (++landed % 4 === 0) opts.onProgress?.(m);
  }), opts.concurrency ?? 6);
  return m;
}

/** Label shown in the corner of the globe: always kind · source · date · real resolution. */
export function imageryLabel(m: Pick<Mosaic, "layer" | "servedDate" | "resolution_m">): string {
  const kind = m.layer.kind === "observacion" ? "Observación" : "Vista ilustrativa";
  const res = m.resolution_m >= 1000 ? `${(m.resolution_m / 1000).toFixed(m.resolution_m >= 10000 ? 0 : 1)} km/px` : `${m.resolution_m} m/px`;
  return [kind, m.layer.title, m.servedDate, res].filter(Boolean).join(" · ");
}
