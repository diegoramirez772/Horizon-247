// The generator: SceneSpec (place, biome, readings, entities) → one low-poly diorama + sky + legend + alerts.
// Pure and deterministic (same spec → same scene); runs on the CPU once, the GPU only draws it.
//
// Rules map readings to visible things; every rule is written in `elements[].rule` so the screen can say
// "6 clouds because cloud fraction is 45 %". The scene is generated, not observed: it illustrates the numbers,
// the numbers stay the evidence (SANTUARIO H4/H5, H12).

import { clamp, fbm, lerp, rng, seedOf, smooth } from "./math";
import { MeshBuilder, type RGBA, mix, rgb, shade } from "./mesh";
import * as M from "./models";
import { type Biome, type Body, type Entity, type SceneSpec, type VarKey, VAR_INFO, spiLevel, thi, thiLevel } from "./spec";

export const HALF = 24; // the diorama is 48 m × 48 m

export interface SceneElement { id: string; label: string; count: number; drivenBy: VarKey[]; rule: string }
export interface SceneAlert { level: "info" | "atencion" | "alto" | "emergencia"; text: string; drivenBy: VarKey[] }

export interface Sky {
  zenith: [number, number, number];
  horizon: [number, number, number];
  ground: [number, number, number];
  sunDir: [number, number, number];
  sunColor: [number, number, number];
  sunSize: number;
  stars: number;
  fogColor: [number, number, number];
  fogDensity: number;
  ambientTop: [number, number, number];
  ambientBottom: [number, number, number];
  /** Direction of the Earth disc in the Moon's sky, or null. */
  earthDir: [number, number, number] | null;
  night: boolean;
}

export interface Scene {
  solid: Float32Array;
  clear: Float32Array;
  sky: Sky;
  elements: SceneElement[];
  alerts: SceneAlert[];
  /** Height to which rain and snow fall before looping. */
  fallHeight: number;
  wind: [number, number];
  vertices: number;
  /** True when something moves (wind, rain, fire…): the view may animate; otherwise it draws once. */
  animated: boolean;
  /** Starting camera tilt (radians): lower on the Moon so the Earth shows above the horizon. */
  pitch: number;
  banner: string;
}

const C3 = (c: RGBA): [number, number, number] => [c[0], c[1], c[2]];

interface BiomeKit {
  relief: number;
  lake: boolean;
  soil: string;
  rock: string;
  ndvi: number;
  /** [kind, share] for trees/shrubs. */
  trees: [string, number][];
  treeCount: number;
  grass: number;
}

const BIOMES: Record<Biome, BiomeKit> = {
  semiarido: { relief: 1.6, lake: true, soil: "#b38b5d", rock: "#8c7a66", ndvi: 0.32, trees: [["mezquite", 0.55], ["nopal", 0.25], ["agave", 0.2]], treeCount: 26, grass: 520 },
  bosque: { relief: 4.2, lake: true, soil: "#6f5a3e", rock: "#7a7468", ndvi: 0.62, trees: [["pino", 0.65], ["encino", 0.35]], treeCount: 70, grass: 260 },
  pastizal: { relief: 0.9, lake: true, soil: "#9b7f55", rock: "#857a6a", ndvi: 0.48, trees: [["encino", 0.4], ["mezquite", 0.6]], treeCount: 10, grass: 900 },
  cultivo: { relief: 0.3, lake: true, soil: "#8a6a45", rock: "#7c7064", ndvi: 0.55, trees: [["encino", 1]], treeCount: 5, grass: 120 },
  selva: { relief: 2.5, lake: true, soil: "#5e4a33", rock: "#6c6a60", ndvi: 0.8, trees: [["encino", 0.6], ["palma", 0.4]], treeCount: 90, grass: 500 },
  costa: { relief: 1.0, lake: true, soil: "#d9c79c", rock: "#9a9488", ndvi: 0.45, trees: [["palma", 1]], treeCount: 16, grass: 250 },
  desierto: { relief: 1.8, lake: false, soil: "#d6b680", rock: "#a48a6a", ndvi: 0.08, trees: [["agave", 0.5], ["nopal", 0.5]], treeCount: 10, grass: 60 },
  tundra: { relief: 1.4, lake: true, soil: "#7a7563", rock: "#86837a", ndvi: 0.2, trees: [["pino", 1]], treeCount: 8, grass: 300 },
  urbano: { relief: 0.2, lake: false, soil: "#8d8a83", rock: "#7a776f", ndvi: 0.2, trees: [["encino", 1]], treeCount: 10, grass: 150 },
  marte: { relief: 2.6, lake: false, soil: "#b5603a", rock: "#7d4229", ndvi: 0, trees: [], treeCount: 0, grass: 0 },
  luna: { relief: 2.0, lake: false, soil: "#9a9893", rock: "#6f6d69", ndvi: 0, trees: [], treeCount: 0, grass: 0 },
};

