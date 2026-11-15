// The live sky over the realistic Earth (GPU globe): clouds, rain and city lights from NASA GIBS, refreshed on their own
// cadence, plus a live detector that finds storms and heavy rain in those same pictures and follows them frame to frame.
//
// Measured 2026-11-15 against GIBS (no key, CORS open; `default` = latest time served):
// · Clouds: thermal infrared band 13 of GOES-East, GOES-West and Himawari every 10 min. Grey = brightness temperature
//   (bright = cold, high tops); coloured pixels = the enhanced scale for the coldest tops (deep convection).
//   No geostationary layer covers Europe, Africa and the Indian Ocean in GIBS → there the clouds come from yesterday's
//   VIIRS NOAA-20 true colour (white, unsaturated pixels), labelled as such.
// · Rain: IMERG early run every 30 min (~4–6 h behind), indexed palette green → yellow → red → dark red as the rate grows;
//   a separate cyan ramp marks frozen precipitation. Transparent = no rain.
// · City lights: VIIRS 2012 composite.
// One shared store: the globe and «En vivo» read the same frame, fetched once (~2–4 MB) and then every 10 minutes.

import { markStale, readSaved, saveBlob } from "@/core/live/lastgood";
import { detectTier } from "./tier";
import { layer, liveSlot, loadMosaic, type LayerDef, type Mosaic } from "./imagery";

