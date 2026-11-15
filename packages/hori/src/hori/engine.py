"""Steps 2-7 on a matrix of annual series [entities, n]. Used for grid cells, windows and named regions.

Must not import zon or any web code.
"""
from __future__ import annotations
import math
import numpy as np

from .aggregate import fill_interior_gaps
from .config import Config
from .detect import mde_per_decade, years_more
from .fdr import bh_qvalues
from .stats import Z05, trend_tests
from .verdict import NO_CONCLUYENTE, decide, flags_for


def analyze(series: np.ndarray, cfg: Config, base_flags: int = 0) -> dict:
    """series: [m, n] annual values (NaN = missing). Returns per-entity arrays (see LayerResult)."""
    m, n = series.shape
    nvalid = np.isfinite(series).sum(1)
    need = max(cfg.min_years, int(math.ceil(cfg.min_valid_fraction * n)))

    filled, first, last, interpolated = fill_interior_gaps(series, cfg.max_interior_gap_years)
    span = np.where(first >= 0, last - first + 1, 0)
    complete = np.zeros(m, bool)
    for i in np.where((nvalid >= need) & (span >= cfg.min_years))[0]:
        complete[i] = np.isfinite(filled[i, first[i]:last[i] + 1]).all()
    enough = complete

    f32 = lambda: np.full(m, np.nan, np.float64)
    b, sigma, r1, se, p_vc, p_ws, p_ols, p_cons, zn, mde = (f32() for _ in range(10))
    n_eff = np.zeros(m, np.int32)
    outside_table = False

    # Group entities by their valid span so every group is a full matrix (vectorized tests).
    keys = np.stack([first, last], 1)
    for a, z in {tuple(k) for k in keys[enough]}:
        rows = np.where(enough & (first == a) & (last == z))[0]
        k = z - a + 1
        for s in range(0, len(rows), cfg.chunk_cells):
            rr = rows[s:s + cfg.chunk_cells]
            Y = filled[rr, a:z + 1]
            out = trend_tests(Y, cfg.tfpw_ws_iterations, cfg.r1_clip)
            b[rr], sigma[rr], r1[rr], se[rr] = out["b_sen"], out["sigma"], out["r1"], out["se_ols"]
            p_vc[rr], p_ws[rr], p_ols[rr], p_cons[rr] = out["p_vc"], out["p_ws"], out["p_ols"], out["p_cons"]
            zn[rr] = out["z_naive"]
            md, outside = mde_per_decade(out["sigma"], out["r1"], k)
            mde[rr] = md
            outside_table |= outside
            n_eff[rr] = k

    effect = 10.0 * b
    half = 1.96 * 10.0 * se
    q = bh_qvalues(np.where(enough, p_cons, np.nan))
    nsig = np.zeros(m, np.uint8)
    for p in (p_vc, p_ws, p_ols):
        nsig += (enough & (p <= cfg.alpha)).astype(np.uint8)
    naive = (enough & (np.abs(np.nan_to_num(zn)) > Z05)).astype(np.uint8)
    delta = cfg.delta_sigma_per_decade * sigma
    verdict = decide(enough, q, nsig, mde, delta, cfg.fdr_q)
    ym = np.where(verdict == NO_CONCLUYENTE, years_more(mde, delta, np.maximum(n_eff, 1)), np.nan)
    flags = flags_for(verdict, nsig, np.nan_to_num(r1), interpolated & enough, base_flags)

    return {
        "effect": effect, "ci_lo": effect - half, "ci_hi": effect + half, "sigma": sigma, "r1": r1,
        "p_cons": p_cons, "q_cons": q, "mde": mde, "years_more": ym, "verdict": verdict, "flags": flags,
        "nvalid": np.minimum(nvalid, 255).astype(np.uint8), "nsig_methods": nsig, "naive_sig": naive,
        "_outside_table": outside_table, "_n_eff": n_eff,
    }


def expanding_windows(series: np.ndarray, years: np.ndarray, cfg: Config, base_flags: int = 0) -> tuple[dict, np.ndarray]:
    """Step 9: same rule on [start, e] for every end e with n >= min_n (FDR inside each window).
    Returns ({end: arrays}, emergence_year[m]). Windows are nested, not independent."""
    n = series.shape[1]
    min_n = max(cfg.windows_min_n, cfg.min_years)
    out: dict = {}
    for k in range(min_n, n + 1):
        res = analyze(series[:, :k], cfg, base_flags)
        out[int(years[k - 1])] = {key: res[key] for key in ("verdict", "effect", "q_cons", "mde", "years_more", "flags")}
    ends = sorted(out)
    m = series.shape[0]
    emergence = np.full(m, np.nan)
    holding = np.ones(m, bool)
    # Walk back from the last window: emergence = earliest end from which PROBADO holds until the end.
    for e in reversed(ends):
        holding &= out[e]["verdict"] == 1
        emergence[holding] = e
    return out, emergence


def region_series(cells: np.ndarray, lat: np.ndarray, lon: np.ndarray, bbox) -> tuple[np.ndarray, int]:
    """Area-weighted (cos lat) mean of the valid cells whose centre lies in bbox [lonMin, latMin, lonMax, latMax].
    cells: [m, n]; lat/lon: [m]. Returns (series[n], n_cells)."""
    lo0, la0, lo1, la1 = bbox
    inside = (lon >= lo0) & (lon <= lo1) & (lat >= la0) & (lat <= la1)
    sub = cells[inside]
    has = np.isfinite(sub).any(1)
    sub = sub[has]
    if sub.shape[0] == 0:
        return np.full(cells.shape[1], np.nan), 0
    w = np.cos(np.deg2rad(lat[inside][has]))[:, None] * np.isfinite(sub)
    with np.errstate(invalid="ignore", divide="ignore"):
        s = np.nansum(np.nan_to_num(sub) * w, 0) / w.sum(0)
    s[w.sum(0) == 0] = np.nan
    return s, int(sub.shape[0])
