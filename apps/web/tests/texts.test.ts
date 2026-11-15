import { describe, expect, it } from "vitest";
import type { Verdict } from "@/contract/types";
import { FORBIDDEN, LEGEND, TEMPLATES, UI, verdictText, type Lang, type Register } from "@/core/i18n/texts";

/** Collects every string (and the output of every text function) inside a value. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v === "function") return strings((v as (...a: unknown[]) => unknown)("1", "2"));
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

const values = {
  effect: "0,3", unit: "°C", lo: "+0,2", hi: "+0,4", N: "1 203", k: "2", n: "24", mde: "0,8 °C",
  delta: "0,9 °C", years: "12", variable: "la temperatura", rising: true,
};

describe("doc 04 §4 · text lint", () => {
  it("no forbidden word in any interface text, legend or verdict template", () => {
    const all = [...strings(UI), ...strings(LEGEND), ...strings(TEMPLATES)];
    expect(all.length).toBeGreaterThan(100);
    for (const s of all) for (const re of FORBIDDEN) expect(s, `«${s}»`).not.toMatch(re);
  });

  it("ES and EN have the same keys", () => {
    expect(Object.keys(UI.en).sort()).toEqual(Object.keys(UI.es).sort());
  });
});

describe("verdict sentences (SPEC §5 and §8.5, verbatim)", () => {
  for (const lang of ["es", "en"] as Lang[]) for (const reg of ["sencillo", "tecnico"] as Register[]) {
    it(`${lang}/${reg}: every placeholder is filled`, () => {
      for (const v of [0, 1, 2, 3, 4] as Verdict[]) expect(verdictText(v, reg, lang, values)).not.toMatch(/[{}]/);
    });
  }
  it("plain register uses sube/baja for the direction", () => {
    expect(verdictText(1, "sencillo", "es", values)).toContain("la temperatura sube unos 0,3 °C cada 10 años");
    expect(verdictText(1, "sencillo", "es", { ...values, rising: false })).toContain("baja");
  });
  it("PROBADO is shown as «Cambio detectado» (decision D6)", () => {
    expect(LEGEND.es[1].phrase).toBe("Cambio detectado");
    expect(LEGEND.en[1].phrase).toBe("Change detected");
  });
  it("the selector says Sencillo / Experto (decision D3)", () => {
    expect(UI.es.register).toEqual({ sencillo: "Sencillo", tecnico: "Experto" });
  });
});
