"""Step 3-4: Sen slope, MK-VC, TFPW-WS, OLS-AR(1), consensus p. Reference: ../../sim/h247_sim.py.

Vectorized over rows: Y has shape [m, n] (m series, n years, no NaN). Must not import zon or any web code.
"""
from __future__ import annotations
import math
import numpy as np

Z05 = 1.959964


def erfc_vec(x: np.ndarray) -> np.ndarray:
    """erfc for x >= 0 (Abramowitz-Stegun 7.1.26, error < 1.5e-7). Same as the calibration code."""
    x = np.asarray(x, float)
    t = 1.0 / (1.0 + 0.3275911 * x)
    poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
    return poly * np.exp(-x * x)


def p_two(z: np.ndarray) -> np.ndarray:
    """Two-sided p-value of a standard normal statistic."""
    return np.clip(erfc_vec(np.abs(z) / math.sqrt(2)), 0.0, 1.0)


def mk_z(Y: np.ndarray) -> np.ndarray:
    """Mann-Kendall Z (no tie correction, continuity correction as in the calibration code)."""
    m, n = Y.shape
    S = np.zeros(m)
    for i in range(n - 1):
        S += np.sign(Y[:, i + 1:] - Y[:, [i]]).sum(1)
    return (S - np.sign(S)) / math.sqrt(n * (n - 1) * (2 * n + 5) / 18)


def sen(Y: np.ndarray, t: np.ndarray | None = None) -> np.ndarray:
    """Sen slope per row (median of pairwise slopes), in units per time step."""
    m, n = Y.shape
    if t is None:
        t = np.arange(n, dtype=float)
    i, j = np.triu_indices(n, 1)
    return np.median((Y[:, j] - Y[:, i]) / (t[j] - t[i]), axis=1)


def r1_of(X: np.ndarray) -> np.ndarray:
    xc = X - X.mean(1, keepdims=True)
    den = (xc ** 2).sum(1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(den > 0, (xc[:, 1:] * xc[:, :-1]).sum(1) / np.where(den > 0, den, 1), 0.0)


def bias_corrected_r1(r: np.ndarray, n: int, clip=(0.0, 0.95)) -> np.ndarray:
    """r = clip(r1 + (1 + 3 r1)/n, 0, 0.95)  (Kendall 1954, approximation)."""
    return np.clip(r + (1 + 3 * r) / n, clip[0], clip[1])


def trend_tests(Y: np.ndarray, iterations: int = 6, clip=(0.0, 0.95)) -> dict:
    """All per-series quantities for steps 3-4 (docs/SPEC.md). Y: [m, n], no NaN, n >= 4."""
    m, n = Y.shape
    t = np.arange(n, dtype=float)
    out: dict = {}

    z_naive = mk_z(Y)
    b_sen = sen(Y, t)
    X = Y - b_sen[:, None] * t
    r = bias_corrected_r1(r1_of(X), n, clip)

    # 1. MK-VC (variance correction for AR(1))
    z_vc = z_naive / np.sqrt((1 + r) / (1 - r))

    # 2. TFPW-WS (Wang & Swail 2001, iterative)
    bb = b_sen.copy()
    rr = r.copy()
    Yp = Y[:, 1:] - rr[:, None] * Y[:, :-1]
    for _ in range(iterations):
        Xi = Y - bb[:, None] * t
        rr = bias_corrected_r1(r1_of(Xi), n, clip)
        Yp = Y[:, 1:] - rr[:, None] * Y[:, :-1]
        bb = sen(Yp, t[1:]) / (1 - rr)
    z_ws = mk_z(Yp)

    # 3. OLS with AR(1) variance
    tc = t - t.mean()
    Sxx = (tc ** 2).sum()
    Ym = Y - Y.mean(1, keepdims=True)
    b_ols = (Ym * tc).sum(1) / Sxx
    res = Ym - b_ols[:, None] * tc
    ro = bias_corrected_r1(r1_of(res), n, clip)
    s2 = (res ** 2).sum(1) / (n - 2)
    se_ols = np.sqrt(s2 / Sxx * (1 + ro) / (1 - ro))
    with np.errstate(invalid="ignore", divide="ignore"):
        z_ols = np.where(se_ols > 0, b_ols / np.where(se_ols > 0, se_ols, 1), 0.0)

    p_vc, p_ws, p_ols = p_two(z_vc), p_two(z_ws), p_two(z_ols)
    out["b_sen"] = b_sen                       # units per year
    out["sigma"] = X.std(1, ddof=1)            # sd of the detrended series
    out["r1"] = r                              # bias-corrected lag-1 autocorrelation of the detrended series
    out["se_ols"] = se_ols                     # units per year
    out["p_vc"], out["p_ws"], out["p_ols"] = p_vc, p_ws, p_ols
    out["p_cons"] = np.maximum.reduce([p_vc, p_ws, p_ols])   # intersection-union test
    out["z_naive"] = z_naive
    return out
