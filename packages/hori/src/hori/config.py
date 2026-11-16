"""Configuration (defaults mirror config/hori.yaml and the team method spec)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Config:
    alpha: float = 0.05
    fdr_q: float = 0.10
    delta_sigma_per_decade: float = 2.0
    delta_per_decade: float | None = None   # effect of interest in PHYSICAL units per decade; overrides delta_sigma when set
    min_years: int = 10
    min_valid_fraction: float = 0.80
    max_interior_gap_years: int = 2
    min_months: int = 9                  # months needed (of 12) for a valid year
    tfpw_ws_iterations: int = 6
    mde_power: float = 0.80
    coarse_resolution_deg: float = 2.0   # cells at least this coarse get the `resolucion_gruesa` flag
    memory_hurst: float = 0.7            # Hurst exponent of the MK-LM voter: Mann-Kendall variance under fGn(H) (see longmemory.py)
    seed: int = 247
    # which tests vote; PROBADO needs all of them. "MK-LM" (Mann-Kendall under long memory, see longmemory.py) can be
    # added as a fourth voter; measured on the planet's own noise it is dominated by the e-BH requirement below.
    methods: tuple = ("MK-VC", "TFPW-WS", "OLS-AR1")
    # HORI 1.2: a PROBADO must also be discovered by e-BH (false discovery control under ANY dependence between cells
    # and tests). Measured on the planet's own noise: FDR of PROBADO 6-23 % -> below the nominal 10 % in both noise
    # models (1.0 % and 6.9 %; sim/null_planet.py, sim/rule_search_v12.py). False (with ci_hurst=None) reproduces HORI 1.0 exactly.
    require_ebh: bool = True
    # HORI 1.2: the 95 % interval of the effect is never narrower than the one of long-memory noise fGn(ci_hurst).
    # Measured on the planet's own noise (sim/ci_coverage_v12.py): coverage 78-95 % -> 90-99.7 %. None = the AR(1) interval of 1.0.
    ci_hurst: float | None = 0.8
