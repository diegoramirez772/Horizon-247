"""Steps 1-2: aggregation to annual anomalies and per-cell filtering (docs/SPEC.md section 2)."""
from __future__ import annotations

import warnings

import numpy as np


def to_annual(values: np.ndarray, time, min_months: int = 9):
    """[T, ...] monthly values -> annual MEAN OF MONTHLY ANOMALIES (anomaly = value minus that month's mean over the window).

    A year is valid with at least `min_months` valid months. Already-annual input is returned unchanged.
    Returns (annual [n_years, ...], years, anomaly_applied).
    """
    years = np.array([int(t[:4]) for t in time])
    months = np.array([int(t[5:7]) for t in time])
    uy = np.unique(years)
    values = np.asarray(values, dtype=float)
    if len(uy) == len(time):
        return values, uy.tolist(), False
    clim = np.full((12,) + values.shape[1:], np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        for m in range(1, 13):
            sel = months == m
            if sel.any():
                clim[m - 1] = np.nanmean(values[sel], axis=0)
        anom = values - clim[months - 1]
        out = np.full((len(uy),) + values.shape[1:], np.nan)
        for i, y in enumerate(uy):
            sel = years == y
            cnt = np.isfinite(anom[sel]).sum(axis=0)
            mean = np.nanmean(anom[sel], axis=0)
            out[i] = np.where(cnt >= min_months, mean, np.nan)
    return out, uy.tolist(), True


def prepare(Z: np.ndarray, min_years: int, min_valid_fraction: float, max_gap: int):
    """Per-cell filtering of annual series Z [cells, n].

    Returns (series with interior gaps interpolated, nvalid, usable mask, gap-filled mask).
    A cell is unusable if it has too few valid years, a missing year at either end, or an interior gap longer than max_gap.
    """
    cells, n = Z.shape
    need = max(min_years, int(np.ceil(min_valid_fraction * n)))
    finite = np.isfinite(Z)
    nvalid = finite.sum(axis=1)
    usable = nvalid >= need
    filled = np.zeros(cells, dtype=bool)
    out = Z.copy()
    for c in np.where(usable & ~finite.all(axis=1))[0]:
        f = finite[c]
        if not (f[0] and f[-1]):
            usable[c] = False
            continue
        gaps = np.diff(np.where(f)[0]) - 1
        if gaps.max() > max_gap:
            usable[c] = False
            continue
        idx = np.arange(n)
        out[c] = np.interp(idx, idx[f], Z[c, f])
        filled[c] = True
    return out, nvalid, usable, filled