const TREE_LABEL: Record<string, string> = { mezquite: "mezquites", nopal: "nopales", agave: "magueyes", pino: "pinos", encino: "encinos", palma: "palmas" };

function fmt(k: VarKey, v: number): string {
  const u = VAR_INFO[k].unit;
  if (k === "cloud_frac" || k === "burned_frac" || k === "flood_frac" || k === "snow_frac") return `${Math.round(v * 100)} %`;
  return `${Number.isInteger(v) ? v : v.toFixed(Math.abs(v) < 1 ? 2 : 1)}${u ? " " + u : ""}`;
}

export function compose(spec: SceneSpec): Scene {
  const seed = spec.seed ?? seedOf(`${spec.place}|${spec.biome}`);
  const r = rng(seed);
  const kit = BIOMES[spec.body === "mars" ? "marte" : spec.body === "moon" ? "luna" : spec.biome];
  const has = (k: VarKey) => spec.vars[k] !== undefined;
  const v = (k: VarKey, d: number) => spec.vars[k]?.value ?? d;
  const say = (k: VarKey) => (has(k) ? `${VAR_INFO[k].label} ${fmt(k, v(k, 0))}` : `${VAR_INFO[k].label} sin dato (valor típico)`);
  const elements: SceneElement[] = [];
  const alerts: SceneAlert[] = [];
  const add = (id: string, label: string, count: number, drivenBy: VarKey[], rule: string) => { if (count > 0) elements.push({ id, label, count, drivenBy, rule }); };

  const earth = spec.body === "earth";
  const hour = v("hour", 12);
  const temp = v("temp_c", earth ? 24 : spec.body === "mars" ? -50 : 20);
  const rh = v("rh_pct", 40);
  const precip = earth ? v("precip_mm_h", 0) : 0;
  const cloudF = earth ? v("cloud_frac", 0.25) : 0;
  const wind = v("wind_ms", 3);
  const spi = v("spi", 0);
  const soilM = v("soil_moisture", 0.22);
  const frp = earth ? v("fire_frp_mw", 0) : 0;
  const burned = earth ? v("burned_frac", frp > 0 ? 0.25 : 0) : 0;
  const flood = earth ? v("flood_frac", 0) : 0;
  const snowF = earth ? v("snow_frac", temp < -2 && precip > 0 ? 0.6 : 0) : 0;
  const aod = v("aod", 0.1);
  const dustTau = spec.body === "mars" ? v("dust_tau", 0.6) : 0;
  const ndvi = v("ndvi", kit.ndvi);

  // ---- derived states ----
  const drought = earth ? Math.max(smooth(-0.8, -2.2, spi), smooth(0.14, 0.06, soilM)) : 0;
  const green = earth ? clamp((ndvi - 0.08) / 0.6, 0, 1) * (1 - drought * 0.55) : 0;
  const freezing = temp <= 0;
  const snowing = earth && precip > 0.2 && temp < 1.5;
  const storm = earth && precip >= 15;
  const windDir: [number, number] = [Math.cos(0.6), Math.sin(0.6)];

  // ---- terrain ----
  const lakeX = -HALF * 0.45, lakeZ = HALF * 0.4;
  const crater = (x: number, z: number, cx: number, cz: number, rad: number) => {
    const d = Math.hypot(x - cx, z - cz) / rad;
    return d < 1 ? (d * d - 1) * 1.4 : d < 1.35 ? (1.35 - d) * 1.6 : 0;
  };
  const craters = spec.body !== "earth" ? Array.from({ length: spec.body === "moon" ? 7 : 3 }, () => [(r() * 2 - 1) * HALF * 0.8, (r() * 2 - 1) * HALF * 0.8, 2 + r() * 6]) : [];
  const heightRaw = (x: number, z: number): number => {
    let h = (fbm(x * 0.045 + 3, z * 0.045 + 7, seed % 1000) - 0.5) * 2 * kit.relief;
    h += (fbm(x * 0.2, z * 0.2, seed % 997) - 0.5) * 0.35;
    // flat pad in the middle for the ranch / camp
    h *= lerp(0.25, 1, smooth(5, 13, Math.hypot(x - 4, z + 2)));
    if (kit.lake) h -= 2.6 * smooth(10, 3, Math.hypot(x - lakeX, (z - lakeZ) * 1.2));
    for (const [cx, cz, rad] of craters) h += crater(x, z, cx, cz, rad);
    return h;
  };
  // Water: normal level fills the pond; drought lowers it, flood raises it over the low ground.
  // Heights are sampled once on a 0.5 m lattice and interpolated: placing hundreds of things stays cheap.
  const HN = 96, HS = (HALF * 2) / HN, hc = new Float32Array((HN + 1) * (HN + 1));
  for (let j = 0; j <= HN; j++) for (let i = 0; i <= HN; i++) hc[j * (HN + 1) + i] = heightRaw(-HALF + i * HS, -HALF + j * HS);
  const height = (x: number, z: number): number => {
    const fx = clamp((x + HALF) / HS, 0, HN - 1e-6), fz = clamp((z + HALF) / HS, 0, HN - 1e-6);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j, k = j * (HN + 1) + i;
    return lerp(lerp(hc[k], hc[k + 1], u), lerp(hc[k + HN + 1], hc[k + HN + 2], u), w);
  };
  // Water: the pond's normal level; drought lowers it. A flood fraction f puts exactly f of the area under water
  // (level = the f-quantile of the ground heights), so "45 % inundada" looks like 45 %.
  const baseLevel = -0.9;
  const sorted = Float32Array.from(hc).sort();
  const floodLevel = flood > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(flood * sorted.length))] : -99;
  const level = kit.lake ? Math.max(baseLevel - drought * 1.3, floodLevel) : -99;

  const soil = rgb(kit.soil), rockC = rgb(kit.rock);
  const lush = rgb(spec.biome === "selva" ? "#2f6b2a" : "#5b8a37"), dry = rgb("#c9a865"), bare = shade(soil, 1.05);
  const burnt = rgb("#2a2622"), snowC = rgb("#f4f6f8"), mud = rgb("#7d6448"), cracked = rgb("#a8875e");
  const burnPatch = (x: number, z: number) => burned > 0 && fbm(x * 0.07 + 11, z * 0.07 + 5, seed % 991) < burned * 0.95;
  const snowAt = (x: number, z: number, y: number) => snowF > 0 && fbm(x * 0.09, z * 0.09, 77) + y * 0.05 > 1 - snowF;

  const solid = new MeshBuilder();
  const clear = new MeshBuilder();
  solid.jitter = 0.07;
  solid.grid(-HALF, -HALF, HALF * 2, 44, height, (x, z, y, slope) => {
    let c: RGBA;
    if (!earth) c = mix(soil, rockC, clamp(slope * 0.8 + (fbm(x * 0.15, z * 0.15, 5) - 0.5), 0, 1));
    else {
      const veg = clamp(green * (0.75 + fbm(x * 0.12, z * 0.12, 9) * 0.5) - slope * 0.25, 0, 1);
      c = mix(bare, mix(dry, lush, green), veg);
      if (y < level + 0.25) c = drought > 0.3 && y > level ? mix(mud, cracked, (Math.floor(x * 2) + Math.floor(z * 2)) % 2 ? 0.7 : 0.2) : mix(c, mud, 0.6);
      if (burnPatch(x, z)) c = mix(c, burnt, 0.85);
      if (snowAt(x, z, y)) c = snowC;
      if (slope > 1.1) c = mix(c, rockC, 0.6);
    }
    return { color: c };
  });
  // Diorama sides: soil band over rock, so the scene reads as a cut-out of the place.
  solid.jitter = 0.04;
  const skirt = (ax: number, az: number, bx: number, bz: number) => {
    const n = 22;
    for (let i = 0; i < n; i++) {
      const x0 = lerp(ax, bx, i / n), z0 = lerp(az, bz, i / n), x1 = lerp(ax, bx, (i + 1) / n), z1 = lerp(az, bz, (i + 1) / n);
      const h0 = height(x0, z0), h1 = height(x1, z1);
      solid.quad([x0, h0, z0], [x1, h1, z1], [x1, h1 - 1.4, z1], [x0, h0 - 1.4, z0], { color: shade(soil, 0.75) });
      solid.quad([x0, h0 - 1.4, z0], [x1, h1 - 1.4, z1], [x1, -7, z1], [x0, -7, z0], { color: shade(rockC, 0.62) });
    }
  };
  skirt(-HALF, -HALF, HALF, -HALF); skirt(HALF, -HALF, HALF, HALF); skirt(HALF, HALF, -HALF, HALF); skirt(-HALF, HALF, -HALF, -HALF);
  solid.jitter = 0.06;

  // ---- water ----
  if (kit.lake && level > -3.4) {
    const turbid = clamp(flood * 1.6 + precip / 30, 0, 1);
    const water = mix(rgb(spec.biome === "costa" ? "#2f86b8" : "#3f7fa6", 0.82), rgb("#7a7a5c", 0.86), turbid * 0.75);
    clear.grid(-HALF, -HALF, HALF * 2, 30, () => level, () => ({ color: water, anim: 7, amount: 0.04 + wind * 0.008 }));
    // water sides where it stands above the ground at the edge
    const edge = (ax: number, az: number, bx: number, bz: number) => {
      const n = 22;
      for (let i = 0; i < n; i++) {
        const x0 = lerp(ax, bx, i / n), z0 = lerp(az, bz, i / n), x1 = lerp(ax, bx, (i + 1) / n), z1 = lerp(az, bz, (i + 1) / n);
        const h0 = Math.min(level, height(x0, z0)), h1 = Math.min(level, height(x1, z1));
        if (h0 < level || h1 < level) clear.quad([x0, level, z0], [x1, level, z1], [x1, h1, z1], [x0, h0, z0], { color: shade(water, 0.8) });
      }
    };
    edge(-HALF, -HALF, HALF, -HALF); edge(HALF, -HALF, HALF, HALF); edge(HALF, HALF, -HALF, HALF); edge(-HALF, HALF, -HALF, -HALF);
    const pondRule = drought > 0.25
      ? `Nivel bajo y lodo agrietado: ${say("spi")}, ${say("soil_moisture")}`
      : flood > 0.05 ? `Agua turbia que cubre lo bajo: ${say("flood_frac")}` : "Nivel normal (sin sequía ni inundación en los datos)";
    add("agua", flood > 0.05 ? "Agua de inundación" : "Bordo de agua", 1, ["spi", "soil_moisture", "flood_frac"], pondRule);
  }

  // ---- placement helper ----
  const taken: [number, number, number][] = [];
  const free = (x: number, z: number, rad: number) => taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) > rad + tr);
  const dryLand = (x: number, z: number, wade = 0) => height(x, z) > level + 0.3 - wade;
  let corral: [number, number] | null = null;
  const inCorral = (x: number, z: number) => corral !== null && Math.hypot(x - corral[0], z - corral[1]) < 4.6;
  /** A free spot; `wade` lets animals and people stand in shallow flood water; `open` keeps it out of the corral. */
  const spot = (rad: number, near?: [number, number, number], opt: { wade?: number; open?: boolean } = {}): [number, number, number] | null => {
    for (let k = 0; k < 60; k++) {
      const x = near ? near[0] + (r() * 2 - 1) * near[2] : (r() * 2 - 1) * (HALF - 1.5);
      const z = near ? near[1] + (r() * 2 - 1) * near[2] : (r() * 2 - 1) * (HALF - 1.5);
      if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) continue;
      if (opt.open && inCorral(x, z)) continue;
      if (dryLand(x, z, opt.wade) && free(x, z, rad)) { taken.push([x, z, rad]); return [x, Math.max(height(x, z), level - (opt.wade ?? 0)), z]; }
    }
    return near ? spot(rad, undefined, opt) : null;
  };
  const sway = clamp(wind / 12, 0.05, 1.6);

  // ---- structures and devices first (they need space) ----
  const devices = spec.entities.filter((e): e is Extract<Entity, { kind: "dispositivo" }> => e.kind === "dispositivo");
  const night = earth ? hour < 6.2 || hour > 19.2 : spec.body === "mars" ? hour < 6 || hour > 18.5 : false;
  for (const d of devices) {
    const n = d.count ?? 1;
    for (let i = 0; i < n; i++) {
      const rad = d.type === "corral" ? 4.2 : d.type === "casa" ? 3.6 : d.type === "modulo" ? 3.4 : d.type === "molino" ? 1.6 : d.type === "presa" ? 5 : 1.4;
      const pref: [number, number, number] | undefined = d.type === "corral" ? [4, -2, 2] : d.type === "bebedero" && corral ? [corral[0] + 1, corral[1] + 1, 1.5] : d.type === "presa" ? [lakeX + 6, lakeZ - 6, 1] : undefined;
      const p = spot(rad, pref, { open: true });
      if (!p) continue;
      // The corral only fences: animals and people may stand inside, trees may not (inCorral).
      if (d.type === "corral") { corral = [p[0], p[2]]; taken.pop(); }
      M.device(solid, clear, d.type, p[0], p[1], p[2], r() * 6.28, r, night);
      if (d.type !== "corral" && d.type !== "dron") M.blob(clear, p[0], p[1], p[2], rad * 0.5, rad * 0.5);
    }
  }
  const DEVICE_LABEL: Record<string, string> = { estacion: "Estación meteorológica", sensor_suelo: "Sensores de suelo", molino: "Molino de viento (papalote)", bebedero: "Bebedero", corral: "Corral", casa: "Casa", rover: "Rover", modulo: "Módulo habitable", dron: "Dron", panel_solar: "Panel solar", presa: "Bordo/presa" };
  for (const d of devices) add(`disp-${d.type}`, DEVICE_LABEL[d.type], d.count ?? 1, [], "Pedido en la escena (no sale de una medición)");

  // ---- vegetation ----
  if (earth) {
    const treeN = Math.round(kit.treeCount * (0.35 + green * 0.9));
    const counts: Record<string, number> = {};
    let deadN = 0;
    for (let i = 0; i < treeN; i++) {
      const p = spot(1.3, undefined, { open: true });
      if (!p) continue;
      const [x, y, z] = p;
      let roll = r(), kind = kit.trees[0][0];
      for (const [k, share] of kit.trees) { if (roll < share) { kind = k; break; } roll -= share; }
      const leaf = mix(rgb("#8a8f45"), rgb(kind === "pino" ? "#2f5a34" : "#3f7a35"), green);
      const trunk = rgb("#5b4330");
      if (burnPatch(x, z) && kind !== "agave" && kind !== "nopal") { M.deadTree(solid, x, y, z, 3 + r() * 3, rgb("#1e1b18"), r); deadN++; continue; }
      const sz = 0.75 + r() * 0.5;
      if (kind === "pino") M.conifer(solid, x, y, z, 7 * sz, leaf, trunk, sway, r);
      else if (kind === "encino") M.broadleaf(solid, x, y, z, 5.5 * sz, leaf, trunk, sway, r);
      else if (kind === "mezquite") M.mesquite(solid, x, y, z, 3.6 * sz, mix(leaf, rgb("#7d8a42"), 0.3), trunk, sway, r);
      else if (kind === "palma") M.palm(solid, x, y, z, 6 * sz, leaf, rgb("#8b6c4a"), sway, r);
      else if (kind === "nopal") M.nopal(solid, x, y, z, 1.6 * sz, mix(rgb("#8f9a52"), rgb("#4f8a4a"), green), r);
      else M.agave(solid, x, y, z, 1.3 * sz, mix(rgb("#9aa67a"), rgb("#5f8f78"), green), r);
      if (kind !== "agave" && kind !== "nopal") M.blob(clear, x, y, z, 1.6 * sz, 1.6 * sz);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const what = Object.entries(counts).map(([k, n]) => `${n} ${TREE_LABEL[k]}`).join(", ");
    add("arboles", "Árboles y arbustos", total, ["ndvi", "spi"], `${what}. Cantidad y verdor según ${say("ndvi")}${drought > 0.2 ? `; amarillean por sequía (${say("spi")})` : ""}`);
    if (deadN) add("quemados", "Árboles quemados", deadN, ["burned_frac"], `Troncos sin hojas donde ${say("burned_frac")}`);
    // grass
    const grassN = Math.round(kit.grass * (0.15 + green * 1.1) * (1 - burned * 0.8) * (1 - snowF * 0.8));
    let g = 0;
    for (let i = 0; i < grassN * 2 && g < grassN; i++) {
      const x = (r() * 2 - 1) * (HALF - 0.5), z = (r() * 2 - 1) * (HALF - 0.5), y = height(x, z);
      if (y < level + 0.15 || burnPatch(x, z) || inCorral(x, z)) continue;
      const col = mix(dry, lush, clamp(green + (r() - 0.5) * 0.25, 0, 1));
      M.grassTuft(solid, x, y, z, 0.25 + green * 0.45, col, sway, r);
      g++;
    }
    add("pasto", "Pasto", g, ["ndvi", "spi", "wind_ms"], `Densidad y color por ${say("ndvi")}; se mueve con ${say("wind_ms")}`);
    if (spec.biome === "cultivo") {
      let n = 0;
      for (let row = 0; row < 9; row++) for (let i = 0; i < 18; i++) {
        const x = -16 + i * 1.1, z = 6 + row * 1.2, y = height(x, z);
        if (y < level - 0.7 || burnPatch(x, z)) continue; // crops stick out of shallow flood water
        M.maize(solid, x, y, z, 0.6 + green * 1.6, mix(rgb("#c4a75a"), rgb("#4f8f3a"), green), sway, r);
        n++;
      }
      add("maiz", "Milpa (maíz)", n, ["ndvi"], `Altura y color por ${say("ndvi")}`);
    }
  }
  // rocks everywhere (lots on Mars and the Moon)
  const rockN = earth ? 10 : 70;
  for (let i = 0; i < rockN; i++) {
    const x = (r() * 2 - 1) * (HALF - 1), z = (r() * 2 - 1) * (HALF - 1), y = height(x, z);
    if (y < level) continue;
    M.rock(solid, x, y, z, earth ? 0.4 + r() * 0.6 : 0.2 + r() * r() * 1.6, rockC, r);
  }

  // ---- livestock ----
  const thiV = thi(temp, rh), thiL = thiLevel(thiV);
  const stressed = thiL === "alto" || thiL === "emergencia";
  const shadeSpots = taken.filter((t) => t[2] === 1.3);
  for (const e of spec.entities) {
    if (e.kind !== "ganado") continue;
    let placed = 0;
    for (let i = 0; i < e.count; i++) {
      // Under heat stress cattle seek shade (tree) or water; otherwise they graze spread out.
      const tree = stressed && shadeSpots.length ? shadeSpots[Math.floor(r() * shadeSpots.length)] : null;
      const near: [number, number, number] | undefined = tree ? [tree[0] + 1.2, tree[1] + 1.2, 1.6] : corral && i % 3 === 0 ? [corral[0], corral[1], 2.5] : undefined;
      const p = spot(1.1, near, { wade: flood > 0.05 ? 0.5 : 0 });
      if (!p) continue;
      const head = stressed ? (r() < 0.5 ? "lying" : "up") : drought > 0.5 ? "down" : r() < 0.6 ? "down" : "up";
      M.quadruped(solid, p[0], p[1], p[2], r() * 6.28, { species: e.species, breed: e.breed, collar: e.collar, head }, r);
      M.blob(clear, p[0], p[1], p[2], 0.9, 1.3);
      placed++;
    }
    const sp = { vaca: "vacas", toro: "toros", becerro: "becerros", borrego: "borregos", cabra: "cabras", caballo: "caballos" }[e.species];
    add(`ganado-${e.species}`, `Ganado: ${sp}${e.breed ? ` ${e.breed}` : ""}`, placed, ["temp_c", "rh_pct"],
      stressed ? `Buscan sombra o se echan: índice de estrés térmico THI ${thiV.toFixed(0)} (${thiL}) con ${say("temp_c")} y ${say("rh_pct")}` : `Pastan: THI ${thiV.toFixed(0)} (${thiL})`);
    if (e.collar) add(`collar-${e.species}`, "Collares GPS", placed, [], "Dispositivo simulado en cada animal");
  }
  if (spec.entities.some((e) => e.kind === "ganado") && thiL !== "normal") {
    alerts.push({ level: thiL === "alerta" ? "atencion" : thiL, text: `Estrés térmico del ganado: THI ${thiV.toFixed(0)} = ${thiL} (umbral LCI). Es un índice de riesgo del ambiente; no describe la salud de cada animal.`, drivenBy: ["temp_c", "rh_pct"] });
  }

  // ---- people ----
  for (const e of spec.entities) {
    if (e.kind !== "personas") continue;
    let placed = 0;
    for (let i = 0; i < e.count; i++) {
      const p = spot(0.6, corral ? [corral[0], corral[1], 6] : undefined, { wade: flood > 0.05 ? 0.4 : 0 });
      if (!p) continue;
      M.person(solid, p[0], p[1], p[2], r() * 6.28, e.role, r);
      M.blob(clear, p[0], p[1], p[2], 0.35, 0.35);
      placed++;
    }
    const lbl = { vaquero: "Vaqueros", agricultor: "Agricultores", brigadista: "Brigadistas", astronauta: "Astronautas", cientifico: "Científicos", habitante: "Habitantes" }[e.role];
    add(`personas-${e.role}`, lbl, placed, [], e.role === "astronauta" ? "SIMULADO: no hay datos médicos reales" : "Pedido en la escena (no sale de una medición)");
  }

  // ---- fire ----
  if (frp > 0) {
    const fronts = clamp(Math.round(2 + frp / 25), 2, 22);
    let n = 0;
    for (let i = 0; i < fronts * 12 && n < fronts; i++) {
      const x = (r() * 2 - 1) * (HALF - 3), z = (r() * 2 - 1) * (HALF - 3);
      if (!burnPatch(x, z) && i < fronts * 10) continue;
      const y = height(x, z);
      if (y < level + 0.2) continue;
      for (let k = 0; k < 3; k++) M.flame(solid, x + (r() - 0.5) * 1.5, y, z + (r() - 0.5) * 1.5, 0.8 + r() * (0.6 + frp / 120), r);
      M.smoke(clear, x + windDir[0] * 1.5, y + 2, z + windDir[1] * 1.5, 5, clamp(frp / 200, 0.2, 1), wind, r);
      n++;
    }
    add("fuego", "Frentes de fuego y humo", n, ["fire_frp_mw", "wind_ms"], `Número y altura de llamas por ${say("fire_frp_mw")}; el humo se inclina con ${say("wind_ms")}`);
    alerts.push({ level: frp > 100 ? "emergencia" : "alto", text: `Fuego activo: ${say("fire_frp_mw")}. La escena lo ilustra; la ubicación real está en la capa de anomalías térmicas.`, drivenBy: ["fire_frp_mw"] });
  }

  // ---- clouds, rain, snow, lightning, dust ----
  const cloudBase = earth ? 19 : 0;
  if (earth && cloudF > 0.03) {
    const n = Math.round(1 + cloudF * 13);
    const darkness = clamp(precip / 12 + (cloudF > 0.8 ? 0.25 : 0), 0, 0.75);
    const col = mix(rgb("#ffffff"), rgb("#5d6670"), darkness);
    for (let i = 0; i < n; i++) {
      const x = (r() * 2 - 1) * HALF * 0.85, z = (r() * 2 - 1) * HALF * 0.85;
      M.cloud(solid, x, cloudBase + r() * 3, z, 2.4 + r() * 1.8 + cloudF * 1.2, col, storm && i < 2, r);
    }
    add("nubes", "Nubes", n, ["cloud_frac", "precip_mm_h"], `${n} nubes por ${say("cloud_frac")}; más oscuras con ${say("precip_mm_h")}${storm ? "; torres de tormenta (cumulonimbos)" : ""}`);
  }
  if (precip > 0.1 && !snowing) {
    const n = Math.round(clamp(precip * 130, 60, 2600));
    M.rain(clear, n, HALF, cloudBase, rgb("#d6e6f5", 0.72), 14 + precip * 0.3, r);
    add("lluvia", "Lluvia", n, ["precip_mm_h"], `${n} gotas por ${say("precip_mm_h")}`);
  }
  if (snowing) {
    const n = Math.round(clamp(precip * 200, 200, 2200));
    M.snow(clear, n, HALF, cloudBase, r);
    add("nieve", "Nevada", n, ["precip_mm_h", "temp_c"], `Cae nieve porque ${say("temp_c")} con ${say("precip_mm_h")}`);
  }
  if (snowF > 0) add("nieve-suelo", "Nieve en el suelo", 1, ["snow_frac"], `Manchas blancas según ${say("snow_frac")}`);
  if (storm) {
    for (let i = 0; i < 2; i++) M.lightning(solid, (r() * 2 - 1) * HALF * 0.7, cloudBase, (r() * 2 - 1) * HALF * 0.7, r);
    add("rayos", "Rayos", 2, ["precip_mm_h"], `Tormenta: ${say("precip_mm_h")} (≥ 15 mm/h)`);
    alerts.push({ level: "alto", text: `Lluvia intensa: ${say("precip_mm_h")}. Riesgo de encharcamiento y rayos.`, drivenBy: ["precip_mm_h"] });
  }
  const dusty = (earth && (aod > 0.8 || (drought > 0.5 && wind > 9))) || (spec.body === "mars" && (dustTau > 1.2 || wind > 8));
  if (dusty) {
    const amount = earth ? clamp(aod, 0.5, 3) : clamp(dustTau, 0.8, 5);
    const col = earth ? rgb("#c9a273", 0.55) : rgb("#c27a4c", 0.55);
    const n = Math.round(300 * amount);
    M.dust(clear, n, HALF, col, 3 + wind * 0.6, r);
    if (wind > 6) M.dustDevil(clear, (r() * 2 - 1) * 12, (r() * 2 - 1) * 12, 9, col, r);
    add("polvo", "Polvo en el aire", n, earth ? ["aod", "wind_ms", "spi"] : ["dust_tau", "wind_ms"], earth ? `Por ${say("aod")} y ${say("wind_ms")}` : `Por ${say("dust_tau")} y ${say("wind_ms")}`);
  }

  // ---- other alerts from the readings ----
  if (earth && drought > 0.25) {
    const lvl = spiLevel(spi);
    alerts.push({ level: lvl === "extrema" ? "emergencia" : lvl === "severa" ? "alto" : "atencion", text: `Sequía ${has("spi") ? lvl : ""}: ${say("spi")}${has("soil_moisture") ? `, ${say("soil_moisture")}` : ""}. Menos agua y forraje para el ganado.`, drivenBy: ["spi", "soil_moisture"] });
  }
  if (earth && flood > 0.05) alerts.push({ level: flood > 0.3 ? "emergencia" : "alto", text: `Inundación: ${say("flood_frac")} del área. Mover animales a lo alto.`, drivenBy: ["flood_frac"] });
  if (earth && freezing && spec.entities.some((e) => e.kind === "ganado" || e.kind === "personas")) alerts.push({ level: temp < -8 ? "alto" : "atencion", text: `Helada: ${say("temp_c")}. Proteger crías y agua de bebederos.`, drivenBy: ["temp_c"] });
  if (spec.body === "mars" && dustTau > 2) alerts.push({ level: "alto", text: `Tormenta de polvo: ${say("dust_tau")}. Menos energía solar para el rover y el módulo (simulado).`, drivenBy: ["dust_tau"] });

  // ---- sky ----
  const sky = makeSky(spec.body, hour, { cloudF, precip, aod, dustTau, frp, drought, temp });
  const animated = wind > 0.3 || precip > 0.1 || frp > 0 || dusty || storm || earth;

  const solidArr = solid.toArray(), clearArr = clear.toArray();
  return {
    solid: solidArr, clear: clearArr, sky, elements, alerts,
    fallHeight: cloudBase || 15, wind: [windDir[0] * wind, windDir[1] * wind],
    vertices: solid.vertexCount + clear.vertexCount, animated, pitch: spec.body === "moon" ? 0.2 : 0.42,
    banner: "Escena generada a partir de los datos: ilustra, no es una foto. Cada elemento dice qué dato lo produjo.",
  };
}

