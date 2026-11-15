"""Why HORI does NOT estimate H per cell: Gaussian ML of H on normal scores of the Sen-detrended series is biased low.

    PYTHONPATH=packages/hori/src python3 sim/longmemory_hurst_bias.py
Simulates fGn with known H (n = 24 and 45), estimates H on the grid 0.50-0.95 (never below 0.5) as Hamed (2008) does, and prints
the mean estimate. Result in docs/MODEL_CARD.md section 3.10.
"""
from statistics import NormalDist

import numpy as np

from hori.longmemory import fgn_acf
from hori.stats import sen_slope

rng = np.random.default_rng(5)
GRID = np.round(np.arange(0.50, 0.9501, 0.05), 2)


def fgn(H, n, m):
    R = np.array([fgn_acf(H, n)[np.abs(a - np.arange(n))] for a in range(n)])
    return rng.standard_normal((m, n)) @ np.linalg.cholesky(R + 1e-12 * np.eye(n)).T


def hurst_ml(X):
    m, n = X.shape
    t = np.arange(n, dtype=float)
    X = X - sen_slope(X)[:, None] * t                                 # detrend with the Sen slope, as Hamed does
    z = np.array([NormalDist().inv_cdf(k / (n + 1)) for k in range(1, n + 1)])
    Z = z[np.argsort(np.argsort(X, axis=1), axis=1)]                  # normal scores of the ranks
    dev = []
    for H in GRID:
        R = np.array([fgn_acf(H, n)[np.abs(a - np.arange(n))] for a in range(n)])
        q = ((Z @ np.linalg.inv(R)) * Z).sum(axis=1) / n
        dev.append(n * np.log(q) + np.linalg.slogdet(R)[1])
    return GRID[np.argmin(np.array(dev), axis=0)]


for n in (24, 45):
    row = {f"{H}": round(float(hurst_ml(fgn(H, n, 1500)).mean()), 2) for H in (0.5, 0.6, 0.7, 0.8, 0.9)}
    print(f"n={n}: true H -> mean estimated H  {row}")
