"""Trend statistics. Ported from the calibration study in sim/ (same rule, same numbers). NumPy only.

Rule (docs/SPEC.md section 2, step 4): a trend is "detected" only when THREE reasonable methods agree —
Mann-Kendall with variance correction (MK-VC), iterative trend-free prewhitening (TFPW-WS) and
regression with AR(1) variance (OLS-AR1). Plain prewhitening is NOT used: it loses power on strong trends.

Limitation: Mann-Kendall here has no tie correction (fine for continuous data).
"""
from __future__ import annotations

import math

import numpy as np

Z_CRIT = 1.959964


def p_two(z: np.ndarray) -> np.ndarray:
    """Two-sided normal p-value (exact erfc)."""
    z = np.asarray(z, dtype=float)
    out = np.array([math.erfc(abs(v) / math.sqrt(2)) if np.isfinite(v) else np.nan for v in z.ravel()])
    return out.reshape(z.shape)


def mk_z(Y: np.ndarray) -> np.ndarray:
    """Mann-Kendall z for each row of Y [cells, n] (continuity-corrected)."""
    m, n = Y.shape
    S = np.zeros(m)
    for i in range(n - 1):
        S += np.sign(Y[:, i + 1:] - Y[:, [i]]).sum(axis=1)
    return (S - np.sign(S)) / math.sqrt(n * (n - 1) * (2 * n + 5) / 18)


def sen_slope(Y: np.ndarray, t: np.ndarray | None = None) -> np.ndarray:
    """Median of pairwise slopes, per row, in units per unit of t (default: per step)."""
    n = Y.shape[1]
    t = np.arange(n, dtype=float) if t is None else np.asarray(t, dtype=float)
    i, j = np.triu_indices(n, 1)
    return np.median((Y[:, j] - Y[:, i]) / (t[j] - t[i]), axis=1)


def lag1(X: np.ndarray) -> np.ndarray:
    xc = X - X.mean(axis=1, keepdims=True)
    return (xc[:, 1:] * xc[:, :-1]).sum(axis=1) / (xc ** 2).sum(axis=1)


def bias_corrected(r: np.ndarray, n: int) -> np.ndarray:
    """Short-series bias correction of the lag-1 autocorrelation (Kendall 1954), clipped to [0, 0.95]."""
    return np.clip(r + (1 + 3 * r) / n, 0.0, 0.95)


def analyze(Y: np.ndarray, tfpw_iterations: int = 6) -> dict:
    """All per-cell statistics. Y has shape [cells, n] with NO missing values (interior gaps already filled)."""
    Y = np.asarray(Y, dtype=float)
    m, n = Y.shape
    t = np.arange(n, dtype=float)
    b = sen_slope(Y)                                           # per year
    X = Y - b[:, None] * t
    r = bias_corrected(lag1(X), n)                             # autocorrelation of the detrended series
    z_naive = mk_z(Y)
    z_vc = z_naive / np.sqrt((1 + r) / (1 - r))
    # TFPW-WS (Wang & Swail 2001): iterate r and the attenuation-corrected slope
    bb = b.copy()
    for _ in range(tfpw_iterations):
        Xd = Y - bb[:, None] * t
        rr = bias_corrected(lag1(Xd), n)
        Yp = Y[:, 1:] - rr[:, None] * Y[:, :-1]
        bb = sen_slope(Yp, t[1:]) / (1 - rr)
    z_ws = mk_z(Yp)
    # OLS with AR(1) variance
    tc = t - t.mean()
    Sxx = float((tc ** 2).sum())
    yc = Y - Y.mean(axis=1, keepdims=True)
    b_ols = (yc * tc).sum(axis=1) / Sxx
    res = yc - b_ols[:, None] * tc
    ro = bias_corrected(lag1(res), n)
    s2 = (res ** 2).sum(axis=1) / (n - 2)
    se = np.sqrt(s2 / Sxx * (1 + ro) / (1 - ro))
    z_ols = b_ols / se
    return {"sen": b, "r1": r, "sigma": np.sqrt(s2), "se_ols": se, "z_naive": z_naive,
            "z_vc": z_vc, "z_ws": z_ws, "z_ols": z_ols}
