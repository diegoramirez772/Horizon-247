"""Calibration with a REAL null: the planet's own noise, with the trend destroyed (and, optionally, a known one injected).

    PYTHONPATH=packages/zon/src:packages/hori/src python3 sim/null_planet.py [options]
      --npz data/planet/t2m_annual_1981-2025.npz   annual cube built by zon.planet.annual_planet
      --reps 20  --seed 1  --stride 1               realizations / RNG seed / use every k-th cell in both axes (tests)
      --detrend 1|0                                 1: remove the OLS line first (optimistic: it also eats low-frequency
                                                    power); 0: randomize the raw series (pessimistic: the trend's energy
                                                    becomes slow noise). The truth lies between the two: report both.
      --inject 0.0 --patch 0.2                      add a known trend (unit/decade) to ~patch of the map, in 8x8 blocks

Surrogate = same random phase for EVERY cell at each frequency (multivariate phase randomization, Theiler et al. 1992):
keeps each cell's autocorrelation (amplitude spectrum) AND the cross-correlation between cells, destroys any real
trend. So every discovery on a non-injected cell is a false one, measured with real spatial and temporal structure.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from hori.api import Config, infer_profile, run_grid

ap = argparse.ArgumentParser()
ap.add_argument("--npz", default="data/planet/t2m_annual_1981-2025.npz")
ap.add_argument("--reps", type=int, default=20)
ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--stride", type=int, default=1)
ap.add_argument("--detrend", type=int, default=1)
ap.add_argument("--inject", type=float, default=0.0)
ap.add_argument("--patch", type=float, default=0.2)
ap.add_argument("--out", default=None)
a = ap.parse_args()

z = np.load(a.npz, allow_pickle=False)
annual = z["annual"][:, ::a.stride, ::a.stride]
years, lat, lon = z["years"].tolist(), z["lat"][::a.stride], z["lon"][::a.stride]
meta = json.loads(str(z["meta"]))
n, ny, nx = annual.shape
cells = ny * nx
X = annual.reshape(n, cells).astype(float)
t = np.arange(n, dtype=float)
tc = t - t.mean()
if a.detrend:                                         # remove the per-cell OLS line (and the mean)
    slope = (tc @ (X - X.mean(0))) / (tc @ tc)
    base = X - X.mean(0) - np.outer(tc, slope)
else:
    base = X - X.mean(0)
spec = np.fft.rfft(base, axis=0)                      # [n//2+1, cells], complex
K = spec.shape[0]
prof = infer_profile(meta["variable"])
cfg, delta_source = prof.apply(Config())
delta = float(cfg.delta_per_decade)
time_labels = [f"{y}-01-01" for y in years]
rng = np.random.default_rng(a.seed)
meta_run = {"id": "null", "profile": "earth", "variable": meta["variable"], "dataset": meta["dataset"]}
BLK = 36                                              # lat rows per block


def injected_mask(rng) -> np.ndarray:
    """Random 8x8 blocks covering ~patch of the map (spatially clustered, like a real regional signal)."""
    by, bx = -(-ny // 8), -(-nx // 8)
    pick = rng.random((by, bx)) < a.patch
    return np.kron(pick, np.ones((8, 8), bool))[:ny, :nx].ravel()


rows = []
t_all = time.time()
for r in range(a.reps):
    t0 = time.time()
    ph = np.exp(1j * rng.uniform(0, 2 * np.pi, size=(K, 1)))
    ph[0] = 1.0                                       # the (zero) mean stays
    if n % 2 == 0:
        ph[-1] = np.sign(np.cos(rng.uniform(0, 2 * np.pi)))   # Nyquist must stay real
    S = np.fft.irfft(spec * ph, n=n, axis=0)          # [n, cells]
    mask = np.zeros(cells, bool)
    if a.inject:
        mask = injected_mask(rng)
        S[:, mask] += np.outer(tc / 10.0, np.full(mask.sum(), a.inject))   # a.inject per decade
    cube = S.reshape(n, ny, nx)
    gen = ((y0, 0, cube[:, y0:y0 + BLK, :]) for y0 in range(0, ny, BLK))
    res = run_grid(gen, lat, lon, time_labels, meta_run, cfg)
    v = res.verdict
    u = np.isfinite(res.p_cons)
    null = u & ~mask
    pc = res.p_cons
    row = {"rep": r, "seconds": round(time.time() - t0, 1),
           "cells_null": int(null.sum()), "cells_injected": int((u & mask).sum()),
           "raw_p_le_05": float((pc[null] <= 0.05).mean()),          # per-cell test size of the conservative p (max of 3)
           "any_method_sig": float((res.nsig_methods[null] >= 1).mean()),
           "naive_ols_sig": float(res.naive_sig[null].mean()),       # plain OLS, no autocorrelation fix (what NOT to use)
           "probado_false": int((v[null] == 1).sum()), "candidata_false": int((v[null] == 2).sum()),
           "bh_false": int((res.q_cons[null] <= cfg.fdr_q).sum()), "ebh_false": int(res.ebh_sig[null].sum()),
           "quiebre_flag_null": float(((res.flags[null] & 128) > 0).mean()),
           "robust_false": int(res.robust_mem[null].sum()), "robust_all": int(res.robust_mem.sum()),
           "probado_all": int((v == 1).sum()), "probado_true": int((v[u & mask] == 1).sum()),
           "bh_all": int((u & (res.q_cons <= cfg.fdr_q)).sum()), "ebh_true": int(res.ebh_sig[u & mask].sum())}
    V, R_ = row["probado_false"], row["probado_all"]
    row["fdp_probado"] = V / max(R_, 1)
    row["fdp_robust"] = row["robust_false"] / max(row["robust_all"], 1)
    row["fdp_bh"] = row["bh_false"] / max(row["bh_all"], 1)
    row["fdp_ebh"] = row["ebh_false"] / max(int(res.ebh_sig[u].sum()), 1)
    if a.inject:
        inj = u & mask
        ratio = (res.mde[inj] / res.delta[inj])
        bins = [(0, .5), (.5, .8), (.8, 1.0), (1.0, 1.5), (1.5, 1e9)]
        eff_ok = (np.abs(res.effect[inj]) > 0)
        row["power_by_mde_over_delta"] = {
            f"{lo}-{hi if hi < 1e9 else 'inf'}": [int(((ratio >= lo) & (ratio < hi)).sum()),
                                                   float((v[inj][(ratio >= lo) & (ratio < hi)] == 1).mean())
                                                   if ((ratio >= lo) & (ratio < hi)).any() else None] for lo, hi in bins}
        row["power_probado"] = float((v[inj] == 1).mean())
        row["power_robust"] = float((res.robust_mem[inj] == 1).mean())
        row["power_bh"] = float((res.q_cons[inj] <= cfg.fdr_q).mean())
        row["power_ebh"] = float(res.ebh_sig[inj].mean())
        row["effect_bias"] = float(np.nanmedian(res.effect[inj]) - a.inject)
        row["ci_cover"] = float(((res.ci_lo[inj] <= a.inject) & (res.ci_hi[inj] >= a.inject)).mean())
    rows.append(row)
    print(f"rep {r + 1}/{a.reps} {row['seconds']} s  null: size(p<=.05)={row['raw_p_le_05']:.3f} naive={row['naive_ols_sig']:.3f} "
          f"PROBADO={V} BH={row['bh_false']} eBH={row['ebh_false']}"
          + (f"  | power PROBADO={row['power_probado']:.3f} FDP={row['fdp_probado']:.3f}" if a.inject else ""), flush=True)


def agg(key):
    x = np.array([r[key] for r in rows], float)
    return {"mean": float(x.mean()), "sd": float(x.std(ddof=1)) if len(x) > 1 else 0.0, "min": float(x.min()), "max": float(x.max())}


keys = ["raw_p_le_05", "any_method_sig", "naive_ols_sig", "probado_false", "candidata_false", "bh_false", "ebh_false",
        "quiebre_flag_null", "robust_false", "fdp_probado", "fdp_robust", "fdp_bh", "fdp_ebh"]
if a.inject:
    keys += ["power_probado", "power_robust", "power_bh", "power_ebh", "effect_bias", "ci_cover"]
summary = {k: agg(k) for k in keys}
summary["share_reps_with_any_probado_false"] = float(np.mean([r["probado_false"] > 0 for r in rows]))
summary["share_reps_with_any_robust_false"] = float(np.mean([r["robust_false"] > 0 for r in rows]))
summary["share_reps_with_any_bh_false"] = float(np.mean([r["bh_false"] > 0 for r in rows]))
summary["share_reps_with_any_ebh_false"] = float(np.mean([r["ebh_false"] > 0 for r in rows]))
if a.inject:
    pw = {}
    for r in rows:
        for k, (cnt, p) in r["power_by_mde_over_delta"].items():
            if p is not None:
                d = pw.setdefault(k, [0, 0.0])
                d[0] += cnt
                d[1] += cnt * p
    summary["power_probado_by_mde_over_delta"] = {k: {"cells": c, "power": round(s / c, 4)} for k, (c, s) in pw.items() if c}
doc = {"setup": {"npz": a.npz, "years": [years[0], years[-1]], "cells": cells, "reps": a.reps, "seed": a.seed, "stride": a.stride,
                 "detrend": bool(a.detrend), "inject_per_decade": a.inject, "patch": a.patch, "delta_per_decade": delta,
                 "fdr_q": cfg.fdr_q, "alpha": cfg.alpha, "total_seconds": round(time.time() - t_all, 1)},
       "summary": summary, "reps": rows}
out = Path(a.out or f"data/calibration/null_t2m_{'det' if a.detrend else 'raw'}_inj{a.inject}_s{a.stride}.json")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(doc, indent=1))
print(json.dumps(summary, indent=1))
print("->", out)
