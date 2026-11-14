"""Configuration (defaults in config/hori.yaml)."""
from __future__ import annotations
from dataclasses import dataclass


@dataclass
class Config:
    alpha: float = 0.05
    fdr_q: float = 0.10
    delta_sigma_per_decade: float = 2.0
    min_years: int = 10
    min_valid_fraction: float = 0.80
    max_interior_gap_years: int = 2
    tfpw_ws_iterations: int = 6
    mde_power: float = 0.80
    seed: int = 247
