"""Write cubes in the ZON -> HORI interface format (contract/CUBE.md)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


@dataclass
class CubeData:
    values: np.ndarray        # [T, Y, X] float32, NaN = missing
    valid: np.ndarray         # [T, Y, X] bool
    time: list[str]           # ISO dates, length T
    lat: np.ndarray           # [Y] cell centers, north -> south
    lon: np.ndarray           # [X] cell centers, west -> east
    meta: dict = field(default_factory=dict)

    def write_npz(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(path, values=self.values.astype("float32"), valid=self.valid,
                            time=np.array(self.time, dtype="U10"), lat=self.lat.astype("float64"),
                            lon=self.lon.astype("float64"), meta=np.array(json.dumps(self.meta, ensure_ascii=False)))
        return path