function makeSky(body: Body, hour: number, s: { cloudF: number; precip: number; aod: number; dustTau: number; frp: number; drought: number; temp: number }): Sky {
  // Sun path: rises at 6, sets at 18 (solar time), 65° high at noon. Azimuth east → west.
  const t = (hour - 6) / 12;
  const elev = Math.sin(clamp(t, -0.15, 1.15) * Math.PI) * (65 * Math.PI / 180);
  const az = lerp(-1.6, 1.6, clamp(t, 0, 1)) + 0.4;
  const sunDir: [number, number, number] = [Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)];
  const day = smooth(-0.1, 0.18, sunDir[1]);
  const golden = smooth(0.45, 0.05, sunDir[1]) * day;
  const v3 = (c: RGBA): [number, number, number] => C3(c);
  if (body === "moon") {
    return {
      zenith: [0, 0, 0], horizon: [0.02, 0.02, 0.03], ground: [0.01, 0.01, 0.015], sunDir: [-0.5, 0.45, -0.6], sunColor: [1.25, 1.22, 1.18], sunSize: 0.9995,
      stars: 1, fogColor: [0, 0, 0], fogDensity: 0, ambientTop: [0.06, 0.06, 0.07], ambientBottom: [0.03, 0.03, 0.03], earthDir: [-0.66, 0.09, -0.75], night: false,
    };
  }
  if (body === "mars") {
    const dust = clamp(s.dustTau / 4, 0, 1);
    const zen = mix(rgb("#b4895f"), rgb("#8a6a52"), dust), hor = mix(rgb("#dcb68a"), rgb("#b08664"), dust);
    const k = 0.35 + 0.65 * day;
    return {
      zenith: v3(shade(zen, k)), horizon: v3(shade(mix(hor, rgb("#7f9ab8"), golden * 0.35), k)), ground: v3(shade(hor, 0.6 * k)),
      sunDir, sunColor: [1.0 * (1 - dust * 0.5) * day, 0.93 * (1 - dust * 0.5) * day, 0.85 * (1 - dust * 0.5) * day], sunSize: 0.9997,
      stars: 1 - day, fogColor: v3(shade(hor, k)), fogDensity: 0.004 + dust * 0.025,
      ambientTop: v3(shade(zen, 0.55 * k)), ambientBottom: v3(shade(rgb("#5a3220"), 0.5 * k)), earthDir: null, night: day < 0.3,
    };
  }
  const overcast = clamp((s.cloudF - 0.55) * 2 + s.precip / 10, 0, 1);
  const haze = clamp(s.aod / 1.5 + s.frp / 300 + s.drought * 0.15, 0, 1);
  let zen = rgb("#3a78d0"), hor = rgb("#b9d6f2");
  hor = mix(hor, rgb("#f0a35e"), golden * 0.85);
  zen = mix(zen, rgb("#5a6fa8"), golden * 0.4);
  const smokeTint = s.frp > 0 ? rgb("#a99a88") : rgb("#d8c3a0");
  zen = mix(zen, smokeTint, haze * 0.6); hor = mix(hor, smokeTint, haze * 0.8);
  zen = mix(zen, rgb("#7c8792"), overcast); hor = mix(hor, rgb("#a9b1b8"), overcast);
  const nightZ = rgb("#040814"), nightH = rgb("#18223d");
  zen = mix(nightZ, zen, day); hor = mix(nightH, hor, day);
  const sunK = day * (1 - overcast * 0.7) * (1 - haze * 0.35);
  const sunCol = mix(rgb("#fff4e0"), rgb("#ffb070"), golden);
  const moon = 1 - day;
  return {
    zenith: v3(zen), horizon: v3(hor), ground: v3(shade(hor, 0.72)),
    sunDir: day > 0.05 ? sunDir : [-sunDir[0], Math.max(0.35, -sunDir[1]), -sunDir[2]],
    sunColor: day > 0.05 ? [sunCol[0] * 1.15 * sunK, sunCol[1] * 1.12 * sunK, sunCol[2] * 1.05 * sunK] : [0.16 * moon, 0.2 * moon, 0.3 * moon],
    sunSize: 0.9994, stars: clamp(moon * (1 - overcast), 0, 1),
    fogColor: v3(hor), fogDensity: 0.002 + haze * 0.012 + overcast * 0.003 + clamp(s.precip / 120, 0, 0.004),
    ambientTop: v3(shade(mix(zen, rgb("#ffffff"), 0.25), 0.62)), ambientBottom: v3(shade(rgb("#6b5a44"), 0.35 * (0.3 + 0.7 * day))),
    earthDir: null, night: day < 0.3,
  };
}
