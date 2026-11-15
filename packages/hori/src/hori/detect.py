"""Step 6: minimum detectable effect (MDE) with the measured factor table; years_more for a given delta.

Must not import zon or any web code.
"""
from __future__ import annotations
import numpy as np

K80 = 1.959964 + 0.841621     # z_{0.975} + z_{0.80} = 2.8016

# Factor (consensus rule MDE / ideal MDE) measured by simulation (sim/results_mde_consensus.txt).
FACTOR_N = np.array([15.0, 23.0, 40.0])
FACTOR_PHI = np.array([0.0, 0.3, 0.5])
FACTOR = np.array([
    [1.49, 1.49, 1.73],   # n = 15
    [1.31, 1.27, 1.41],   # n = 23
    [1.22, 1.19, 1.22],   # n = 40
])


def factor(n: int, r: np.ndarray) -> tuple[np.ndarray, bool]:
    """Bilinear interpolation in n and r; clamps to the table edges. Returns (factor, n_outside_table)."""
    r = np.clip(np.asarray(r, float), FACTOR_PHI[0], FACTOR_PHI[-1])
    nn = float(np.clip(n, FACTOR_N[0], FACTOR_N[-1]))
    by_phi = np.array([np.interp(nn, FACTOR_N, FACTOR[:, j]) for j in range(len(FACTOR_PHI))])
    return np.interp(r, FACTOR_PHI, by_phi), not (FACTOR_N[0] <= n <= FACTOR_N[-1])


def mde_per_decade(sigma: np.ndarray, r: np.ndarray, n: int) -> tuple[np.ndarray, bool]:
    """MDE (80 % power, alpha 5 %, two-sided) of the consensus rule, in units per decade."""
    se_ideal = sigma * np.sqrt(12.0 / (n * (n * n - 1)) * (1 + r) / (1 - r))
    f, outside = factor(n, r)
    return f * 10.0 * K80 * se_ideal, outside


def years_more(mde: np.ndarray, delta: np.ndarray, n: int) -> np.ndarray:
    """Extra years needed to rule out changes >= delta: n' = n (MDE/delta)^(2/3); ceil(n'-n); 255 if > 60.
    Always computed with delta, never with the observed effect (no post-hoc power)."""
    with np.errstate(invalid="ignore", divide="ignore"):
        nprime = n * (mde / delta) ** (2.0 / 3.0)
        extra = np.ceil(nprime - n)
    extra = np.where(np.isfinite(extra), np.maximum(extra, 0), np.nan)
    return np.where(extra > 60, 255.0, extra)
