import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type DetectOptions, detect, events } from "@/core/watch/anomaly";

// Written by Python's hori.anomaly (detect + events) on three streams: an animal reporting rate with a drop, a simulated
// astronaut's heart rate (10 min) and a sensor with a frozen run, an impossible value and a gap.
interface Case { name: string; period: number; opts: DetectOptions; x: (number | null)[]; times?: string[]; z: (number | null)[]; phi: number;
  events: { type: string; start: number; end: number; direction?: string; severity: string }[] }
const cases = JSON.parse(readFileSync(new URL("./fixtures/anomaly_parity.json", import.meta.url), "utf8")) as Case[];

describe("HORI's anomaly detector in the browser = the Python one", () => {
  for (const c of cases) {
    it(c.name, () => {
      const res = detect(c.x, c.period, c.opts);
      expect(res.phi).toBeCloseTo(c.phi, 9);
      c.z.forEach((v, t) => {
        if (v === null) expect(Number.isFinite(res.z[t]), `z[${t}]`).toBe(false);
        else expect(res.z[t], `z[${t}]`).toBeCloseTo(v, 8);
      });
      const ev = events(res, c.times).map((e) => ({ type: e.type, start: e.start, end: e.end, ...(e.direction ? { direction: e.direction } : {}), severity: e.severity }));
      expect(ev).toEqual(c.events);
    });
  }
});
