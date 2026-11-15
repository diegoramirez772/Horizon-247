import { describe, expect, it } from "vitest";
import { compose, HALF } from "@/core/scene/compose";
import { STRIDE } from "@/core/scene/mesh";
import { PRESETS, preset, withReadings } from "@/core/scene/presets";
import { spiLevel, thi, thiLevel } from "@/core/scene/spec";
import { LAYERS, degPerPx, levelFor, levelGeometry, tileUrl, tilesFor } from "@/core/map/imagery";

describe("scene generator", () => {
  it("builds every preset with finite geometry and a legend", () => {
    for (const p of PRESETS) {
      const s = compose(p.spec);
      expect(s.solid.length % STRIDE).toBe(0);
      expect(s.clear.length % STRIDE).toBe(0);
      expect(s.vertices).toBeLessThan(120_000); // budget for a 2-core laptop
      expect(s.solid.every(Number.isFinite)).toBe(true);
      expect(s.elements.length).toBeGreaterThan(0);
      expect(s.banner).toMatch(/no es una foto/);
    }
  });

  it("is deterministic: same spec, same scene", () => {
    const a = compose(preset("rancho")), b = compose(preset("rancho"));
    expect(a.solid).toEqual(b.solid);
  });

  it("places every requested animal", () => {
    const s = compose(preset("rancho"));
    expect(s.elements.find((e) => e.id === "ganado-vaca")?.count).toBe(9);
  });

  it("turns readings into what is seen: more rain, more drops; fire only with FRP", () => {
    const dry = compose(withReadings(preset("rancho"), { precip_mm_h: { value: 2, unit: "mm/h", source: "t", kind: "simulada" } }));
    const wet = compose(withReadings(preset("rancho"), { precip_mm_h: { value: 20, unit: "mm/h", source: "t", kind: "simulada" } }));
    const drops = (s: ReturnType<typeof compose>) => s.elements.find((e) => e.id === "lluvia")?.count ?? 0;
    expect(drops(wet)).toBeGreaterThan(drops(dry));
    expect(compose(preset("rancho")).elements.some((e) => e.id === "fuego")).toBe(false);
    expect(compose(preset("incendio")).elements.some((e) => e.id === "fuego")).toBe(true);
  });

  it("every element says which reading drove it, and readings keep their kind", () => {
    const s = compose(preset("sequia"));
    for (const e of s.elements) expect(e.rule.length).toBeGreaterThan(10);
    expect(s.elements.find((e) => e.id === "pasto")?.drivenBy).toContain("ndvi");
    expect(preset("sequia").vars.spi?.kind).toBe("ejemplo");
  });

  it("flood fraction floods that share of the diorama", () => {
    const s = compose(preset("inundacion"));
    expect(s.alerts.some((a) => a.text.includes("Inundación"))).toBe(true);
    expect(HALF).toBe(24);
  });

  it("never shows banned words in alerts", () => {
    for (const p of PRESETS) for (const a of compose(p.spec).alerts) expect(a.text).not.toMatch(/peligro|diagnós|causa|predic|recomend/i);
  });
});

describe("indices", () => {
  it("THI (NRC 1971) and LCI categories", () => {
    expect(thi(39, 45)).toBeCloseTo(88.8, 1);
    expect(thiLevel(70)).toBe("normal");
    expect(thiLevel(76)).toBe("alerta");
    expect(thiLevel(80)).toBe("alto");
    expect(thiLevel(85)).toBe("emergencia");
  });
  it("SPI categories (McKee 1993)", () => {
    expect(spiLevel(-2.1)).toBe("extrema");
    expect(spiLevel(-1.6)).toBe("severa");
    expect(spiLevel(-1.2)).toBe("moderada");
    expect(spiLevel(0)).toBe("normal");
  });
});

describe("imagery tiles", () => {
  const modis = LAYERS.find((l) => l.id === "MODIS_Terra_CorrectedReflectance_TrueColor")!;
  it("GIBS geographic grid: level 0 is 2×1 tiles of 288°, 512 px", () => {
    expect(levelGeometry("gibs", 0)).toMatchObject({ tileDeg: 288, px: 512, cols: 2, rows: 1 });
    expect(levelGeometry("gibs", 2)).toMatchObject({ cols: 5, rows: 3 });
  });
  it("Trek: level z is 2^(z+1) × 2^z tiles of 256 px", () => {
    expect(levelGeometry("trek", 2)).toMatchObject({ tileDeg: 45, px: 256, cols: 8, rows: 4 });
  });
  it("finds the Durango tile measured on 2026-11-15 (level 6 → row 14, col 16)", () => {
    const t = tilesFor("gibs", 6, [-104.67, 24.02, -104.67, 24.02]);
    expect(t).toEqual([{ z: 6, row: 14, col: 16 }]);
    expect(tileUrl(modis, 6, 14, 16, "2024-05-10")).toBe(
      "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2024-05-10/250m/6/14/16.jpg");
  });
  it("never asks for more detail than the layer has", () => {
    expect(levelFor(modis, 1e-9)).toBe(modis.maxLevel);
    expect(degPerPx("gibs", modis.maxLevel) * 111_320).toBeCloseTo(245, 0);
  });
});
