"""Input interface (contract/CUBE.md). HORI only reads this; it never fetches data."""
from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np


@dataclass
class Cube:
    values: np.ndarray      # [T, Y, X] float32, NaN = missing
    valid: np.ndarray       # [T, Y, X] bool
    time: np.ndarray        # [T] ISO-8601 strings
    lat: np.ndarray         # [Y] cell centers, north -> south
    lon: np.ndarray         # [X] cell centers, west -> east
    meta: dict              # provenance and description (see CUBE.md)
    cell_area: np.ndarray | None = None
    land_mask: np.ndarray | None = None

    @classmethod
    def from_npz(cls, path: str) -> "Cube":
        z = np.load(path, allow_pickle=False)
        return cls(z["values"], z["valid"], z["time"], z["lat"], z["lon"], json.loads(str(z["meta"])),
                   z["cell_area"] if "cell_area" in z.files else None,
                   z["land_mask"] if "land_mask" in z.files else None)
