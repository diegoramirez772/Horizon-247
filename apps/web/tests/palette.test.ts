import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAP_THEMES, contrast, effectStep, luminance, moreIsBlue, seqStep, stepColor } from "@/core/map/palette";

const css = readFileSync(join(__dirname, "..", "src", "app", "globals.css"), "utf8");

/** Reads `--name: #hex` from the first block that starts with `selector {`. */
function token(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${selector} --${name} not found`);
  return m[1].toUpperCase();
}
const THEMES = { light: ":root", dark: ':root[data-theme="dark"]' } as const;

describe("data colour on the map", () => {
  for (const [name, t] of Object.entries(MAP_THEMES)) {
    it(`${name}: every step keeps ≥ 3:1 against ocean AND land (WCAG 1.4.11)`, () => {
      for (const c of [...t.red, ...t.blue, ...t.seq, t.noChange]) {
        expect(contrast(c, t.ocean), `${c} on ocean`).toBeGreaterThanOrEqual(3);
        expect(contrast(c, t.land), `${c} on land`).toBeGreaterThanOrEqual(3);
      }
    });
    it(`${name}: texture ink stands out from ocean and land`, () => {
      expect(contrast(t.ink, t.ocean)).toBeGreaterThanOrEqual(7);
      expect(contrast(t.ink, t.land)).toBeGreaterThanOrEqual(7);
    });
  }
  it("the map's no-change grey is the CSS token (one source)", () => {
    expect(MAP_THEMES.dark.noChange).toBe(token(THEMES.dark, "no-change"));
    expect(MAP_THEMES.light.noChange).toBe(token(THEMES.light, "no-change"));
  });
});

describe("interface tokens", () => {
  for (const [name, sel] of Object.entries(THEMES)) {
    it(`${name}: text passes AA (≥ 4.5:1) on background and surfaces; controls ≥ 3:1`, () => {
      for (const bg of ["bg", "surface", "surface-2"]) {
        for (const n of ["text", "text-2", "text-3"]) expect(contrast(token(sel, n), token(sel, bg)), `${n} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(token(sel, "border-control"), token(sel, "bg"))).toBeGreaterThanOrEqual(3);
    });
    it(`${name}: the accent is readable as text and carries readable text`, () => {
      expect(contrast(token(sel, "accent"), token(sel, "bg"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(sel, "on-accent"), token(sel, "accent"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(sel, "focus"), token(sel, "bg"))).toBeGreaterThanOrEqual(3);
    });
  }
  it("the SIMULADO strip is high contrast", () => {
    expect(contrast(token(THEMES.dark, "on-sim"), token(THEMES.dark, "sim"))).toBeGreaterThanOrEqual(7);
  });
});

describe("effect → colour step", () => {
  it("bins |effect|/scale into thirds and keeps the sign", () => {
    expect(effectStep(0.1, 1)).toBe(1);
    expect(effectStep(-0.5, 1)).toBe(-2);
    expect(effectStep(5, 1)).toBe(3);
    expect(effectStep(NaN, 1)).toBe(0);
  });
  it("'more' is red unless the variable says blue (or looks like rain)", () => {
    const t = MAP_THEMES.light;
    expect(stepColor(t, 3, false)).toBe(t.red[2]);
    expect(stepColor(t, 3, true)).toBe(t.blue[2]);
    expect(moreIsBlue({ name: "precip_gpcp" })).toBe(true);
    expect(moreIsBlue({ name: "temp", color_more: "blue" })).toBe(true);
    expect(moreIsBlue({ name: "lluvia", color_more: "red" })).toBe(false);
  });
});

describe("sequential ramp (Experto metrics: MDE, years needed)", () => {
  it("is ordered by lightness (monotonic), so 'more' always reads the same way", () => {
    const d = MAP_THEMES.dark.seq.map(luminance), l = MAP_THEMES.light.seq.map(luminance);
    for (let i = 1; i < 5; i++) { expect(d[i]).toBeGreaterThan(d[i - 1]); expect(l[i]).toBeLessThan(l[i - 1]); }
  });
  it("bins values into five steps and leaves missing values uncoloured", () => {
    expect(seqStep(0, 0, 10)).toBe(0);
    expect(seqStep(9.99, 0, 10)).toBe(4);
    expect(seqStep(50, 0, 10)).toBe(4);
    expect(seqStep(NaN, 0, 10)).toBe(-1);
  });
});
