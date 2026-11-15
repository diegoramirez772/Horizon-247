import { describe, expect, it } from "vitest";
import type { Manifest } from "@/contract/types";
import type { Layer } from "@/core/contract/loader";
import { SCORE_TEXT, UNKNOWN_TEXT, components, coreSign, findFoci } from "@/core/detect/focos";
import { focusWords } from "@/core/detect/words";

// 10 × 20 global grid (18° columns: the longitude wraps), δ = 0.3 per decade.
const NLAT = 10, NLON = 20;
const manifest = {
  grid: { nlat: NLAT, nlon: NLON, lat0: 81, dlat: -18, lon0: -171, dlon: 18, native_resolution_deg: 18 },
  params: { alpha: 0.05, fdr_q: 0.1, delta_sigma_per_decade: 2, delta_per_decade: 0.3 },
  variable: { name: "T2M", unit: "C", unit_per_decade: "°C/década" },
} as unknown as Manifest;

function layer(fill: (r: number, c: number) => { v: number; e?: number; lo?: number; hi?: number; q?: number; ym?: number } | null) {
  const n = NLAT * NLON;
  const verdict = new Uint8Array(n), effect = new Float32Array(n), ci_lo = new Float32Array(n), ci_hi = new Float32Array(n);
  const q_cons = new Float32Array(n).fill(0.5), years_more = new Float32Array(n).fill(NaN), mde = new Float32Array(n).fill(0.4);
  const ebh_sig = new Uint8Array(n), flags = new Uint8Array(n);
  for (let r = 0; r < NLAT; r++) for (let c = 0; c < NLON; c++) {
    const i = r * NLON + c, x = fill(r, c);
    if (!x) { verdict[i] = 4; continue; }
    verdict[i] = x.v; effect[i] = x.e ?? 0; ci_lo[i] = x.lo ?? -1; ci_hi[i] = x.hi ?? 1;
    q_cons[i] = x.q ?? 0.5; if (x.ym !== undefined) years_more[i] = x.ym;
    ebh_sig[i] = x.v === 1 ? 1 : 0;
  }
  return { manifest, arrays: { verdict, effect, ci_lo, ci_hi, q_cons, years_more, mde, ebh_sig, flags } } as unknown as Pick<Layer, "manifest" | "arrays">;
}

const strong = { v: 1, e: 0.6, lo: 0.45, hi: 0.75, q: 1e-5 };