const GIBS = "NASA EOSDIS GIBS";
const IMERG: LayerDef = { id: "IMERG_Precipitation_Rate_30min", body: "earth", provider: "gibs", role: "live", title: "Lluvia · IMERG 30 min", kind: "observacion", tms: "2km", ext: "png", maxLevel: 5, resolution_m: 10000, daily: true, live: true, start: "2000-06-01", attribution: GIBS };
const VIIRS: LayerDef = { id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", body: "earth", provider: "gibs", role: "evidence", title: "VIIRS NOAA-20", kind: "observacion", tms: "250m", ext: "jpg", maxLevel: 8, resolution_m: 250, daily: true, start: "2017-12-01", attribution: GIBS };
type Box = [number, number, number, number];
// Each geostationary disc only where it sees (skips empty tiles).
const IR: { id: string; box: Box }[] = [
  { id: "GOES-West_ABI_Band13_Clean_Infrared", box: [-180, -81, -95, 81] },
  { id: "Himawari_AHI_Band13_Clean_Infrared", box: [70, -81, 180, 81] },
  { id: "GOES-East_ABI_Band13_Clean_Infrared", box: [-156, -81, -4, 81] },
];

export type LiveKind = "tormenta" | "lluvia_intensa" | "nieve";
export type LiveTrend = "nuevo" | "crece" | "se_debilita" | "sigue";

export interface LiveDetection {
  id: number;
  kind: LiveKind;
  lat: number;
  lon: number;
  /** Approximate extent of the cells that passed the threshold (km²). */
  areaKm2: number;
  /** Share of the 1° cells inside the object above the strong threshold, 0–1. */
  strength: number;
  trend: LiveTrend;
  /** Distance travelled since the previous frame (km), when it was already being followed. */
  movedKm?: number;
  /** First time it was seen (ISO). */
  since: string;
}

export interface WeatherFrame {
  /** R = cloud cover, G = city lights, B = deep convection (coldest infrared tops). Plate carrée, whole world. */
  clouds: HTMLCanvasElement;
  /** IMERG colours with their alpha. */
  rain: HTMLCanvasElement;
  irTime: string | null;
  rainTime: string | null;
  cloudFillDate: string;
  detections: LiveDetection[];
  at: number;
}

// ---- pixel rules (pure, tested) ----

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Deep convection in GIBS's enhanced band-13 palette. Measured on a GOES-East tile (2026-11-15): grey for warm scenes,
 * then cyan/blue → green → yellow → orange → red as tops get colder. Only orange to red (the coldest tops) counts;
 * cyan and green are ordinary cold cloud.
 */
export function irConvective(r: number, g: number, b: number, a: number): boolean {
  return a >= 8 && r > 180 && b < 110 && r - g > 60;
}

/** Cloud cover from a band-13 pixel: cold = bright; any coloured (enhanced) pixel is cold cloud. */
export function irCloud(r: number, g: number, b: number, a: number): number {
  if (a < 8) return -1; // no infrared here
  if (Math.max(r, g, b) - Math.min(r, g, b) > 24) return 1;
  return smooth(120, 196, (r + g + b) / 3);
}

/** Cloud cover from a true-colour pixel (daytime): bright and grey. Snow and ice look the same (they are white too). */
export function rgbCloud(r: number, g: number, b: number): number {
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  if (mx < 20) return 0; // swath gap
  return smooth(150, 228, mn) * (1 - smooth(0.1, 0.3, (mx - mn) / (mx + 1)));
}

/**
 * Rain strength 0–1 from an IMERG palette colour (alpha 0 = none), and whether it is the frozen (cyan) ramp.
 * Green → yellow ≈ 0–0.4, yellow → red ≈ 0.4–0.8, darker red → 1.
 */
export function rainStrength(r: number, g: number, b: number, a: number): { v: number; snow: boolean } {
  if (a < 8) return { v: 0, snow: false };
  if (b > r && b > 60) return { v: 0.3 + 0.7 * (1 - Math.min(r, g) / 255), snow: true };
  if (g >= r) return { v: 0.05 + 0.35 * (r / 255), snow: false };
  if (r >= 200) return { v: 0.4 + 0.4 * (1 - g / 255), snow: false };
  return { v: 0.8 + 0.2 * (1 - r / 255), snow: false };
}

// ---- live detector ----

const KM_PER_DEG = 111.32;

interface Cluster { kind: LiveKind; lat: number; lon: number; areaKm2: number; strength: number }

/**
 * Objects on a 1° grid: cells where the strong signal covers ≥ 20 % (rain ≥ 0.55, deep convection, or strong snow),
 * joined by 8-neighbourhood (wrapping in longitude). Objects under 3 cells are dropped as noise.
 * `rain`, `conv`, `snow` are 360×180 shares, row 0 = 90° N.
 */
export function findObjects(rain: Float32Array, conv: Float32Array, snow: Float32Array): Cluster[] {
  const W = 360, H = 180, seen = new Uint8Array(W * H), out: Cluster[] = [];
  const hot = (i: number) => rain[i] >= 0.2 || conv[i] >= 0.2 || snow[i] >= 0.2;
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !hot(s)) continue;
    const stack = [s], cells: number[] = [];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const y = (i / W) | 0, x = i % W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H || (!dx && !dy)) continue;
        const j = yy * W + ((x + dx + W) % W);
        if (!seen[j] && hot(j)) { seen[j] = 1; stack.push(j); }
      }
    }
    if (cells.length < 3) continue;
    let area = 0, sx = 0, sy = 0, sz = 0, sr = 0, sc = 0, ss = 0, strong = 0;
    for (const i of cells) {
      const lat = 89.5 - ((i / W) | 0), lon = -179.5 + (i % W), c = Math.cos(lat * Math.PI / 180);
      const a = KM_PER_DEG * KM_PER_DEG * c;
      area += a;
      // centroid on the sphere (survives the antimeridian)
      sx += a * c * Math.cos(lon * Math.PI / 180); sy += a * c * Math.sin(lon * Math.PI / 180); sz += a * Math.sin(lat * Math.PI / 180);
      sr += rain[i]; sc += conv[i]; ss += snow[i];
      if (Math.max(rain[i], conv[i], snow[i]) >= 0.5) strong++;
    }
    const kind: LiveKind = ss > sr && ss > sc ? "nieve" : sc >= sr ? "tormenta" : "lluvia_intensa";
    out.push({ kind, lat: Math.atan2(sz, Math.hypot(sx, sy)) * 180 / Math.PI, lon: Math.atan2(sy, sx) * 180 / Math.PI, areaKm2: Math.round(area / 1000) * 1000, strength: strong / cells.length });
  }
  return out.sort((a, b) => b.areaKm2 - a.areaKm2);
}

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

let nextId = 1;

/** Follow objects between frames: same kind within 600 km = the same object (grew, weakened, kept going). */
export function track(prev: LiveDetection[], blobs: Cluster[], now: string, max = 24): LiveDetection[] {
  const free = new Set(prev);
  return blobs.slice(0, max).map((b) => {
    let best: LiveDetection | null = null, bestD = 600;
    for (const p of free) {
      if (p.kind !== b.kind) continue;
      const d = distanceKm(p.lat, p.lon, b.lat, b.lon);
      if (d < bestD) { best = p; bestD = d; }
    }
    if (!best) return { id: nextId++, ...b, trend: "nuevo" as const, since: now };
    free.delete(best);
    const ratio = b.areaKm2 / Math.max(1, best.areaKm2);
    const trend: LiveTrend = ratio > 1.25 ? "crece" : ratio < 0.75 ? "se_debilita" : "sigue";
    return { id: best.id, ...b, trend, movedKm: Math.round(bestD), since: best.since };
  });
}

// ---- composing a frame ----

function yesterday(): string { return new Date(Date.now() - 864e5).toISOString().slice(0, 10); }

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

