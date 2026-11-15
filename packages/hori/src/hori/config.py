"""Configuration (defaults in config/hori.yaml). Plain dataclass so HORI keeps depending on NumPy only."""
from __future__ import annotations
from dataclasses import dataclass, asdict


@dataclass
class Config:
    alpha: float = 0.05
    fdr_q: float = 0.10
    delta_sigma_per_decade: float = 2.0
    min_years: int = 10
    min_valid_fraction: float = 0.80
    max_interior_gap_years: int = 2
    tfpw_ws_iterations: int = 6
    r1_clip: tuple[float, float] = (0.0, 0.95)
    mde_power: float = 0.80
    min_months_per_year: int = 9
    windows_expanding: bool = True
    windows_min_n: int = 10
    chunk_cells: int = 20000          # cells processed at once (keeps memory low on small laptops)
    seed: int = 247

    @classmethod
    def from_dict(cls, d: dict) -> "Config":
        d = dict(d or {})
        w = d.pop("windows_expanding", None)
        out = cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})
        if isinstance(w, dict):
            out.windows_expanding = bool(w.get("enabled", True))
            out.windows_min_n = int(w.get("min_n", out.windows_min_n))
        elif isinstance(w, bool):
            out.windows_expanding = w
        if isinstance(out.r1_clip, list):
            out.r1_clip = (float(out.r1_clip[0]), float(out.r1_clip[1]))
        return out

    @classmethod
    def from_yaml_text(cls, text: str) -> "Config":
        """Tiny reader for the flat hori.yaml (no PyYAML needed). Supports `key: value` and `key: {a: 1, b: 2}`."""
        d: dict = {}
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line or ":" not in line:
                continue
            key, val = line.split(":", 1)
            d[key.strip()] = _parse_scalar(val.strip())
        return cls.from_dict(d)

    def to_dict(self) -> dict:
        return asdict(self)


def _parse_scalar(v: str):
    if v.startswith("{") and v.endswith("}"):
        out = {}
        for part in v[1:-1].split(","):
            if ":" in part:
                k, x = part.split(":", 1)
                out[k.strip()] = _parse_scalar(x.strip())
        return out
    if v.startswith("[") and v.endswith("]"):
        return [_parse_scalar(x.strip()) for x in v[1:-1].split(",") if x.strip()]
    low = v.lower()
    if low in ("true", "false"):
        return low == "true"
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        return v.strip("'\"")
