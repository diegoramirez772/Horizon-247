"""Orchestrates one layer end to end: fetch -> cube -> HORI -> bundle.

ZON talks to HORI ONLY through `hori.api` (public, stable). Everything is reproducible: the same cached responses
give the same cube hash and the same bundle.
"""
from __future__ import annotations

import json
from pathlib import Path

from .fetch.power import GridSpec, PowerClient


def slug(text: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in text.lower()).strip("_")


def build_power_layer(bbox, param: str, start: int, end: int, out_root: str | Path, *, region: str = "region",
                      level: str = "monthly", cache_dir=None, offline: bool = False, grid: GridSpec | None = None,
                      title_es: str | None = None, title_en: str | None = None, min_interval: float = 1.0,
                      config=None, progress=None, fetch_params: list[str] | None = None, entity=None, profile=None,
                      bundle_path: str | None = None, extra_manifest: dict | None = None):
    """NASA POWER box -> cube (.npz) -> HORI findings -> bundle. Returns (bundle_dir, LayerResult).

    `fetch_params`: request this set of parameters in ONE call per cell (default: just `param`). Using the same set every time
    keeps requests identical, so the cache is reused and NASA is not asked twice.
    `profile="auto"` lets HORI infer the profile and create the entity card (L0); `bundle_path` is relative to
    out_root/bundles; the bundle is added to out_root/bundles/index.json (Z2).
    """
    from hori.api import Config, Cube, run_layer, write_bundle          # public API only

    out_root = Path(out_root)
    client = PowerClient(cache_dir, offline=offline, grid=grid, min_interval=min_interval)
    cube_data = client.region_cube(tuple(bbox), fetch_params or [param], start, end, level, progress=progress)[param]
    npz = cube_data.write_npz(out_root / "cubes" / f"{cube_data.meta['id']}.npz")
    place = None if entity is not None or region == "region" else \
        {"name": {"es": region, "en": region}, "geometry": {"type": "bbox", "bbox": list(bbox)},
         "source": {"name": "recuadro dado en la consulta"}}
    result = run_layer(Cube.from_npz(str(npz)), config or Config(), entity=entity, profile=profile, place=place)
    result.manifest.update(extra_manifest or {})
    rel = bundle_path or f"earth/power_{slug(param)}_{slug(region)}_{start}-{end}"
    bundle = write_bundle(result, out_root / "bundles" / rel, title_es, title_en)
    update_index(out_root / "bundles", rel, json.loads((bundle / "manifest.json").read_text(encoding="utf-8")))
    return bundle, result


def update_index(bundles_dir: Path, rel_path: str, manifest: dict) -> Path:
    """Z2: index of what has been COMPUTED (no seeded catalog). Upsert by path, sorted, so the file is reproducible."""
    path = bundles_dir / "index.json"
    entries = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    entries = [e for e in entries if e.get("path") != rel_path]
    ent, prof = manifest.get("entity", {}), manifest.get("profile_spec") or {}
    entries.append({"id": manifest["id"], "entity": ent.get("id"), "entity_name": ent.get("name"),
                    "profile_id": prof.get("id"), "profile": manifest["profile"], "title": manifest.get("title"),
                    "variable": manifest["variable"]["name"],
                    "window": f"{manifest['window']['start']}-{manifest['window']['end']}", "path": rel_path,
                    "cells": ent.get("count"), "data_real": manifest["honesty"]["data_real"],
                    "delta_per_decade": manifest["params"]["delta_per_decade"], "profile_flags": prof.get("flags", [])})
    entries.sort(key=lambda e: e["path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path
