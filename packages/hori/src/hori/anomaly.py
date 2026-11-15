"""Anomalies on ANY observation stream (function 3 of the idea): one entity, one variable, regular cadence, NaN = missing.

The same code watches a region of the Earth (monthly, period 12), an astronaut's heart rate (every 10 min, period 144),
a robot's current or a service's latency. Nothing here knows what the number means; the profile only gives the period.

Model (causal: each sample is judged with the past only):
  level      L_t  = mean of the last P samples (a whole cycle, so it carries no seasonality);
  deviation  d_t  = x_t - L_{t-1};
  expected   e_t  = median over the previous K cycles of d at the same phase (robust to earlier anomalies);
  residual   r_t  = d_t - e_t;   scale s_t = 1.4826 MAD of the previous S residuals;   z_t = r_t / s_t.
Three detectors, each with a stated false-alarm rate (sim/anomaly_calibration.py, docs/MODEL_CARD.md 3.13):
  punto          |z_t| >= z_alarm                         (one-off value)
  cambio_nivel   two-sided CUSUM on z / sqrt((1+phi)/(1-phi)) (a sustained shift; phi = lag-1 of z)
  sin_datos      a run of missing samples >= gap_min       (the sensor/source went quiet)
  fuera_de_rango values outside the physical range given     (impossible readings; excluded from the statistics)
  congelado      the same exact value repeated >= frozen_min (a stuck sensor; excluded from the statistics)
Honesty: an anomaly is a statistical deviation, NOT proof of fault, illness or danger (H12). A shift that lasts longer
than about one cycle is absorbed by the level L (the baseline adapts); the trend machinery owns slow change.
"""
from __future__ import annotations

import warnings
from dataclasses import dataclass, field

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

MAD_TO_SD = 1.4826
DEFAULTS = {"z_alarm": 3.5, "cusum_k": 0.5, "cusum_h": 5.0, "gap_min": 3, "merge_gap": 2, "phase_prior": 15.0, "frozen_min": 12}


@dataclass
class AnomalyResult:
    period: int
    expected_dev: np.ndarray            # e_t
    level: np.ndarray                   # L_{t-1}
    resid: np.ndarray                   # r_t
    z: np.ndarray                       # NaN until there is enough history
    judged: np.ndarray                  # bool: the sample had enough history to be judged
    point: np.ndarray                   # bool
    shift: np.ndarray                   # int8: +1 / -1 at a CUSUM alarm, else 0
    onset: np.ndarray                   # int: sample where the CUSUM that raised each alarm last left zero (its start)
    gap: np.ndarray                     # bool: part of a missing run >= gap_min
    out_of_range: np.ndarray            # bool: outside valid_range (set to missing before the statistics)
    frozen: np.ndarray                  # bool: inside a run of identical values >= frozen_min (set to missing)
    phi: float
    params: dict = field(default_factory=dict)
    warmup: int = 0


def _rolling_median_excluding_current(a: np.ndarray, w: int) -> np.ndarray:
    """Median of the previous `w` values (the current one excluded). NaN until `w` values exist (NaNs inside are skipped)."""
    out = np.full(a.shape, np.nan)
    if len(a) <= w:
        return out
    win = sliding_window_view(a, w)[:-1]                                 # window ending at t-1 for t = w .. T-1
    with np.errstate(all="ignore"):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            out[w:] = np.nanmedian(win, axis=1)
    return out


def _rolling_iqr_excluding_current(a: np.ndarray, w: int) -> np.ndarray:
    out = np.full(a.shape, np.nan)
    if len(a) <= w:
        return out
    win = sliding_window_view(a, w)[:-1]
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        q = np.nanpercentile(win, [25, 75], axis=1)
    out[w:] = q[1] - q[0]
    return out


