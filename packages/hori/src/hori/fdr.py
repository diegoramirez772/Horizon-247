"""Step 5: Benjamini-Hochberg across valid cells (and across named regions).

Must not import zon or any web code.
"""
from __future__ import annotations
import numpy as np


def bh_qvalues(p: np.ndarray) -> np.ndarray:
    """Benjamini-Hochberg adjusted p-values (q-values). NaN in -> NaN out; only finite p count toward m."""
    p = np.asarray(p, float)
    q = np.full(p.shape, np.nan)
    ok = np.isfinite(p)
    m = int(ok.sum())
    if m == 0:
        return q
    pv = p[ok]
    order = np.argsort(pv)
    ranked = pv[order] * m / np.arange(1, m + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]   # monotone from the largest p down
    qv = np.empty(m)
    qv[order] = np.minimum(ranked, 1.0)
    q[ok] = qv
    return q
