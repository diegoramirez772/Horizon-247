"""Step 5: Benjamini-Hochberg false discovery rate control."""
from __future__ import annotations

import numpy as np


def bh_adjust(p: np.ndarray) -> np.ndarray:
    """BH-adjusted p-values (q-values). NaN entries are ignored and stay NaN. A cell is 'discovered' when q <= fdr_q."""
    p = np.asarray(p, dtype=float)
    q = np.full(p.shape, np.nan)
    ok = np.isfinite(p)
    m = int(ok.sum())
    if m == 0:
        return q
    idx = np.where(ok)[0]
    order = idx[np.argsort(p[idx])]
    ranked = p[order] * m / np.arange(1, m + 1)
    adj = np.minimum.accumulate(ranked[::-1])[::-1]
    q[order] = np.clip(adj, 0.0, 1.0)
    return q