def detect(x, period: int, *, cycles: int | None = None, scale_window: int | None = None, min_sigma: float = 0.0,   # the sensor's resolution is a good value: a scale below it is quantization, not signal
           
           **kw) -> AnomalyResult:
    """x: 1-D array (NaN = missing). See the module docstring. Parameters: DEFAULTS can be overridden by keyword."""
    valid_range = kw.pop("valid_range", None)
    transform = kw.pop("transform", None)        # "sqrt" or "log1p" for skewed, non-negative variables (rain): tames the tail
    p = {**DEFAULTS, **kw}
    x = np.asarray(x, dtype=float).copy()
    T, P = len(x), int(period)
    missing0 = ~np.isfinite(x)                                           # silence is judged on what really did not arrive
    oor = np.zeros(T, bool)
    if valid_range is not None:
        lo, hi = valid_range
        with np.errstate(invalid="ignore"):
            oor = np.isfinite(x) & (((x < lo) if lo is not None else False) | ((x > hi) if hi is not None else False))
    frozen = np.zeros(T, bool)
    fm = p["frozen_min"] * (3 if min_sigma > 0 else 1)                   # quantized sensors repeat values legitimately
    i = 0
    while i < T:
        j = i + 1
        while j < T and np.isfinite(x[i]) and x[j] == x[i]:
            j += 1
        if np.isfinite(x[i]) and j - i >= fm:
            frozen[i:j] = True
        i = j
    x[oor | frozen] = np.nan
    if transform == "sqrt":
        x = np.sqrt(np.clip(x, 0, None))
    elif transform == "log1p":
        x = np.log1p(np.clip(x, 0, None))
    elif transform is not None:
        raise ValueError("transform must be None, 'sqrt' or 'log1p'")
    if P < 2:
        raise ValueError("period must be >= 2 samples (use 2 for «no seasonality»)")
    K = cycles or (5 if P >= 24 else 10)
    S = scale_window or max(K * P, 60)
    # level: mean of the last P samples (needs at least half of them)
    L = np.full(T, np.nan)
    if T >= P:
        win = sliding_window_view(x, P)
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            m = np.nanmean(win, axis=1)
        m[np.isfinite(win).sum(axis=1) < P // 2 + 1] = np.nan
        L[P - 1:] = m
    Lprev = np.concatenate([[np.nan], L[:-1]])                           # L_{t-1}
    d = x - Lprev
    # expected deviation: median of d at the same phase over the previous K cycles
    D = np.full((K, T), np.nan)
    for k in range(1, K + 1):
        if T > k * P:
            D[k - 1, k * P:] = d[:T - k * P]
    with np.errstate(all="ignore"):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            e = np.nanmedian(D, axis=0)
    e[np.isfinite(D).sum(axis=0) < max(3, K // 2)] = np.nan
    r = d - e
    med_r = _rolling_median_excluding_current(r, S)
    mad = _rolling_median_excluding_current(np.abs(r - np.nan_to_num(med_r, nan=0.0)), S)
    iqr = _rolling_iqr_excluding_current(r, S)                            # discrete sensors make MAD collapse; the IQR does not
    s_pool = np.maximum(MAD_TO_SD * mad, iqr / 1.349)
    # per-phase scale (winter is noisier than summer, night calmer than day): MAD of the same phase over the previous cycles,
    # shrunk toward the pooled scale with weight `prior` (few values per phase would be too noisy on their own)
    K2 = max(S // P, 3)
    R = np.full((K2, T), np.nan)
    rr = r - np.nan_to_num(med_r, nan=0.0)
    for k in range(1, K2 + 1):
        if T > k * P:
            R[k - 1, k * P:] = rr[:T - k * P]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        m_ph = np.nanmedian(R, axis=0)
        s_ph = MAD_TO_SD * np.nanmedian(np.abs(R - m_ph), axis=0)
    n_ph = np.isfinite(R).sum(axis=0)
    prior = p["phase_prior"]
    with np.errstate(all="ignore"):
        s2 = (n_ph * np.nan_to_num(s_ph) ** 2 + prior * s_pool ** 2) / (n_ph + prior)
    s = np.maximum(np.sqrt(np.where(np.isfinite(s_pool), s2, np.nan)), min_sigma)
    with np.errstate(all="ignore"):
        z = np.where(s > 0, (r - np.nan_to_num(med_r, nan=0.0)) / s, np.nan)
    judged = np.isfinite(z)
    point = judged & (np.abs(np.where(judged, z, 0.0)) >= p["z_alarm"])
    # lag-1 of the (clipped) z, for the CUSUM allowance of dependence
    zz = np.clip(np.where(judged, z, np.nan), -3, 3)
    ok = np.isfinite(zz[1:]) & np.isfinite(zz[:-1])
    phi = float(np.clip(np.corrcoef(zz[1:][ok], zz[:-1][ok])[0, 1], 0.0, 0.9)) if ok.sum() > 30 else 0.0
    infl = np.sqrt((1 + phi) / (1 - phi))
    shift = np.zeros(T, dtype=np.int8)
    onset = np.full(T, -1, dtype=int)
    sp = sn = 0.0
    op = on = -1
    k, h = p["cusum_k"], p["cusum_h"]
    for t in range(T):
        if not judged[t]:
            continue
        zt = np.clip(z[t], -p["z_alarm"], p["z_alarm"]) / infl           # a single spike must not feed the CUSUM (point owns it)
        sp0, sn0 = sp, sn
        sp, sn = max(0.0, sp + zt - k), max(0.0, sn - zt - k)
        if sp0 == 0.0 and sp > 0.0:
            op = t
        if sn0 == 0.0 and sn > 0.0:
            on = t
        if sp > h:
            shift[t], onset[t], sp = 1, op, 0.0
        elif sn > h:
            shift[t], onset[t], sn = -1, on, 0.0
    # missing runs
    miss = missing0
    gap = np.zeros(T, dtype=bool)
    i = 0
    while i < T:
        if miss[i]:
            j = i
            while j < T and miss[j]:
                j += 1
            if j - i >= p["gap_min"]:
                gap[i:j] = True
            i = j
        else:
            i += 1
    first = int(np.argmax(judged)) if judged.any() else T
    return AnomalyResult(P, e, Lprev, r, z, judged, point, shift, onset, gap, oor, frozen, phi, {**p, "transform": transform, "cycles": K, "scale_window": S}, first)


def events(res: AnomalyResult, times: list | None = None, unit: str = "") -> list[dict]:
    """Group flagged samples into events. Times are labels only (any strings); indices are always given."""
    T = len(res.z)
    lab = (lambda i: times[i]) if times is not None else (lambda i: i)
    out = []
    # points and runs of points (merged when closer than merge_gap samples)
    idx = np.nonzero(res.point)[0]
    groups = []
    for i in idx:
        if groups and i - groups[-1][-1] <= res.params["merge_gap"] + 1:
            groups[-1].append(int(i))
        else:
            groups.append([int(i)])
    for g in groups:
        zs = res.z[g]
        pk = int(g[int(np.argmax(np.abs(zs)))])
        out.append({"type": "racha" if len(g) >= 3 else "punto", "start": int(g[0]), "end": int(g[-1]), "t_start": lab(g[0]),
                    "t_end": lab(g[-1]), "peak_z": round(float(res.z[pk]), 2), "direction": "alto" if res.z[pk] > 0 else "bajo",
                    "n_flagged": len(g), "peak_resid": round(float(res.resid[pk]), 4), "unit": unit})
    # level shifts: repeated alarms of the same sign close together are ONE event (a sustained shift re-triggers the CUSUM)
    alarms = np.nonzero(res.shift)[0]
    merge = max(res.period // 2, 12)
    grp = []
    for t in alarms:
        if grp and res.shift[t] == res.shift[grp[-1][-1]] and t - grp[-1][-1] <= merge:
            grp[-1].append(int(t))
        else:
            grp.append([int(t)])
    for g in grp:
        sgn, first, last = int(res.shift[g[0]]), g[0], g[-1]
        best_j = int(res.onset[first]) if res.onset[first] >= 0 else first
        out.append({"type": "cambio_nivel", "start": best_j, "end": last, "t_start": lab(best_j), "t_end": lab(last),
                    "direction": "alto" if sgn > 0 else "bajo", "n_flagged": last - best_j + 1, "n_alarms": len(g),
                    "mean_z": round(float(np.nanmean(res.z[best_j:last + 1])), 2), "unit": unit})
    shifts = [e for e in out if e["type"] == "cambio_nivel"]
    for i, e in enumerate(shifts):                                          # the baseline adapts: the end of a shift looks like the opposite shift
        for prev in shifts[:i]:
            if prev["direction"] != e["direction"] and 0 <= e["start"] - prev["end"] <= 2 * res.period:
                e["retorno_probable"] = True
    # missing runs
    i = 0
    while i < T:
        if res.gap[i]:
            j = i
            while j < T and res.gap[j]:
                j += 1
            out.append({"type": "sin_datos", "start": i, "end": j - 1, "t_start": lab(i), "t_end": lab(j - 1),
                        "n_flagged": j - i, "unit": unit})
            i = j
        else:
            i += 1
    for mask, kind in ((res.out_of_range, "fuera_de_rango"), (res.frozen, "congelado")):
        i = 0
        while i < T:
            if mask[i]:
                j = i
                while j < T and mask[j]:
                    j += 1
                out.append({"type": kind, "start": i, "end": j - 1, "t_start": lab(i), "t_end": lab(j - 1), "n_flagged": j - i, "unit": unit})
                i = j
            else:
                i += 1
    out.sort(key=lambda e: (e["start"], e["type"]))
    for e in out:
        e["severity"] = severity(e)
    return out


def severity(e: dict) -> str:
    """Estimated size of the STATISTICAL deviation (not of any risk): leve < 6 sigma, media < 10, alta >= 10; gaps by length."""
    if e["type"] in ("fuera_de_rango", "congelado"):
        return "media"
    if e["type"] == "sin_datos":
        return "media" if e["n_flagged"] >= 12 else "leve"
    z = abs(e.get("peak_z", e.get("mean_z", 0.0)))
    if e["type"] == "cambio_nivel":
        return "media" if z >= 2.0 else "leve"
    return "alta" if z >= 10 else "media" if z >= 6 else "leve"


def accumulated_z(x, period: int, window: int, *, min_years: int = 10, max_years: int = 60) -> np.ndarray:
    """Deficit/excess of the sum over the last `window` samples, against the same window ending at the same phase in all
    PREVIOUS cycles (robust z: median and MAD). For droughts and wet spells, which are accumulations, not single months.
    SPI-like but not the SPI (no gamma fit): stated as such. NaN until `min_years` previous cycles exist.
    x: [T] or [T, cells] (vectorised over cells)."""
    x = np.asarray(x, dtype=float)
    one = x.ndim == 1
    X = x[:, None] if one else x.reshape(x.shape[0], -1)
    T = X.shape[0]
    acc = np.full(X.shape, np.nan)
    if T >= window:
        win = sliding_window_view(X, window, axis=0)                      # [T-w+1, cells, w]
        ok = np.isfinite(win).sum(axis=-1) >= window - max(1, window // 6)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            acc[window - 1:] = np.where(ok, np.nanmean(win, axis=-1) * window, np.nan)
    z = np.full(X.shape, np.nan)
    for t in range(period, T):
        prev = acc[t - period::-period][:max_years]
        n = np.isfinite(prev).sum(axis=0)
        if not (n >= min_years).any():
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med = np.nanmedian(prev, axis=0)
            mad = MAD_TO_SD * np.nanmedian(np.abs(prev - med), axis=0)
        s = np.maximum(mad, 1e-9 + 0.05 * np.abs(med))
        z[t] = np.where((n >= min_years) & np.isfinite(acc[t]), (acc[t] - med) / s, np.nan)
    return z[:, 0] if one else z.reshape(x.shape)
