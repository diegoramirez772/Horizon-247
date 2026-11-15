import { describe, expect, it } from "vitest";
import type { ContextCard, Manifest } from "@/contract/types";
import { ContractError, cellIndexAt, cellLatLon, checkManifest, decodeBinary, parseRegions, visibleContext } from "@/core/contract/loader";
import { signed, trendLine } from "@/core/format/format";
import { DEFAULT_STATE, fromSearch, toSearch } from "@/core/state/store";

const grid = { nlat: 90, nlon: 180, lat0: 89, dlat: -2, lon0: -179, dlon: 2, native_resolution_deg: 2 };
const m = { grid } as Manifest;

describe("contract loader", () => {
  it("rejects an array of the wrong size with a clear message", () => {
    expect(() => decodeBinary(new ArrayBuffer(12), "f32", 4, "effect.f32")).toThrow(ContractError);
    expect(() => decodeBinary(new ArrayBuffer(12), "f32", 4, "effect.f32")).toThrow(/se esperaban 16 bytes y llegaron 12/);
    expect(decodeBinary(new ArrayBuffer(16), "f32", 4)).toHaveLength(4);
  });

  it("cell index ⇄ lat/lon round-trips (row-major, north to south, west to east)", () => {
    for (const i of [0, 179, 180, 8099, 16199]) {
      const { lat, lon } = cellLatLon(m, i);
      expect(cellIndexAt(m, lat, lon)).toBe(i);
    }
    expect(cellLatLon(m, 0)).toEqual({ lat: 89, lon: -179 });
    expect(cellIndexAt(m, 24, -104.7)).toBeGreaterThan(0);
    expect(cellIndexAt(m, 95, 0)).toBe(-1);
  });

  it("accepts contracts 0.1 to 0.4 (additive), rejects others", () => {
    const base = { grid, arrays: { verdict: {}, effect: {} }, honesty: {} } as unknown as Manifest;
    expect(() => checkManifest({ ...base, contract: "0.2" })).not.toThrow();
    expect(() => checkManifest({ ...base, contract: "0.4" })).not.toThrow();
    expect(() => checkManifest({ ...base, contract: "0.9" as "0.1" })).toThrow(/versión de contrato/);
    expect(() => checkManifest({ ...base, contract: "0.1", honesty: undefined as unknown as Manifest["honesty"] })).toThrow(/honesty/);
  });

  it("regions.json snake_case → camelCase (SPEC §8.2 vs §8.7)", () => {
    const [r] = parseRegions([{ id: "mx-dgo", name: { es: "Durango", en: "Durango" }, layers: { L: {
      n_cells: 4, flags: 8, series: [1, 2], effect: 0.3, ci: [0.1, 0.5], p_cons: 0.01, q_regions: 0.02,
      verdict: 1, mde: 0.2, years_more: null, emergence_year: 2019 } } }]);
    expect(r.layers.L).toMatchObject({ pCons: 0.01, qRegions: 0.02, yearsMore: null, emergenceYear: 2019 });
  });

  it("context cards in draft, without source or of level ACCION are never shown (SPEC §8.4)", () => {
    const card = (o: Partial<ContextCard>): ContextCard => ({ id: "a", region: "r", level: "OBSERVACION", text: { es: "", en: "" },
      source: { title: "t", url: "https://x", year: 2024 }, status: "revisado", ...o });
    const out = visibleContext([card({}), card({ status: "borrador" }), card({ level: "ACCION" }), card({ source: { title: "t", url: "", year: 1 } })]);
    expect(out).toHaveLength(1);
  });
});

describe("state ⇄ URL (A4: switching register keeps your place)", () => {
  it("round-trips layer, selection, register, language and time", () => {
    const s = { ...DEFAULT_STATE, layerId: "temp_45", selection: { kind: "cell" as const, index: 123 }, register: "tecnico" as const,
      lang: "en" as const, timeMode: "anual" as const, year: 2019 };
    expect(fromSearch(toSearch(s), DEFAULT_STATE)).toEqual(s);
  });
  it("normal round-trips through the URL", () => {
    const s = { ...DEFAULT_STATE, register: "normal" as const, layerId: "L" };
    expect(fromSearch(toSearch(s), DEFAULT_STATE)).toEqual(s);
  });
  it("changing only the register leaves everything else as it was", () => {
    const a = { ...DEFAULT_STATE, layerId: "L", selection: { kind: "region" as const, id: "mx-dgo" } };
    const b = fromSearch(toSearch({ ...a, register: "tecnico" }), DEFAULT_STATE);
    expect({ ...b, register: a.register }).toEqual(a);
  });
  it("ignores junk and falls back to Spanish for other languages", () => {
    const s = fromSearch("?tab=nope&sel=c:-4&t=x&lang=fr", DEFAULT_STATE, "fr-FR");
    expect(s).toMatchObject({ tab: "cambio", selection: null, timeMode: "completa", lang: "es" });
    expect(fromSearch("", DEFAULT_STATE, "en-US").lang).toBe("en");
  });
});

describe("formatting", () => {
  it("uses a true minus sign and locale decimals", () => {
    expect(signed(-0.314, "es")).toBe("−0.31");
    expect(signed(0.314, "en")).toBe("+0.31");
  });
  it("trend line passes through a perfect line with the bundle's slope", () => {
    const years = [2000, 2001, 2002, 2003];
    const series = years.map((y) => 0.03 * (y - 2000) + 1);
    const line = trendLine(series, years, 0.3)!;
    expect(line[0][1]).toBeCloseTo(1, 9);
    expect(line[1][1]).toBeCloseTo(1.09, 9);
  });
});