describe("focus detector (descriptive, reads HORI's verdict)", () => {
  it("a supported cell counts only when the whole interval is beyond δ, on one side", () => {
    const L = layer((r, c) => (r === 4 && c < 3 ? [strong, { ...strong, lo: 0.1 }, { v: 1, e: -0.6, lo: -0.8, hi: -0.4, q: 1e-5 }][c] : null));
    const a = L.arrays as Record<string, Float32Array | Uint8Array>;
    expect(coreSign(manifest, a, 4 * NLON)).toBe(1);
    expect(coreSign(manifest, a, 4 * NLON + 1)).toBe(0); // interval touches δ
    expect(coreSign(manifest, a, 4 * NLON + 2)).toBe(-1);
  });

  it("joins contiguous cells, wraps across the antimeridian, keeps rises and falls apart", () => {
    const g = components(manifest, (i) => {
      const c = i % NLON, r = Math.floor(i / NLON);
      if (r !== 5) return 0;
      if (c === 0 || c === 19) return 1; // neighbours through ±180°
      if (c === 1) return -1;
      return 0;
    });
    expect(g.map((x) => x.length).sort()).toEqual([1, 2]);
  });

  it("drops groups below the minimum size and never ranks a single extreme cell first", () => {
    const L = layer((r, c) => {
      if (r === 4 && c >= 2 && c <= 7) return strong; // 6 coherent cells
      if (r === 1 && c === 10) return { v: 1, e: 9, lo: 8, hi: 10, q: 1e-12 }; // one striking cell, alone
      return null;
    });
    const f = findFoci(L);
    expect(f.supported).toHaveLength(1);
    expect(f.supported[0].cells).toHaveLength(6);
    expect(f.supported[0].sign).toBe(1);
    expect(f.looseSupported).toBe(1);
  });

  it("orders by area × effect/δ × evidence, with the polar shrink of a lat/lon grid", () => {
    const L = layer((r, c) => {
      if (r === 5 && c >= 0 && c <= 3) return strong; // 4 tropical cells
      if (r === 0 && c >= 5 && c <= 10) return strong; // 6 cells near the pole: more cells, less area
      return null;
    });
    const f = findFoci(L).supported;
    expect(f[0].lat).toBeLessThan(20);
    expect(f[0].areaKm2).toBeGreaterThan(f[1].areaKm2);
    expect(f[0].rank).toBe(1);
    expect(f[0].score).toBeCloseTo(f[0].why.areaKm2 * f[0].why.effectOverDelta * f[0].why.evidence);
  });

  it("finds where it is not known yet (candidates and inconclusive together)", () => {
    const L = layer((r, c) => (r === 3 && c >= 4 && c <= 8 ? { v: c % 2 ? 2 : 3, ym: 15 } : null));
    const u = findFoci(L).unknown;
    expect(u).toHaveLength(1);
    expect(u[0].candidateShare).toBeCloseTo(2 / 5);
    expect(u[0].yearsMore).toBe(15);
  });

  it("speaks in HORI's words, with the reason for the order, and no forbidden words", () => {
    const L = layer((r, c) => (r === 4 && c >= 2 && c <= 7 ? strong : r === 3 && c >= 4 && c <= 8 ? { v: 3, ym: 255 } : null));
    const f = findFoci(L);
    const w = focusWords(f.supported[0], manifest, "es");
    expect(w.title).toMatch(/^Foco 1/);
    expect(w.line).toMatch(/apoyado/);
    expect(w.why).toMatch(/efecto\/δ/);
    const u = focusWords(f.unknown[0], manifest, "es");
    expect(u.line).toMatch(/más de 60 años/);
    const all = [w.title, w.line, w.detail, w.why, u.title, u.line, u.detail, u.why, SCORE_TEXT.es, UNKNOWN_TEXT.es].join(" ");
    expect(all).not.toMatch(/prueba|causa|predic|recomend|debería|peligro|diagnós|riesgo|urgente/i);
  });
});

