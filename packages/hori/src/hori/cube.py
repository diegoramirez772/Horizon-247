"""Input interface (contract/CUBE.md). HORI only reads this; it never fetches data."""
from __future__ import annotations
from dataclasses import dataclass
import json
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
        with np.load(path, allow_pickle=False) as z:
            meta_raw = z["meta"]
            meta = json.loads(str(meta_raw.item() if meta_raw.shape == () else meta_raw[0]))
            return cls(
                values=z["values"].astype(np.float32, copy=False),
                valid=z["valid"].astype(bool, copy=False),
                time=z["time"].astype(str),
                lat=z["lat"].astype(np.float64),
                lon=z["lon"].astype(np.float64),
                meta=meta,
                cell_area=z["cell_area"] if "cell_area" in z.files else None,
                land_mask=z["land_mask"].astype(bool) if "land_mask" in z.files else None,
            )

    def to_npz(self, path: str) -> None:
        arrays = dict(values=self.values.astype(np.float32), valid=self.valid.astype(bool),
                      time=np.asarray(self.time, dtype=str), lat=np.asarray(self.lat, np.float64),
                      lon=np.asarray(self.lon, np.float64), meta=np.array(json.dumps(self.meta, ensure_ascii=False)))
        if self.cell_area is not None:
            arrays["cell_area"] = self.cell_area.astype(np.float32)
        if self.land_mask is not None:
            arrays["land_mask"] = self.land_mask.astype(bool)
        np.savez_compressed(path, **arrays)

    def check(self) -> None:
        T, Y, X = self.values.shape
        if self.valid.shape != (T, Y, X):
            raise ValueError("valid must have the same shape as values")
        if len(self.time) != T or len(self.lat) != Y or len(self.lon) != X:
            raise ValueError("time/lat/lon do not match values")
        kind = (self.meta.get("dataset") or {}).get("kind")
        if not kind:
            raise ValueError("meta.dataset.kind is required (real provenance or 'simulated')")
