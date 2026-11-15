"""L1 quality: is there a step (break) in the series that a trend test would mistake for a trend?

Detector: model comparison «line» vs «line + step at k», maximised over k (a sup-F test). It is the likelihood-ratio
test for exactly the question asked, and it matters: detrending first and then running the classic homogeneity
tests (Pettitt, SNHT, Buishand) loses most of the power, because a mid-series step is 0.87 correlated with a
straight line (measured here: the classic 2-of-3 vote caught 20 % of 2-sigma steps at n = 40). The classic three
are still computed on the line residuals and reported as SUPPORT votes, never as the decision.

The F statistic is deflated by (1 - r) / (1 + r) (same AR(1) variance correction as the trend tests). Critical
values are NOT taken from published tables: they are simulated here for exactly this procedure, per series
length, with a fixed seed. Measured rates are printed and guarded by tests/test_quality.py.

A second, complementary question is asked too (_step_vs_line): does a step ALONE fit better than the line?
That is what catches the dangerous case, a jump that the trend tests read as a trend.

Limits (measured; AR(1) phi = 0.3, step in the middle; see tests and sim/redteam.py): sup-F alone at n = 40 has
~5 % false flags and catches 8 / 23 / 55 % of 1 / 2 / 3-sigma steps: a mid-series step hides behind a free trend,
which is information-limited, not a tuning problem. The step-vs-line rule alone has 1 % false flags at
phi = 0.3 (4-5 % at phi = 0.5), flags 1-4 % of real linear trends, catches 55 % (n = 24) to 79 % (n = 45) of
3-sigma steps and 28-50 % of pure random walks. So «no flag» never means «homogeneous», and a flag means
«look at the series», not «artefact». A real acceleration can raise the flag. The flag says POSSIBLE break: without sensor/version
metadata HORI cannot tell an artefact from a real abrupt change, so the verdict is not changed, only flagged.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np

from .stats import bias_corrected, lag1

TRIM = 3                    # ignore candidate breaks within 3 points of either end
LEVEL = 0.99                # per-test quantile of the simulated null
REF_PHI = 0.3               # autocorrelation of the reference noise (same as the trend calibration)
_SIMS, _SEED = 20000, 247
REF_PHI = 0.3              # autocorrelation of the simulated null for the step-vs-line ratio


def _detrend(Y: np.ndarray) -> np.ndarray:
    n = Y.shape[1]
    t = np.arange(n, dtype=float) - (n - 1) / 2.0
    yc = Y - Y.mean(axis=1, keepdims=True)
    return yc - ((yc * t).sum(axis=1) / (t * t).sum())[:, None] * t


def _statistics(X: np.ndarray):
    """X [cells, n] residuals -> (pettitt K, snht T0, buishand Q, break index of each), ends trimmed."""
    m, n = X.shape
    k = np.arange(1, n)                                              # split after position k (1..n-1)
    keep = slice(TRIM - 1, n - 1 - TRIM)
    ranks = np.argsort(np.argsort(X, axis=1), axis=1) + 1.0
    U = np.abs(2.0 * np.cumsum(ranks, axis=1)[:, :-1] - k * (n + 1.0))[:, keep]
    sd = X.std(axis=1, ddof=1, keepdims=True)
    sd[sd == 0] = np.nan
    S = np.cumsum(X - X.mean(axis=1, keepdims=True), axis=1)[:, :-1] / sd
    T = (S * S * (1.0 / k + 1.0 / (n - k)))[:, keep]                 # SNHT: k*zbar1^2 + (n-k)*zbar2^2 with sum(z) = 0
    Q = (np.abs(S) / np.sqrt(n))[:, keep]
    off = TRIM
    return (U.max(axis=1), T.max(axis=1), Q.max(axis=1),
            U.argmax(axis=1) + off, T.argmax(axis=1) + off, Q.argmax(axis=1) + off)


@lru_cache(maxsize=None)
def _step_basis(n: int) -> tuple[np.ndarray, np.ndarray]:
    """Step regressors 1[t >= k], k = TRIM..n-TRIM-1, made orthogonal to (1, t). Returns (H [K, n], squared norms)."""
    t = np.arange(n, dtype=float)
    ks = np.arange(TRIM, n - TRIM)
    H = (t[None, :] >= ks[:, None]).astype(float)
    A = np.stack([np.ones(n), t - t.mean()], axis=1)
    H = H - (H @ A) / (A * A).sum(axis=0) @ A.T
    return H, (H * H).sum(axis=1)


def _sup_f(X: np.ndarray):
    """X [cells, n] line residuals -> (sup F deflated for AR(1), step position k)."""
    n = X.shape[1]
    H, hh = _step_basis(n)
    gain = (X @ H.T) ** 2 / hh                                       # drop in RSS from adding the step at each k
    rss = (X * X).sum(axis=1, keepdims=True)
    with np.errstate(invalid="ignore", divide="ignore"):
        F = gain / ((rss - gain) / (n - 3))
    j = np.nanargmax(np.where(np.isfinite(F), F, -1.0), axis=1)
    rows = np.arange(X.shape[0])
    step_res = X - (X @ H.T)[rows, j][:, None] / hh[j][:, None] * H[j]   # residuals of the best line + step model
    r = bias_corrected(lag1(step_res), n)
    return F[rows, j] * (1 - r) / (1 + r), j + TRIM


def _step_vs_line(Y: np.ndarray, X: np.ndarray):
    """RSS of the best «two flat levels» model / RSS of the straight line, and the step position.

    A different question from sup-F: not «does a step ADD to the line?» but «does a step ALONE explain the series
    better than a line?». Both models have two level parameters, so a small ratio means the «trend» is more likely
    a jump (sensor/version change, regime shift) — or a random walk, which also looks like steps.
    """
    n = Y.shape[1]
    yc = Y - Y.mean(axis=1, keepdims=True)
    k = np.arange(TRIM, n - TRIM)
    between = np.cumsum(yc, axis=1)[:, k - 1] ** 2 * (1.0 / k + 1.0 / (n - k))
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = ((yc * yc).sum(axis=1) - between.max(axis=1)) / (X * X).sum(axis=1)
    return ratio, between.argmax(axis=1) + TRIM


@lru_cache(maxsize=None)
def critical_values(n: int) -> tuple[float, float, float, float, float]:
    """Simulated nulls, deterministic: (supF, Pettitt, SNHT, Buishand upper 1 % on Gaussian white noise — sup-F
    carries its own AR(1) deflation — and the step-vs-line ratio LOWER 1 % quantile on AR(1) noise with
    phi = REF_PHI, HORI's calibration reference, because that ratio has no autocorrelation correction)."""
    rng = np.random.default_rng(_SEED + n)
    Y = rng.standard_normal((_SIMS, n))
    X = _detrend(Y)
    K, T, Q, *_ = _statistics(X)
    q = lambda a: float(np.quantile(a, LEVEL))
    A = np.empty((_SIMS, n))
    A[:, 0] = rng.standard_normal(_SIMS)
    for t in range(1, n):
        A[:, t] = REF_PHI * A[:, t - 1] + np.sqrt(1 - REF_PHI ** 2) * rng.standard_normal(_SIMS)
    return q(_sup_f(X)[0]), q(K), q(T), q(Q), float(np.quantile(_step_vs_line(A, _detrend(A))[0], 1.0 - LEVEL))


def detect_breaks(Y: np.ndarray):
    """Y [cells, n] complete series -> (flag bool, index of the first point of the new regime or -1, support 0..3).

    flag = sup-F above its simulated 1 % level (a step on top of the line) OR the step-alone model beating the
    line by more than noise would (a step instead of the line). support = classic tests that agree (0..3).
    """
    Y = np.asarray(Y, dtype=float)
    m, n = Y.shape
    flag, where, support = np.zeros(m, bool), np.full(m, -1, dtype=np.int64), np.zeros(m, np.uint8)
    if n < 2 * TRIM + 6:
        return flag, where, support
    X = _detrend(Y)
    F, k = _sup_f(X)
    K, T, Q, *_ = _statistics(X)
    ratio, kr = _step_vs_line(Y, X)
    cF, cK, cT, cQ, cR = critical_values(n)
    with np.errstate(invalid="ignore"):
        by_f, by_r = F > cF, ratio < cR
        flag = by_f | by_r
        support = ((K > cK).astype(np.uint8) + (T > cT) + (Q > cQ)).astype(np.uint8)
    where[flag] = np.where(by_r, kr, k)[flag]
    return flag, where, support