// Real bundle, when it is on disk (it is not in git: the CI skips this).
import { existsSync, readFileSync } from "node:fs";
import { decodeBinary } from "@/core/contract/loader";
const REAL = process.env.H247_BUNDLES ? `${process.env.H247_BUNDLES}/earth/global_t2m_2deg_1981-2025` : "public/bundles/earth/global_t2m_2deg_1981-2025";
describe.skipIf(!existsSync(`${REAL}/manifest.json`))("focus detector on the real 2° temperature layer", () => {
  it("gives a handful of foci instead of one planet-sized blob", async () => {
    const m = JSON.parse(readFileSync(`${REAL}/manifest.json`, "utf8")) as Manifest;
    const n = m.grid.nlat * m.grid.nlon;
    const arrays: Record<string, Float32Array | Uint8Array> = {};
    for (const [k, s] of Object.entries(m.arrays)) {
      const b = readFileSync(`${REAL}/${s.file}`);
      arrays[k] = decodeBinary(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), s.dtype, n) as Float32Array | Uint8Array;
    }
    const t0 = performance.now();
    const f = findFoci({ manifest: m, arrays } as unknown as Pick<Layer, "manifest" | "arrays">);
    const ms = performance.now() - t0;
    if (process.env.H247_FOCOS_OUT) (await import("node:fs")).writeFileSync(process.env.H247_FOCOS_OUT, [`${f.supported.length} ${f.unknown.length} ${ms.toFixed(1)}ms`, ...f.supported.slice(0, 6).map((x) => Object.values(focusWords(x, m, "es")).join(" | ")), ...f.unknown.slice(0, 3).map((x) => Object.values(focusWords(x, m, "es")).join(" | "))].join("\n"));
    expect(f.supported.length).toBeGreaterThan(3);
    // The 0.5° layer (207 936 cells) too, timed: it runs on the laptop's main thread.
    const R5 = REAL.replace("global_t2m_2deg_1981-2025", "global_t2m_1981-2026");
    if (existsSync(`${R5}/manifest.json`)) {
      const m5 = JSON.parse(readFileSync(`${R5}/manifest.json`, "utf8")) as Manifest;
      const n5 = m5.grid.nlat * m5.grid.nlon;
      const a5: Record<string, Float32Array | Uint8Array> = {};
      for (const [k, sp] of Object.entries(m5.arrays)) {
        const b = readFileSync(`${R5}/${sp.file}`);
        a5[k] = decodeBinary(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), sp.dtype, n5) as Float32Array | Uint8Array;
      }
      const t1 = performance.now();
      const f5 = findFoci({ manifest: m5, arrays: a5 } as unknown as Pick<Layer, "manifest" | "arrays">);
      const ms5 = performance.now() - t1;
      if (process.env.H247_FOCOS_OUT) (await import("node:fs")).appendFileSync(process.env.H247_FOCOS_OUT, `\n0.5°: ${f5.supported.length} ${f5.unknown.length} ${ms5.toFixed(0)}ms\n` + f5.supported.slice(0, 4).map((x) => focusWords(x, m5, "es").title + " | " + focusWords(x, m5, "es").line).join("\n"));
      expect(f5.supported.length).toBeGreaterThan(3);
    }
    expect(f.supported[0].cells.length).toBeLessThan(2000);
  });
});

describe("generated scene of a focus", () => {
  it("mean yearly series weighted by area, and a caption that says it only illustrates", async () => {
    const { focusSeries } = await import("@/core/detect/focos");
    const { sceneCaption } = await import("@/core/detect/words");
    const m = { ...manifest, window: { n: 3 }, title: { es: "Temperatura", en: "Temperature" } } as unknown as Manifest;
    const series = new Float32Array(NLAT * NLON * 3).fill(NaN);
    series.set([1, 2, 3], (4 * NLON + 2) * 3);
    series.set([3, NaN, 5], (4 * NLON + 3) * 3);
    const fs = focusSeries({ manifest: m, series }, { cells: [4 * NLON + 2, 4 * NLON + 3] })!;
    [2, 2, 4].forEach((v, k) => expect(fs[k]).toBeCloseTo(v));
    const L = layer((r, c) => (r === 4 && c >= 2 && c <= 7 ? strong : null));
    const f = findFoci(L).supported[0];
    expect(sceneCaption(f, m, "es")).toMatch(/ilustra una tendencia apoyada/);
  });
});

describe("evidence prisms", () => {
  it("every focus is drawn whole: over the budget, cells are grouped in blocks", async () => {
    const { buildPrisms } = await import("@/core/detect/prisms");
    const { MAP_THEMES } = await import("@/core/map/palette");
    const L = layer((r, c) => (r >= 2 && r <= 7 && c >= 2 && c <= 13 ? strong : null)); // 72 cells
    const foci = findFoci(L);
    const base = { layer: L, foci, mode: "apoyado" as const, active: 1, theme: MAP_THEMES.light, blueIsMore: false, scale: 1, tags: () => "1" };
    const all = buildPrisms({ ...base, budget: 1000 });
    expect(all.block).toBe(1);
    expect(all.cells).toHaveLength(72);
    expect(all.cells.every((c) => c.style === "solid")).toBe(true);
    const few = buildPrisms({ ...base, budget: 20 });
    expect(few.block).toBe(3);
    expect(few.cells.length).toBeLessThanOrEqual(20);
    expect(few.cells[0].hw).toBeCloseTo(27);
    expect(few.columns[0].delta).toBeCloseTo(0.25); // δ sits at a quarter of the tallest prism
  });
});
