import { describe, expect, it } from "vitest";
import { followUp } from "@/core/assistant/context";
import { parse } from "@/core/assistant/parse";
import { specForDay, specForYear } from "@/core/scene/fromData";

const ask = (t: string) => parse(t, []);

describe("follow-ups", () => {
  it("«¿y en Chihuahua?» after a livestock question keeps the topic", () => {
    const prev = ask("¿mis vacas tienen calor en Durango?");
    const next = followUp(prev, ask("¿y en Chihuahua?"), "¿y en Chihuahua?");
    expect(next.intent).toMatchObject({ t: "topic", topic: "ganado", where: { name: "Chihuahua" } });
  });
  it("«¿y la lluvia?» is a variable change that keeps the place", () => {
    const prev = ask("temperatura en Durango");
    const next = followUp(prev, ask("¿y la lluvia?"), "¿y la lluvia?");
    expect(next.intent).toEqual({ t: "variable", v: "PRECTOTCORR" });
    expect(next.place).toEqual(prev.place);
  });
  it("known places are understood without regions.json", () => {
    expect(ask("¿cómo está Torreón?").place?.kind).toBe("coord");
  });
  it("«muéstrame Durango en 3D con línea de tiempo» opens the scene with the timeline", () => {
    expect(ask("muéstrame Durango en 3D con línea de tiempo").intent).toMatchObject({ t: "scene", timeline: true, where: { name: "Durango" } });
  });
});

describe("scene from real data", () => {
  const place = { name: "Durango", lat: 24.02, lon: -104.67 };
  const days = [
    { date: "2026-11-10", t2m: 15, tmax: 24, rh: 40, rain: 0, wind: 3 },
    { date: "2026-11-11", t2m: 17, tmax: 26, rh: 30, rain: 4.8, wind: 5 },
  ];
  it("a POWER day becomes observed readings", () => {
    const s = specForDay(place, days[1]);
    expect(s.vars.temp_c).toMatchObject({ value: 17, kind: "observacion", date: "2026-11-11" });
    expect(s.vars.precip_mm_h?.value).toBe(0.2);
  });
  it("a year moves the temperature by the anomaly difference against the last year", () => {
    const s = specForYear(place, days, [-1, 0, 0.5], 2023, 2023);
    expect(s.vars.temp_c).toMatchObject({ value: 14.5, kind: "estimacion", date: "2023" }); // mean 16 + (−1 − 0.5)
  });
});

describe("swarm", () => {
  it("«reporta: el arroyo se secó en Torreón» is a report with its text and place", () => {
    const c = parse("reporta: el arroyo se secó en Torreón", []);
    expect(c.intent).toMatchObject({ t: "report", text: "el arroyo se secó en Torreón", where: { name: "Torreón" } });
  });
  it("«¿qué reporta la gente?» opens the swarm", () => {
    expect(parse("¿qué reporta la gente?", []).intent).toMatchObject({ t: "topic", topic: "red" });
  });
});

describe("real 3D zone", () => {
  it("«muéstrame Chihuahua en 3D» opens the real place, not the generated scene", () => {
    expect(parse("muéstrame Chihuahua en 3D", []).intent).toMatchObject({ t: "scene", real: true, where: { name: "Chihuahua" } });
    expect(parse("escena generada de Chihuahua", []).intent).toMatchObject({ t: "scene", real: false });
  });
});
