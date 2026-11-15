import { describe, expect, it } from "vitest";
import { findObjects, irCloud, irConvective, rainStrength, rgbCloud, track } from "@/core/map/weather";

describe("cielo en vivo", () => {
  it("infrarrojo: frío = nube, realce de color = convección, transparente = sin dato", () => {
    expect(irCloud(100, 100, 100, 255)).toBe(0);
    expect(irCloud(220, 220, 220, 255)).toBe(1);
    expect(irCloud(244, 115, 0, 255)).toBe(1);
    expect(irCloud(0, 0, 0, 0)).toBe(-1);
  });

  it("convección profunda = solo naranja a rojo de la paleta realzada (cian y verde son nube fría normal)", () => {
    expect(irConvective(244, 115, 0, 255)).toBe(true);
    expect(irConvective(255, 30, 20, 255)).toBe(true);
    expect(irConvective(98, 150, 153, 255)).toBe(false);
    expect(irConvective(104, 194, 26, 255)).toBe(false);
    expect(irConvective(220, 220, 220, 255)).toBe(false);
  });

  it("color real: blanco y gris = nube; verde o franja negra = no", () => {
    expect(rgbCloud(240, 240, 245)).toBe(1);
    expect(rgbCloud(40, 90, 30)).toBe(0);
    expect(rgbCloud(0, 0, 0)).toBe(0);
  });

  it("paleta IMERG: verde < amarillo < rojo < rojo oscuro; cian = helada", () => {
    const v = [[0, 151, 31], [247, 217, 0], [255, 66, 51], [131, 0, 0]].map(([r, g, b]) => rainStrength(r, g, b, 255).v);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
    expect(rainStrength(134, 224, 238, 255).snow).toBe(true);
    expect(rainStrength(0, 0, 0, 0).v).toBe(0);
  });

  it("une celdas vecinas, cruza el antimeridiano, descarta ruido y sigue objetos entre imágenes", () => {
    const N = 360 * 180, rain = new Float32Array(N), conv = new Float32Array(N), snow = new Float32Array(N);
    for (let y = 60; y < 66; y++) for (let x = 70; x < 76; x++) rain[y * 360 + x] = 0.8;
    for (let y = 80; y < 83; y++) for (const x of [358, 359, 0, 1]) conv[y * 360 + x] = 0.6;
    rain[10 * 360 + 10] = 1;
    const b = findObjects(rain, conv, snow);
    expect(b.map((o) => o.kind)).toEqual(["lluvia_intensa", "tormenta"]);
    expect(b[0].lat).toBeCloseTo(27, 0);
    expect(b[0].lon).toBeCloseTo(-107, 0);
    expect(Math.abs(b[1].lon)).toBeCloseTo(180, 0);
    const t1 = track([], b, "T1");
    const t2 = track(t1, b.map((o) => ({ ...o, lon: o.lon + 1, areaKm2: o.areaKm2 * 1.5 })), "T2");
    expect(t2.map((d) => [d.id, d.trend, d.since])).toEqual(t1.map((d) => [d.id, "crece", "T1"]));
  });
});
