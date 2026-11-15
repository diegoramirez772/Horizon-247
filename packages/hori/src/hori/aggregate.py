"""Step 1-2: monthly anomalies -> annual (>=9/12 months); filter cells (docs/SPEC.md section 2).

Must not import zon or any web code.
"""
from __future__ import annotations
import numpy as np


def parse_year_month(time: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """ISO-8601 strings ('2001-01', '2001-01-15', '2001-01-15T00:00:00') -> (year, month) int arrays."""
    years = np.empty(len(time), np.int32)
    months = np.empty(len(time), np.int32)
    for i, s in enumerate(time):
        s = str(s)
        years[i] = int(s[0:4])
        months[i] = int(s[5:7]) if len(s) >= 7 and s[4] == "-" else 1
    return years, months


def monthly_to_annual(values: np.ndarray, valid: np.ndarray, time: np.ndarray,
                      start: int, end: int, min_months: int = 9) -> tuple[np.ndarray, np.ndarray]:
    """Monthly cube [T, Y, X] -> annual means [n, Y, X] of anomalies against the window climatology.

    A year is valid only with >= min_months valid months. Processes month by month (low memory).
    Returns (annual[n, Y, X] float32 with NaN, years[n]).
    """
    yrs, mos = parse_year_month(time)
    in_win = (yrs >= start) & (yrs <= end)
    Y, X = values.shape[1:]
    years = np.arange(start, end + 1)
    n = len(years)

    # Climatology per calendar month over the window (only valid values).
    clim = np.zeros((12, Y, X), np.float64)
    ccount = np.zeros((12, Y, X), np.int32)
    for t in np.where(in_win)[0]:
        v = values[t].astype(np.float64)
        ok = valid[t] & np.isfinite(v)
        m = mos[t] - 1
        clim[m][ok] += v[ok]
        ccount[m][ok] += 1
    with np.errstate(invalid="ignore", divide="ignore"):
        clim = np.where(ccount > 0, clim / np.maximum(ccount, 1), np.nan)

    total = np.zeros((n, Y, X), np.float64)
    count = np.zeros((n, Y, X), np.int16)
    for t in np.where(in_win)[0]:
        v = values[t].astype(np.float64) - clim[mos[t] - 1]
        ok = valid[t] & np.isfinite(v)
        k = yrs[t] - start
        total[k][ok] += v[ok]
        count[k][ok] += 1
    with np.errstate(invalid="ignore", divide="ignore"):
        annual = np.where(count >= min_months, total / np.maximum(count, 1), np.nan).astype(np.float32)
    return annual, years


def fill_interior_gaps(series: np.ndarray, max_gap: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Per cell [m, n]: keep the span between the first and last valid year, linearly interpolate interior
    gaps of <= max_gap years. Returns (filled series with NaN outside span or in long gaps,
    first index, last index, interpolated flag)."""
    m, n = series.shape
    out = series.astype(np.float64, copy=True)
    ok = np.isfinite(out)
    first = np.where(ok.any(1), ok.argmax(1), -1)
    last = np.where(ok.any(1), n - 1 - ok[:, ::-1].argmax(1), -1)
    interpolated = np.zeros(m, bool)
    rows = np.where(ok.any(1) & (~ok).any(1))[0]
    for i in rows:
        a, b = first[i], last[i]
        seg = out[i, a:b + 1]
        miss = ~np.isfinite(seg)
        if not miss.any():
            continue
        # runs of missing values inside the span
        idx = np.where(miss)[0]
        runs = np.split(idx, np.where(np.diff(idx) > 1)[0] + 1)
        good = np.where(~miss)[0]
        for r in runs:
            if len(r) <= max_gap:
                seg[r] = np.interp(r, good, seg[good])
                interpolated[i] = True
        out[i, a:b + 1] = seg
    return out, first, last, interpolated
