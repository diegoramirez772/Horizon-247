"""L2b: how a PROBADO trend behaves if the noise has LONG MEMORY instead of AR(1) (Hamed 2008, variance of Mann-Kendall).

An AR(1) correction forgets exponentially. Climate series can forget like a power law (fractional Gaussian noise, Hurst
H in (0.5, 1)): a slow wander that looks like a trend over 20-45 years and fools every AR(1)-corrected test.
Hamed (2008) keeps the Mann-Kendall statistic S and replaces its variance by the exact variance under fGn(H):

  Var_H(S) = (2/pi) sum_{i<j} sum_{k<l} arcsin( [r(l-j) - r(k-j) - r(l-i) + r(k-i)] / sqrt((2-2r(j-i)) (2-2r(l-k))) ),
  r(k) = 0.5 (|k+1|^2H - 2|k|^2H + |k-1|^2H)       (S depends only on ranks, so a Gaussian copula is enough)

H = 0.5 reproduces the classical n(n-1)(2n+5)/18 exactly (checked in the tests).

What HORI does with it, and why (measured in sim/, see docs/MODEL_CARD.md):
  * H is NOT estimated per cell. Maximum likelihood on 24-45 annual values is biased LOW when the memory is real
    (true H = 0.8 gave a mean estimate of 0.60 at n = 24 and 0.67 at n = 45: the Sen detrending absorbs the slow wander), so
    an estimated-H test barely changes the verdict. Trend and long memory are not separable with so few years.
  * Instead a FIXED H (Config.memory_hurst, 0.7) is used as a sensitivity check: a PROBADO cell is also
    «robusto a memoria larga» only if it stays significant at alpha when the variance is the one of fGn(0.7).
    That is a stronger claim, not a replacement of the verdict, and it is reported next to it (robust_mem.u8).
  * It does not rescue a random walk (H -> 1 is outside fGn): that limit stays published.
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np


def fgn_acf(H: float, n: int) -> np.ndarray:
    k = np.arange(n, dtype=float)
    return 0.5 * (np.abs(k + 1) ** (2 * H) - 2 * k ** (2 * H) + np.abs(k - 1) ** (2 * H))


@lru_cache(maxsize=512)
def mk_variance(n: int, H: float) -> float:
    """Exact Var(S) for n observations of fGn(H) (no ties). H = 0.5 gives n(n-1)(2n+5)/18."""
    i, j = np.triu_indices(n, 1)
    r = fgn_acf(H, n)
    I, J, K, L = i[:, None], j[:, None], i[None, :], j[None, :]        # pairs (i<j) as rows, (k<l) as columns
    num = r[np.abs(L - J)] - r[np.abs(K - J)] - r[np.abs(L - I)] + r[np.abs(K - I)]
    den = np.sqrt((2 - 2 * r[J - I]) * (2 - 2 * r[L - K]))
    return float(2.0 / math.pi * np.arcsin(np.clip(num / den, -1.0, 1.0)).sum())


def memory_scale(n: int, H: float) -> float:
    """z_H = z_classical * memory_scale: how much the Mann-Kendall z shrinks when the noise is fGn(H) instead of white."""
    return math.sqrt(n * (n - 1) * (2 * n + 5) / 18.0 / mk_variance(n, round(float(H), 4)))
