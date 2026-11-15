import { describe, expect, it } from "vitest";
import { analyse, boxAround, histogramUrl, parseHistogram, reportingRate } from "@/core/live/fauna";
import { faunaLine } from "@/components/FaunaPanel";
import { detect, events } from "@/core/watch/anomaly";
import { parsePersonCsv, simulatePerson } from "@/core/watch/person";

function months(y0: number, y1: number) {
  const out: string[] = [];
  for (let y = y0; y <= y1; y++) for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
}

describe("animal signals (iNaturalist, effort-normalised)", () => {
  it("same URL and rate rules as ZON's Python connector", () => {
    const u = new URL(histogramUrl([-105, 23.5, -104, 24.5], "2014-01-01", "2025-12-31", 3));
    expect(u.searchParams.get("taxon_id")).toBe("3");
    expect(u.searchParams.get("swlat")).toBe("23.5000");
    expect(parseHistogram({ results: { month: { "2020-01-01": 4 } } })).toEqual({ "2020-01": 4 });
    const r = reportingRate({ "2020-01": 5, "2020-03": 50 }, { "2020-01": 10, "2020-02": 40, "2020-03": 200 });
    expect(r.times).toEqual(["2020-01", "2020-02", "2020-03"]);
    expect(Number.isNaN(r.values[0])).toBe(true);
    expect(r.values.slice(1)).toEqual([0, 250]);
  });

  it("a halving of bird reports is a sustained drop of about −50 %, though observers grew tenfold", () => {
    const ms = months(2014, 2025);
    let seed = 1;
    const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.02; };
    const all: Record<string, number> = {}, birds: Record<string, number> = {};
    ms.forEach((m, k) => {
      all[m] = Math.round(200 * (1 + (9 * k) / ms.length));
      let share = 0.25 + 0.05 * Math.sin((2 * Math.PI * (k % 12)) / 12) + noise();
      if (m >= "2024-03") share *= 0.5;
      birds[m] = Math.round(all[m] * share);
    });
    const s = analyse("aves", boxAround(24, -104.7), reportingRate(birds, all));
    const drop = s.events.find((e) => e.type === "cambio_nivel" && e.direction === "bajo");
    expect(drop).toBeDefined();
    expect(drop!.tStart >= "2024-01" && drop!.tStart <= "2024-09").toBe(true);
    expect(s.change!.pct).toBeLessThan(-35);
    expect(s.change!.pct).toBeGreaterThan(-65);
    const line = faunaLine(s, "es").text;
    expect(line).toMatch(/a la baja/);
    expect(line).not.toMatch(/prueba|causa|predic|recomend|debería|peligro|diagnós|riesgo|urgente/i);
  });
});

describe("person profile", () => {
  it("the detector finds the events injected in the simulated week", () => {
    const p = simulatePerson();
    const ev = events(detect(p.values, p.period, { valid_range: p.validRange }), p.times);
    for (const t of p.truth!) expect(ev.some((e) => e.start <= t.end && e.end >= t.start), t.what.es).toBe(true);
    // the planned daily walk is part of the cycle: no alarm at 18:00 on ordinary days
    const walk = ev.filter((e) => (e.type === "punto" || e.type === "racha") && p.times[e.start].endsWith("18:00") && e.start < 7 * 144);
    expect(walk).toHaveLength(0);
  });

  it("reads a person's own CSV into a regular grid, period = samples per day", () => {
    const rows = ["tiempo,valor"];
    for (let i = 0; i < 300; i++) if (i !== 50) rows.push(`${new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString()},${60 + (i % 24)}`);
    const r = parsePersonCsv(rows.join("\n"));
    if ("error" in r) throw new Error(r.error);
    expect(r.period).toBe(24);
    expect(r.values).toHaveLength(300);
    expect(Number.isNaN(r.values[50])).toBe(true);
    expect(parsePersonCsv("a,b\n1,2")).toEqual({ error: "few" });
  });
});
