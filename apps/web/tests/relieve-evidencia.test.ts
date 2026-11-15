import { describe, expect, it } from "vitest";
import type { Manifest } from "@/contract/types";
import type { Layer } from "@/core/contract/loader";
import { DRAPE_CODE, buildDrape } from "@/core/detect/drape";
import { MAP_THEMES } from "@/core/map/palette";
import { sunDir, terrainLevel, zoneHalfKm } from "@/core/terrain/TerrainView";

// 2° global grid, north → south.
const grid = { nlat: 90, nlon: 180, lat0: 89, dlat: -2, lon0: -179, dlon: 2, native_resolution_deg: 2 };
const manifest = { grid, params: { delta_sigma_per_decade: 2 } } as unknown as Manifest;
const n = 90 * 180;
const verdict = new Uint8Array(n).fill(4), effect = new Float32Array(n);
const idx = (lat: number, lon: number) => Math.round((lat - 89) / -2) * 180 + Math.round((lon + 179) / 2);
verdict[idx(25, -105)] = 1; effect[idx(25, -105)] = 0.5;
verdict[idx(25, -103)] = 3;
verdict[idx(23, -105)] = 2;
const layer = { manifest, arrays: { verdict, effect } } as unknown as Pick<Layer, "manifest" | "arrays">;

describe("HORI's verdict draped over the relief", () => {
  it("one texel per cell, north row first, the alpha says how to paint", () => {
    const d = buildDrape(layer, [-106, 22, -102, 26], MAP_THEMES.light, false, 1)!;
    expect([d.w, d.h]).toEqual([2, 2]);
    expect(d.box).toEqual([-106, 22, -102, 26]);
    const code = (x: number, y: number) => d.rgba[(y * d.w + x) * 4 + 3];
    expect(code(0, 0)).toBe(DRAPE_CODE.supported); // 25°N 105°W
    expect(code(1, 0)).toBe(DRAPE_CODE.inconclusive); // 25°N 103°W
    expect(code(0, 1)).toBe(DRAPE_CODE.candidate); // 23°N 105°W
    expect(code(1, 1)).toBe(DRAPE_CODE.noChange);
  });

  it("a 12 km zone inside one 2° cell is that one cell, painted whole", () => {
    const d = buildDrape(layer, [-105.05, 24.95, -104.95, 25.05], MAP_THEMES.light, false, 1)!;
    expect(d.w * d.h).toBe(1);
  });
});

describe("relief zone geometry", () => {
  it("12 km by default; a focus box sets the size, capped at 900 km", () => {
    expect(zoneHalfKm(24)).toBe(6);
    expect(zoneHalfKm(24, [-106, 22, -102, 26])).toBeGreaterThan(200);
    expect(zoneHalfKm(0, [-60, -20, 0, 20])).toBe(450);
  });
  it("the terrain level follows the size (30 m for 12 km, coarser for a focus)", () => {
    expect(terrainLevel(24, 6)).toBe(12);
    expect(terrainLevel(24, 450)).toBeLessThan(8);
  });
  it("the sun of 10:30 comes from the east and never sits below 12°", () => {
    const s = sunDir(24, new Date("2026-11-15T12:00:00Z"));
    expect(s[0]).toBeGreaterThan(0); // east
    expect(s[2]).toBeGreaterThan(0); // south, northern hemisphere in November
    const polar = sunDir(78, new Date("2026-12-21T12:00:00Z"));
    expect(Math.asin(polar[1]) * 180 / Math.PI).toBeGreaterThanOrEqual(11.99);
  });
});
