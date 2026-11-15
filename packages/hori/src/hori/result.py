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
    verdict: np.ndarray         # uint8 codes (contract/SPEC.md section 3)
    flags: np.ndarray           # uint8 bitmask
    nvalid: np.ndarray
    nsig_methods: np.ndarray
    naive_sig: np.ndarray
    series: np.ndarray          # [cells, n]
    manifest: dict = field(default_factory=dict)
    # v0.2 (contract section 8)
    windows: dict = field(default_factory=dict)          # {end_year: {verdict, effect, q_cons, mde, years_more, flags}}
    emergence_year: np.ndarray | None = None             # [cells], NaN if never
    regions: list = field(default_factory=list)          # regions.json layer entries (snake_case, SPEC 8.2)

    ARRAY_NAMES = ("effect", "ci_lo", "ci_hi", "sigma", "r1", "p_cons", "q_cons", "mde", "years_more",
                   "verdict", "flags", "nvalid", "nsig_methods", "naive_sig")