/** Draw a mosaic into a whole-world plate carrée canvas at its geographic place. */
function place(g: CanvasRenderingContext2D, m: Mosaic, W: number, H: number): void {
  const [x0, y0, x1, y1] = m.bbox;
  g.drawImage(m.canvas, ((x0 + 180) / 360) * W, ((90 - y1) / 180) * H, ((x1 - x0) / 360) * W, ((y1 - y0) / 180) * H);
}

/**
 * The newest COMPLETE picture of one geostationary disc. Measured 2026-11-15: each satellite publishes on its own
 * clock and GIBS skips slots (GOES-East had nothing at 19:20 and only one tile at 19:50), so a fixed slot leaves
 * holes that show as seams. Walk back 10 minutes at a time (up to an hour), keep the most complete one found.
 */
async function latestComplete(id: string, box: Box, z: number, signal: AbortSignal): Promise<Mosaic | null> {
  let best: Mosaic | null = null;
  // Start one slot back (~40 min): the newest slot is usually still being filled, and every retry costs a full round on a slow network.
  for (let k = 1; k < 7 && !signal.aborted; k++) {
    const m = await loadMosaic(layer(id), z, box, { date: liveSlot(Date.now() - k * 600e3), signal }).catch(() => null);
    if (m && (!best || m.missing < best.missing)) best = m;
    if (m && m.missing === 0) break;
  }
  return best;
}

async function compose(prev: LiveDetection[], signal: AbortSignal): Promise<WeatherFrame> {
  const W = detectTier().tier >= 2 ? 2048 : 1024, H = W / 2;
  const z = W >= 2048 ? 2 : 1;
  const fill = yesterday();
  const world: Box = [-180, -90, 180, 90];
  const [irs, rainM, viirsM, lightsM] = await Promise.all([
    Promise.all(IR.map((s) => latestComplete(s.id, s.box, z, signal))),
    loadMosaic(IMERG, z, [-180, -60, 180, 60], { signal }).catch(() => null),
    loadMosaic(VIIRS, Math.max(0, z - 1), world, { date: fill, signal }).catch(() => null),
    loadMosaic(layer("VIIRS_CityLights_2012"), Math.max(0, z - 1), world, { signal }).catch(() => null),
  ]);
  if (signal.aborted) throw new Error("aborted");

  const work = canvas(W, H), g = work.getContext("2d", { willReadFrequently: true })!;
  const read = (m: Mosaic | null): Uint8ClampedArray | null => {
    if (!m || m.missing === m.total) return null;
    g.clearRect(0, 0, W, H);
    place(g, m, W, H);
    return g.getImageData(0, 0, W, H).data;
  };
  g.clearRect(0, 0, W, H);
  for (const m of irs) if (m && m.missing < m.total) place(g, m, W, H);
  const ir = irs.some((m) => m && m.missing < m.total) ? g.getImageData(0, 0, W, H).data : null;
  // Nothing live arrived (offline, or a dead network): keep the last good sky instead of painting an empty one.
  if (!ir && !(rainM && rainM.missing < rainM.total)) throw new Error("sin imágenes en vivo");
  const vi = read(viirsM), li = read(lightsM);

  const clouds = canvas(W, H), cg = clouds.getContext("2d")!;
  const out = cg.createImageData(W, H), o = out.data;
  // 1° shares for the detector
  const conv = new Float32Array(360 * 180), snow = new Float32Array(360 * 180), rainS = new Float32Array(360 * 180), count = new Float32Array(360 * 180);
  const cell = (p: number) => { const x = p % W, y = (p / W) | 0; return Math.min(179, (y * 180 / H) | 0) * 360 + Math.min(359, (x * 360 / W) | 0); };
  for (let p = 0, k = 0; p < W * H; p++, k += 4) {
    let c = ir ? irCloud(ir[k], ir[k + 1], ir[k + 2], ir[k + 3]) : -1;
    if (c < 0) c = vi ? rgbCloud(vi[k], vi[k + 1], vi[k + 2]) : 0;
    // Deep convection only between 55° S and 55° N: polar ice and high ice sheets are as cold as storm tops in band 13
    // (seen 2026-11-15: «storms» over Antarctica).
    else if (ir && Math.abs(90 - ((p / W) | 0) * 180 / H) <= 55 && irConvective(ir[k], ir[k + 1], ir[k + 2], ir[k + 3])) { conv[cell(p)]++; o[k + 2] = 255; }
    o[k] = Math.round(c * 255);
    o[k + 1] = li ? Math.max(0, li[k] * 0.3 + li[k + 1] * 0.59 + li[k + 2] * 0.11 - 18) * 1.1 : 0;
    o[k + 3] = 255;
    count[cell(p)]++;
  }
  cg.putImageData(out, 0, 0);

  const rain = canvas(W, H), rg = rain.getContext("2d", { willReadFrequently: true })!;
  if (rainM && rainM.missing < rainM.total) {
    place(rg, rainM, W, H);
    const rd = rg.getImageData(0, 0, W, H).data;
    for (let p = 0, k = 0; p < W * H; p++, k += 4) {
      if (rd[k + 3] < 8) continue;
      const s = rainStrength(rd[k], rd[k + 1], rd[k + 2], rd[k + 3]);
      if (s.snow ? s.v >= 0.6 : s.v >= 0.55) (s.snow ? snow : rainS)[cell(p)]++;
    }
  }
  for (let i = 0; i < count.length; i++) if (count[i]) { conv[i] /= count[i]; snow[i] /= count[i]; rainS[i] /= count[i]; }

  const irTime = irs.find((m) => m?.servedDate)?.servedDate ?? null;
  const now = new Date().toISOString();
  return {
    clouds, rain, irTime, rainTime: rainM?.servedDate ?? null, cloudFillDate: fill,
    detections: track(prev, findObjects(rainS, conv, snow), now), at: Date.now(),
  };
}

