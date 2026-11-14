"""Input interface (contract/CUBE.md). HORI only reads this; it never fetches data."""
from __future__ import annotations
from dataclasses import dataclass
import numpy as np


@dataclass
class Cube:
    values: np.ndarray      # [T, Y, X] float32, NaN = missing
    valid: np.ndarray       # [T, Y, X] bool
    time: np.ndarray        # [T] ISO-8601 strings
    lat: np.ndarray         # [Y]
    lon: np.ndarray         # [X]
    meta: dict              # provenance and description (see CUBE.md)
    cell_area: np.ndarray | None = None
    land_mask: np.ndarray | None = None

    @classmethod
    def from_npz(cls, path: str) -> "Cube":
        raise NotImplementedError
