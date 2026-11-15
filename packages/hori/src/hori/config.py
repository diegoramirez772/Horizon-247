"""Configuration (defaults mirror config/hori.yaml and docs/SPEC.md)."""
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
    seed: int = 247
    methods: tuple = ("MK-VC", "TFPW-WS", "OLS-AR1")   # which tests vote; PROBADO needs all of them (calibrated: all 3)