// ---- shared store ----

type Listener = (f: WeatherFrame) => void;
const listeners = new Set<Listener>();
let frame: WeatherFrame | null = null;
let timer = 0;
let ctrl: AbortController | null = null;
const REFRESH_MS = 10 * 60e3;

const SKY = "Nubes y lluvia (NASA GIBS)";

/** Keep the last good sky (two PNGs + what was detected) so the next visit shows it at once, even without network. */
async function saveFrame(f: WeatherFrame): Promise<void> {
  const png = (c: HTMLCanvasElement) => new Promise<Blob | null>((ok) => c.toBlob((b) => ok(b), "image/png"));
  const [cl, rn] = await Promise.all([png(f.clouds), png(f.rain)]);
  if (!cl || !rn) return;
  await Promise.all([
    saveBlob("sky:clouds", cl, "image/png", f.at), saveBlob("sky:rain", rn, "image/png", f.at),
    saveBlob("sky:meta", JSON.stringify({ irTime: f.irTime, rainTime: f.rainTime, cloudFillDate: f.cloudFillDate, detections: f.detections, at: f.at }), "application/json", f.at),
  ]);
}

async function restoreFrame(): Promise<WeatherFrame | null> {
  const [m, cl, rn] = await Promise.all([readSaved("sky:meta"), readSaved("sky:clouds"), readSaved("sky:rain")]);
  if (!m || !cl || !rn) return null;
  try {
    const meta = JSON.parse(await m.res.text()) as Omit<WeatherFrame, "clouds" | "rain">;
    const toCanvas = async (r: Response) => {
      const bmp = await createImageBitmap(await r.blob());
      const c = canvas(bmp.width, bmp.height);
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      bmp.close();
      return c;
    };
    return { ...meta, clouds: await toCanvas(cl.res), rain: await toCanvas(rn.res) };
  } catch { return null; }
}

async function refresh(): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) return;
  ctrl?.abort();
  const c = new AbortController();
  ctrl = c;
  // first visit of this page: the last saved sky right away (labelled), while the new one is composed
  if (!frame) {
    void restoreFrame().then((old) => {
      if (!old || frame || c.signal.aborted) return;
      frame = old;
      markStale(SKY, old.at);
      for (const l of listeners) l(old);
    });
  }
  try {
    const f = await compose(frame?.detections ?? [], c.signal);
    if (c.signal.aborted) return;
    frame = f;
    markStale(SKY, null);
    for (const l of listeners) l(f);
    void saveFrame(f);
  } catch (e) {
    if (!c.signal.aborted) { console.warn("[h247] cielo en vivo:", e); if (frame) markStale(SKY, frame.at); }
  }
}

const onVisible = () => { if (!document.hidden && frame && Date.now() - frame.at > REFRESH_MS) void refresh(); };

/** Subscribe to the live sky; the first subscriber starts it, the last one stops it. */
export function subscribeWeather(l: Listener): () => void {
  listeners.add(l);
  if (frame) l(frame);
  if (listeners.size === 1) {
    if (!frame || Date.now() - frame.at > REFRESH_MS) void refresh();
    timer = window.setInterval(() => void refresh(), REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size) { clearInterval(timer); ctrl?.abort(); document.removeEventListener("visibilitychange", onVisible); }
  };
}

export function latestWeather(): WeatherFrame | null { return frame; }
