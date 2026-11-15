// Plan de unión: language without an LLM (U2), live NASA parsers (U5) and the generative interface (U3).
import { describe, expect, it } from "vitest";
import { amount, comparison, degreesInWords, narrateTrend, planetAverage, type TrendFacts } from "@/core/nlg/realize";
import { parsePower, thi, thiDays, thiLevel } from "@/core/live/power";
import { km, parseEonet } from "@/core/live/eonet";
import { liveSlot } from "@/core/map/imagery";
import { topicAnswer } from "@/core/genui/topic";
import { findPlace } from "@/core/genui/places";

const base: TrendFacts = {
  place: "Durango", variable: "T2M", unit: "°C", verdict: 1, effect: 0.54, lo: 0.38, hi: 0.7, mde: 0.31, delta: 0.3,
  yearsMore: 0, nYears: 24, start: 2001, end: 2024, planet: null,
};

describe("language without an LLM", () => {
  it("names degrees to the nearest quarter, with an honest qualifier", () => {
    expect(degreesInWords(0.54, "es")).toBe("algo más de medio grado");
    expect(degreesInWords(0.71, "es")).toBe("casi tres cuartos de grado");
    expect(degreesInWords(1.5, "es")).toBe("grado y medio");
    expect(degreesInWords(0.12, "es")).toBe("apenas 0,12 °C");
    expect(degreesInWords(0.5, "en")).toBe("half a degree");
  });
  it("turns rain per day into rain per year", () => {
    expect(amount(0.05, "rain", "mm/día", "es")).toBe("unos 18 mm de lluvia al año");
  });
  it("is deterministic and every number comes from the facts", () => {
    const a = narrateTrend(base, "es", true);
    expect(narrateTrend(base, "es", true)).toBe(a);
    expect(a).toContain("0,38");
    expect(a).toContain("0,7");
    expect(a).toContain("2001–2024");
  });
  it("leaves a sentence out when its fact is missing (no planet → no comparison)", () => {
    expect(narrateTrend(base, "es", false)).not.toContain("planeta");
    expect(narrateTrend({ ...base, planet: 0.27 }, "es", false)).toContain("dos veces más rápido que el promedio del planeta");
  });
  it("«not known yet» never sounds like «no change»", () => {
    const t = narrateTrend({ ...base, verdict: 3, mde: 0.62, yearsMore: 21 }, "es", false);
    expect(t).toContain("Todavía no se puede saber");
    expect(t).toContain("21 años más");
    expect(t).toContain("no significa que no cambie");
  });
  it("compares only when the difference is worth saying", () => {
    expect(comparison(0.3, 0.3, "es")).toContain("mismo ritmo");
    expect(comparison(-0.2, 0.3, "es")).toContain("al revés");
    expect(comparison(0.3, null, "es")).toBeNull();
  });
  it("averages the planet by area (cos latitude) and skips cells without data", () => {
    // 2 rows (equator, 60°N) × 1 column: weights 1 and 0.5
    expect(planetAverage([1, 4], [1, 1], 0, 60, 2, 1)).toBeCloseTo((1 + 2) / 1.5);
    expect(planetAverage([1, 4], [1, 0], 0, 60, 2, 1)).toBe(1);
  });
});

describe("NASA live data", () => {
  it("POWER: -999 days are dropped, dates are ISO", () => {
    const d = parsePower({ properties: { parameter: {
      T2M: { "20261111": 15, "20261112": -999 }, T2M_MAX: { "20261111": 22, "20261112": -999 }, RH2M: { "20261111": 50, "20261112": -999 },
      PRECTOTCORR: { "20261111": 0, "20261112": -999 }, WS2M: { "20261111": 2, "20261112": -999 } } } });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ date: "2026-11-11", t2m: 15, tmax: 22 });
  });
  it("THI (NRC 1971) and the LCI levels for cattle", () => {
    expect(thi(30, 60)).toBeCloseTo(0.8 * 30 + 0.6 * 15.6 + 46.4);
    expect([74, 75, 79, 84].map(thiLevel)).toEqual(["normal", "alerta", "alto", "muy_alto"]);
    expect(thiDays([{ date: "2026-11-11", t2m: 20, tmax: null, rh: 50, rain: 0, wind: 1 }])).toEqual([]);
  });
  it("EONET: latest position of each event, polygons by their average", () => {
    const ev = parseEonet({ events: [
      { id: "a", title: "Fire", categories: [{ id: "wildfires" }], geometry: [{ date: "2026-11-01T00:00:00Z", type: "Point", coordinates: [-100, 20] }, { date: "2026-11-03T00:00:00Z", type: "Point", coordinates: [-101, 21] }] },
      { id: "b", title: "Ice", categories: [{ id: "seaLakeIce" }], geometry: [{ date: "2026-11-02T00:00:00Z", type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]] }] },
    ] });
    expect(ev.map((e) => e.id)).toEqual(["a", "b"]);
    expect(ev[0]).toMatchObject({ lat: 21, lon: -101, cat: "wildfires" });
    expect(ev[1]).toMatchObject({ lat: 1, lon: 1 });
    expect(km({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.2, 0);
  });
  it("geostationary slot: 10-minute steps, 30 minutes behind", () => {
    expect(liveSlot(Date.UTC(2026, 10, 15, 8, 17))).toBe("2026-11-15T07:40:00Z");
  });
});

describe("generative interface", () => {
  it("each topic builds its own components, and the simulated one says so", () => {
    expect(topicAnswer("ganado", null).widgets.map((w) => w.w)).toEqual(["thi", "now"]);
    expect(topicAnswer("astronauta", null).origin).toBe("sim");
    expect(topicAnswer("marte", null).widgets[0].w).toBe("mars");
    // live storms first (detected now), then the NASA events list
    expect(topicAnswer("eventos", null).widgets).toEqual([{ w: "storms", near: null }, { w: "events", near: null }]);
  });
  it("finds places by name, without accents", () => {
    expect(findPlace("¿cómo están las vacas en Torreón?")?.name).toBe("Torreón");
    expect(findPlace("clima en ciudad de mexico")?.lat).toBeCloseTo(19.43);
    expect(findPlace("hola")).toBeNull();
  });
});
