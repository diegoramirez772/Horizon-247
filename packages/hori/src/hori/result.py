"""Output interface: what HORI computes per layer (maps 1:1 to the bundle arrays in contract/SPEC.md)."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class LayerResult:
    effect: np.ndarray          # per decade, [cells]
    ci_lo: np.ndarray
    ci_hi: np.ndarray
    sigma: np.ndarray
    r1: np.ndarray
    p_cons: np.ndarray
    q_cons: np.ndarray
    mde: np.ndarray
    years_more: np.ndarray
    verdict: np.ndarray         # uint8 codes (verdict.CODES)
    flags: np.ndarray           # uint8 bitmask (verdict.FLAG_BITS)
    nvalid: np.ndarray
    nsig_methods: np.ndarray
    naive_sig: np.ndarray
    series: np.ndarray | None   # [cells, n] annual anomaly series used for the tests (None for global maps)
    years: list = field(default_factory=list)
    manifest: dict = field(default_factory=dict)
    break_year: np.ndarray | None = None   # [cells] first year of a possible new regime (NaN = no break flagged)
    e_cons: np.ndarray | None = None       # [cells] mean e-value of the voting tests (parallel evidence, H6)
    ebh_sig: np.ndarray | None = None      # [cells] 1 if discovered by e-BH at fdr_q (valid under any dependence)
    delta: np.ndarray | None = None   # [cells] the delta each cell was judged against (D2: always visible)
