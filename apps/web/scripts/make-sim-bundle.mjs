// Generates SIMULATED bundles so the web can be built and rehearsed without waiting for HORI.
// Everything is labelled as simulated: honesty.simulated = true, flag 32 on every cell, a warning in the manifest.
// The verdict rule here is a stand-in, NOT HORI's rule. Real bundles come from ZON/HORI (contract/SPEC.md).
//
//   npm run bundle:sim                 1° grid (64 800 cells), layers of 24 and 45 years + windows + Durango
//   npm run bundle:sim -- --deg 2      coarser grid (like GISTEMP 2°)
//   npm run bundle:sim -- --deg 0.5    259 200 cells (performance check)
//
// One underlying yearly series per cell (1980–2024) feeds every layer, so 24 vs 45 years and the
// accumulated-evidence windows are consistent with each other.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const deg = Number(args[args.indexOf("--deg") + 1]) || 1;
const SEED = 247;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "bundles");
const FIRST = 1980, LAST = 2024;
const ALL_YEARS = Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i);
const DELTA_SIGMA = 0.5; // simulated δ (σ per decade); the real one is Diego's (plan, duda #12)
const VARIABLE = "sim_var";

// ---- deterministic random numbers (mulberry32) ----
let st = SEED >>> 0;
function rand() {
  st = (st + 0x6d2b79f5) >>> 0;
  let t = st;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss() {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
// Two-sided p-value of a z statistic (Abramowitz–Stegun erfc approximation).
function pTwoSided(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return Math.min(1, Math.max(1e-12, y));
}

const nlat = Math.round(180 / deg), nlon = Math.round(360 / deg), cells = nlat * nlon;
const lat0 = 90 - deg / 2, lon0 = -180 + deg / 2;
const tag = String(deg).replace(".", "p");

const DGO = { latMin: 23, latMax: 25, lonMin: -106, lonMax: -104 }; // rough box around Durango
const inDurango = (lat, lon) => lat > DGO.latMin && lat < DGO.latMax && lon > DGO.lonMin && lon < DGO.lonMax;

// ---- underlying truth per cell ----
const sd = new Float32Array(cells);          // interannual σ
const trend = new Float32Array(cells);       // true change per decade
const insufficient = new Uint8Array(cells);
const full = new Float32Array(cells * ALL_YEARS.length);
for (let row = 0; row < nlat; row++) {
  const lat = lat0 - row * deg;
  for (let col = 0; col < nlon; col++) {
    const lon = lon0 + col * deg;
    const i = row * nlon + col;
    const smooth = Math.sin((lat * Math.PI) / 40) * Math.cos((lon * Math.PI) / 60) + 0.6 * Math.sin((lon * Math.PI) / 25 + lat / 18);
    sd[i] = 0.25 + 0.25 * rand();
    trend[i] = sd[i] * (0.45 * smooth + 0.1 * gauss());
    // Rehearsal scenario (still simulated): a modest change in Durango that 24 years cannot resolve
    // and 45 years can — the moment the demo shows (doc 02 F10, 0:30).
    if (inDurango(lat, lon)) { sd[i] = 0.4; trend[i] = 0.085; }
    insufficient[i] = rand() < 0.03 ? 1 : 0;
    for (let t = 0; t < ALL_YEARS.length; t++) {
      const missing = insufficient[i] && rand() < 0.75;
      full[i * ALL_YEARS.length + t] = missing ? NaN : (trend[i] / 10) * (t - ALL_YEARS.length / 2) + sd[i] * gauss();
    }
  }
}

/** OLS slope (per decade), its standard error, residual σ and lag-1 autocorrelation of residuals. */
function ols(ys, xs) {
  let n = 0, sx = 0, sy = 0;
  for (let k = 0; k < ys.length; k++) if (Number.isFinite(ys[k])) { n++; sx += xs[k]; sy += ys[k]; }
  if (n < 10) return null;
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0;
  for (let k = 0; k < ys.length; k++) if (Number.isFinite(ys[k])) { sxx += (xs[k] - mx) ** 2; sxy += (xs[k] - mx) * (ys[k] - my); }
  const b = sxy / sxx, a = my - b * mx;
  let ss = 0, r1n = 0, r1d = 0, prev = NaN;
  for (let k = 0; k < ys.length; k++) {
    if (!Number.isFinite(ys[k])) { prev = NaN; continue; }
    const e = ys[k] - a - b * xs[k];
    ss += e * e; r1d += e * e;
    if (Number.isFinite(prev)) r1n += e * prev;
    prev = e;
  }
  const s = Math.sqrt(ss / (n - 2));
  return { n, b10: b * 10, se10: (s / Math.sqrt(sxx)) * 10, s, r1: r1d > 0 ? r1n / r1d : 0 };
}

/** Minimum detectable effect per decade for n years (≈ 80 % power, α = 0.05). */
function mdeFor(s, n) {
  const sxx = (n * (n * n - 1)) / 12;
  return 2.8 * (s / Math.sqrt(sxx)) * 10;
}

/** Benjamini–Hochberg q-values. */
function bh(p, valid) {
  const idx = [];
  for (let i = 0; i < p.length; i++) if (valid[i]) idx.push(i);
  idx.sort((a, b) => p[a] - p[b]);
  const q = new Float32Array(p.length).fill(NaN);
  let min = 1;
  for (let r = idx.length - 1; r >= 0; r--) {
    min = Math.min(min, (p[idx[r]] * idx.length) / (r + 1));
    q[idx[r]] = min;
  }
  return q;
}

/** Builds the arrays of one window [start, end]. */
function analyse(start, end) {
  const t0 = start - FIRST, n = end - start + 1;
  const xs = Array.from({ length: n }, (_, k) => start + k);
  const A = {
    effect: new Float32Array(cells), ci_lo: new Float32Array(cells), ci_hi: new Float32Array(cells),
    sigma: new Float32Array(cells), r1: new Float32Array(cells), p_cons: new Float32Array(cells),
    q_cons: new Float32Array(cells), mde: new Float32Array(cells), years_more: new Float32Array(cells),
    verdict: new Uint8Array(cells), flags: new Uint8Array(cells), nvalid: new Uint8Array(cells),
    nsig_methods: new Uint8Array(cells), naive_sig: new Uint8Array(cells),
  };
  const valid = new Uint8Array(cells);
  const ys = new Array(n);
  for (let i = 0; i < cells; i++) {
    for (let k = 0; k < n; k++) ys[k] = full[i * ALL_YEARS.length + t0 + k];
    const fit = ols(ys, xs);
    A.nvalid[i] = fit ? fit.n : ys.filter(Number.isFinite).length;
    A.flags[i] = 32; // simulated, always
    if (!fit) {
      for (const k of ["effect", "ci_lo", "ci_hi", "sigma", "r1", "p_cons", "q_cons", "mde", "years_more"]) A[k][i] = NaN;
      A.verdict[i] = 0;
      continue;
    }
    valid[i] = 1;
    A.effect[i] = fit.b10;
    A.ci_lo[i] = fit.b10 - 1.96 * fit.se10;
    A.ci_hi[i] = fit.b10 + 1.96 * fit.se10;
    A.sigma[i] = fit.s;
    A.r1[i] = fit.r1;
    A.p_cons[i] = pTwoSided(fit.b10 / fit.se10);
    A.mde[i] = mdeFor(fit.s, fit.n);
    if (Math.abs(fit.r1) > 0.3) A.flags[i] |= 64;
  }
  A.q_cons = bh(A.p_cons, valid);
  for (let i = 0; i < cells; i++) {
    if (!valid[i]) continue;
    const p = A.p_cons[i], q = A.q_cons[i];
    A.nsig_methods[i] = p < 0.01 ? 3 : p < 0.05 ? 2 : p < 0.1 ? 1 : 0;
    A.naive_sig[i] = p < 0.05 ? 1 : 0;
    if (A.nsig_methods[i] === 1 || A.nsig_methods[i] === 2) A.flags[i] |= 1;
    const delta = DELTA_SIGMA * A.sigma[i];
    let v;
    if (q < 0.1 && A.nsig_methods[i] === 3) v = 1;
    else if (A.nsig_methods[i] >= 2) v = 2;
    else if (A.mde[i] <= delta) v = 4;
    else v = 3;
    A.verdict[i] = v;
    if (v === 3) {
      let extra = 0;
      while (mdeFor(A.sigma[i], n + extra) > delta && extra <= 60) extra++;
      A.years_more[i] = extra > 60 ? 255 : extra;
    } else A.years_more[i] = NaN;
  }
  const summary = { cells_valid: 0, naive_marked: 0, probado: 0, candidata: 0, no_concluyente: 0, sin_cambio: 0, insuficiente: 0 };
  const names = ["insuficiente", "probado", "candidata", "no_concluyente", "sin_cambio"];
  for (let i = 0; i < cells; i++) {
    if (valid[i]) summary.cells_valid++;
    if (A.naive_sig[i]) summary.naive_marked++;
    summary[names[A.verdict[i]]]++;
  }
  return { A, summary, n, xs };
}

function writeArray(dir, name, a) {
  writeFileSync(join(dir, name), Buffer.from(a.buffer, a.byteOffset, a.byteLength));
}
const DTYPE = (a) => (a instanceof Float32Array ? "f32" : "u8");

function writeLayer(start, end, withWindows) {
  const { A, summary, n } = analyse(start, end);
  const id = `sim_${VARIABLE}_${start}-${end}_${tag}deg`;
  const dir = join(ROOT, "earth", id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const arrays = {};
  for (const [k, a] of Object.entries(A)) {
    const file = `${k}.${DTYPE(a)}`;
    writeArray(dir, file, a);
    arrays[k] = { file, dtype: DTYPE(a), ...(k === "effect" || k === "mde" ? { unit: "unit_per_decade" } : {}) };
  }
  const series = new Float32Array(cells * n);
  for (let i = 0; i < cells; i++) for (let k = 0; k < n; k++) series[i * n + k] = full[i * ALL_YEARS.length + (start - FIRST) + k];
  writeArray(dir, "series.f32", series);

  let windows;
  if (withWindows) {
    const ends = [];
    for (let e = start + 14; e <= end; e += 5) ends.push(e);
    if (ends.at(-1) !== end) ends.push(end);
    for (const e of ends) {
      const w = analyse(start, e).A;
      const wd = join(dir, "windows", String(e));
      mkdirSync(wd, { recursive: true });
      for (const k of ["verdict", "effect", "q_cons", "mde", "years_more", "flags"]) writeArray(wd, `${k}.${DTYPE(w[k])}`, w[k]);
    }
    windows = { mode: "expanding", start, ends, min_n: 15 };
  }

  const title = {
    es: `Variable simulada · ${n} años (no es un dato real)`,
    en: `Simulated variable · ${n} years (not real data)`,
  };
  const manifest = {
    contract: "0.2",
    id,
    profile: "earth",
    title,
    variable: { name: VARIABLE, unit: "u", unit_per_decade: "u/década", short_label: { es: "la variable simulada", en: "the simulated variable" }, color_more: "red" },
    entity: { kind: "region_cell", body: "earth", count: cells, valid: summary.cells_valid },
    grid: { type: "latlon", nlat, nlon, lat0, dlat: -deg, lon0, dlon: deg, native_resolution_deg: deg, effective_resolution_note: "Simulado" },
    dataset: { name: "Generador simulado de la web", provider: "HORIZON 247 (simulado)", url: "", version: "sim-2", sha256: "", licence: "no aplica", kind: "simulated" },
    window: { start, end, n, step: "annual", aggregation: "simulado" },
    params: { alpha: 0.05, fdr_q: 0.1, delta_sigma_per_decade: DELTA_SIGMA, min_valid_years: 10 },
    methods: ["MK-VC", "TFPW-WS", "OLS-AR1"],
    arrays,
    series: { file: "series.f32", dtype: "f32", shape: ["cells", "n"], years: Array.from({ length: n }, (_, k) => start + k) },
    ...(windows ? { windows } : {}),
    summary,
    honesty: { data_real: false, simulated: true, label_es: "Datos simulados: números aleatorios, no es un resultado de HORI", label_en: "Simulated data: random numbers, not a HORI result" },
    warnings: ["Bundle simulado. La regla de veredicto es un sustituto, no la de HORI."],
    build: { generator: "apps/web/scripts/make-sim-bundle.mjs", seed: SEED, created_at: new Date().toISOString() },
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`  ${id}: n=${n}`, summary);
  return { id, manifest, path: `earth/${id}/` };
}

/** SPEC §8.2: one named region (Durango, rough box), aggregated from the cells of each layer. */
function durango(layers) {
  // `bbox` [lonMin, latMin, lonMax, latMax] is an ADDITIVE proposal (not in SPEC §8.2 yet) so the map can fly to it.
  const region = { id: "mx-dgo", name: { es: "Durango (simulado)", en: "Durango (simulated)" }, bbox: [DGO.lonMin, DGO.latMin, DGO.lonMax, DGO.latMax], layers: {} };
  for (const L of layers) {
    const { start, n } = L.manifest.window;
    const xs = Array.from({ length: n }, (_, k) => start + k);
    const mean = new Array(n).fill(0), cnt = new Array(n).fill(0);
    let nCells = 0;
    for (let row = 0; row < nlat; row++) for (let col = 0; col < nlon; col++) {
      const lat = lat0 - row * deg, lon = lon0 + col * deg;
      if (!inDurango(lat, lon)) continue;
      nCells++;
      const i = row * nlon + col;
      for (let k = 0; k < n; k++) {
        const y = full[i * ALL_YEARS.length + (start - FIRST) + k];
        if (Number.isFinite(y)) { mean[k] += y; cnt[k]++; }
      }
    }
    const series = mean.map((s, k) => (cnt[k] ? s / cnt[k] : NaN));
    const fit = ols(series, xs);
    const p = fit ? pTwoSided(fit.b10 / fit.se10) : 1;
    const mde = fit ? mdeFor(fit.s, fit.n) : NaN;
    const delta = fit ? DELTA_SIGMA * fit.s : NaN;
    const verdict = !fit ? 0 : p < 0.01 ? 1 : p < 0.05 ? 2 : mde <= delta ? 4 : 3;
    let years_more = null;
    if (verdict === 3) { let e = 0; while (mdeFor(fit.s, n + e) > delta && e <= 60) e++; years_more = e > 60 ? 255 : e; }
    region.layers[L.id] = {
      n_cells: nCells, flags: 32 | 8, series: series.map((v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)),
      effect: fit ? fit.b10 : NaN, ci: fit ? [fit.b10 - 1.96 * fit.se10, fit.b10 + 1.96 * fit.se10] : [NaN, NaN],
      p_cons: p, q_regions: p, verdict, mde, years_more, emergence_year: null,
    };
  }
  return [region];
}

console.log(`Simulated bundles · grid ${nlat} × ${nlon} = ${cells} cells (${deg}°)`);
const layers = [writeLayer(2001, 2024, false), writeLayer(1980, 2024, true)];
writeFileSync(join(ROOT, "regions.json"), JSON.stringify(durango(layers), null, 2));
if (!existsSync(join(ROOT, "context.json"))) writeFileSync(join(ROOT, "context.json"), "[]\n");

// index.json: replace the simulated entries, keep everything else (real layers from Diego).
const indexPath = join(ROOT, "index.json");
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];
const kept = index.filter((e) => !String(e.id).startsWith("sim_"));
const sim = layers.map((L) => ({ id: L.id, profile: "earth", title: L.manifest.title, variable: VARIABLE, window: { start: L.manifest.window.start, end: L.manifest.window.end, n: L.manifest.window.n }, path: L.path }));
writeFileSync(indexPath, JSON.stringify([...kept, ...sim], null, 2) + "\n");
console.log(`index.json: ${kept.length} real + ${sim.length} simulated layers → ${indexPath}`);
