"""Orchestrates one layer end to end: fetch -> cube -> HORI -> bundle.

ZON talks to HORI ONLY through `hori.api` (public, stable). Everything is reproducible: the same cached responses
give the same cube hash and the same bundle.
"""
from __future__ import annotations

from pathlib import Path

from .fetch.power import GridSpec, PowerClient


def slug(text: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in text.lower()).strip("_")


def build_power_layer(bbox, param: str, start: int, end: int, out_root: str | Path, *, region: str = "region",
                      level: str = "monthly", cache_dir=None, offline: bool = False, grid: GridSpec | None = None,
                      title_es: str | None = None, title_en: str | None = None, min_interval: float = 1.0,
                      config=None, progress=None, fetch_params: list[str] | None = None):
    """NASA POWER box -> cube (.npz) -> HORI findings -> bundle. Returns (bundle_dir, LayerResult).

    `fetch_params`: request this set of parameters in ONE call per cell (default: just `param`). Using the same set every time
    keeps requests identical, so the cache is reused and NASA is not asked twice.
    """
    from hori.api import Config, Cube, run_layer, write_bundle          # public API only

    out_root = Path(out_root)
    client = PowerClient(cache_dir, offline=offline, grid=grid, min_interval=min_interval)
    cube_data = client.region_cube(tuple(bbox), fetch_params or [param], start, end, level, progress=progress)[param]
    npz = cube_data.write_npz(out_root / "cubes" / f"{cube_data.meta['id']}.npz")
    result = run_layer(Cube.from_npz(str(npz)), config or Config())
    bundle = write_bundle(result, out_root / "bundles" / "earth" / f"power_{slug(param)}_{slug(region)}_{start}-{end}",
                          title_es, title_en)
    return bundle, result
