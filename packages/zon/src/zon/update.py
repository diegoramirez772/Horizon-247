"""Z3: «supervisar» for real. Look at the store, and only if a new month exists recompute the planet and emit events.

    update_planet("T2M", "data/bundles", start=1981)

What is incremental and what is not (honest):
  * the CHECK is cheap: metadata + the one chunk around the probe cell (~100 KB) tell us the last month with data;
  * a Zarr chunk spans ALL months, so a new month changes every chunk: the recompute re-reads the 260 chunks
    (not just «the new month»). With a cache that is minutes of CPU; without it, the download time of the planet;
  * HORI then re-judges every cell with the same rule, and the EVENTS are the difference between the previous bundle
    and the new one (CRUZO, SE_DEBILITO, CAMBIO_SIGNO, NUEVO), from hori.api.summarize with two windows.
The year that ends the window is the last one with >= min_months months of data: a half-filled year would make every
cell «unusable» (missing end year), so it is left out until it has enough months.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

from .build import update_index
from .fetch.power_zarr import KNOWN_BREAKS, PowerZarr
from .planet import _reason

MIN_MONTHS = 9


def window_end_year(last_month: str, min_months: int = MIN_MONTHS) -> int:
    """Last year that already has >= min_months months (a year starting in January: month number = months so far)."""
    y, m = int(last_month[:4]), int(last_month[5:7])
    return y if m >= min_months else y - 1


def power_meta(z: PowerZarr, var: str, start: int, end: int, last_month: str) -> dict:
    at = z.attrs(var)
    return {"id": f"powerzarr_{var}_global_{start}-{end}", "profile": "earth",
            "variable": {"name": var, "unit": at.get("units", ""), "long_name": at.get("long_name", ""),
                         "definition": at.get("definition", ""), "valid_min": at.get("valid_min"),
                         "valid_max": at.get("valid_max"), "cell_methods": at.get("cell_methods", "")},
            "dataset": {"name": "NASA POWER ARD (MERRA-2), Zarr on AWS", "kind": "reanalysis", "url": z.url,
                        "time_standard": "UTC" if z.url.endswith("_utc.zarr") else "LST", "last_month": last_month,
                        "known_breaks": KNOWN_BREAKS},
            "native_resolution_deg": 0.5, "native_resolution_lon_deg": 0.625, "notes": []}


def _previous(bundle_dir: Path) -> dict | None:
    mp = bundle_dir / "manifest.json"
    if not mp.exists():
        return None
    m = json.loads(mp.read_text(encoding="utf-8"))
    cells = m["entity"]["count"]
    return {"manifest": m, "verdict": np.fromfile(bundle_dir / "verdict.u8", "u1"),
            "effect": np.fromfile(bundle_dir / "effect.f32", "<f4"), "cells": cells}


def _latest_bundle(root: Path, var: str) -> Path | None:
    """The newest global bundle of this variable under bundles/earth (by window end, then by last_month)."""
    best = None
    for d in sorted((root / "earth").glob(f"global_{var.lower()}_*")):
        mp = d / "manifest.json"
        if not mp.exists():
            continue
        m = json.loads(mp.read_text(encoding="utf-8"))
        key = (m["window"]["end"], m.get("dataset", {}).get("last_month", ""))
        if best is None or key > best[0]:
            best = (key, d)
    return best[1] if best else None


def update_planet(var: str, bundles_root: str | Path, *, start: int = 1981, store: PowerZarr | None = None, config=None,
                  top: int = 100, progress=None, force: bool = False) -> dict:
    """Check the store; if there is a new month, recompute the planet and write the new bundle + events.

    Returns {"status": "sin_novedad" | "actualizado" | "primera_construccion", ...}. Never overwrites the previous
    bundle: a new window end gives a new directory (the history stays), the same end replaces its own.
    """
    from hori.api import EVENT_CODES, TIER_CODES, Config, run_grid, summarize, write_bundle   # public API only

    root = Path(bundles_root)
    z = store or PowerZarr(refresh=True)
    last = z.latest_month(var)
    prev_dir = _latest_bundle(root, var)
    prev = _previous(prev_dir) if prev_dir else None
    prev_last = (prev["manifest"].get("dataset", {}).get("last_month") if prev else None)
    if prev and prev_last == last and not force:
        return {"status": "sin_novedad", "last_month": last, "bundle": str(prev_dir)}
    cfg = config or Config()
    end = window_end_year(last, cfg.min_months)
    if end - start + 1 < cfg.min_years:
        raise ValueError(f"the store only reaches {last}: {end - start + 1} valid years from {start} (need {cfg.min_years})")
    gen, lat, lon, time_axis = z.grid_blocks(var, start, end)
    meta = power_meta(z, var, start, end, last)
    res = run_grid(gen, lat, lon, time_axis, meta, cfg, profile="auto", sample=z.sample_values(var, start, end),
                   progress=progress)
    rel = f"earth/global_{var.lower()}_{start}-{end}"
    out = write_bundle(res, root / rel)
    cells = res.verdict.size
    doc = {"contract": "0.4", "kind": "update", "variable": var, "last_month": last, "window_end": end,
           "previous": None, "counts": {}, "events_top": [], "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if prev is None or prev["cells"] != cells:
        status = "primera_construccion"
        doc["note"] = "no hay bundle previo comparable: sin eventos"
    else:
        status = "actualizado"
        prev_end = prev["manifest"]["window"]["end"]
        doc["previous"] = {"last_month": prev_last, "window_end": prev_end, "path": str(prev_dir.relative_to(root))}
        eff_prev, eff_new = prev["effect"], res.effect.astype("<f4")
        d = summarize([prev_end, end], np.stack([prev["verdict"], res.verdict]), np.stack([eff_prev, eff_new]),
                      res.mde.astype("<f4"), res.years_more.astype("<f4"))
        d["effect_now"] = eff_new
        np.asarray(d["event"], "u1").tofile(out / "event.u8")
        np.asarray(d["tier"], "u1").tofile(out / "priority_tier.u8")
        np.asarray(d["strength"], "<f4").tofile(out / "priority_strength.f32")
        np.asarray(d["order"], "<u4").tofile(out / "priority_order.u32")
        nx = len(lon)
        unit = meta["variable"]["unit"]
        for i in d["order"][:top].tolist():
            if d["tier"][i] > 1:
                break                                             # the list is only events and proven
            doc["events_top"].append({"cell": i, "lat": float(lat[i // nx]), "lon": float(lon[i % nx]),
                                      "tier": TIER_CODES[int(d["tier"][i])], "event": EVENT_CODES[int(d["event"][i])],
                                      "effect": round(float(eff_new[i]), 3), "strength": round(float(d["strength"][i]), 2),
                                      "reason": _reason(int(d["tier"][i]), int(d["event"][i]), d, i, [prev_end, end], unit)
                                      if d["tier"][i] == 0 else
                                      {"es": f"PROBADO: {eff_new[i]:+.2f} {unit}/década, {d['strength'][i]:.1f}× el mínimo detectable",
                                       "origin": "HORI"}})
        doc["counts"] = d["stats"]["events"]
        doc["tiers"] = d["stats"]["tiers"]
        doc["honesty"] = {"es": "Eventos = diferencia entre dos fotos de la evidencia (la anterior y la actual) con la misma "
                                "regla. No son predicciones ni alertas de peligro.",
                          "en": "Events = difference between two snapshots of the evidence under the same rule. "
                                "Not predictions, not hazard alerts."}
    (out / "events.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    update_index(root, rel, json.loads((out / "manifest.json").read_text(encoding="utf-8")))
    log = root / "earth" / "updates.json"
    hist = json.loads(log.read_text(encoding="utf-8")) if log.exists() else []
    hist.append({"at": doc["created_at"], "variable": var, "from": prev_last, "to": last, "status": status,
                 "events": doc["counts"], "bundle": rel})
    log.write_text(json.dumps(hist, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"status": status, "last_month": last, "previous_last_month": prev_last, "bundle": str(out), "events": doc["counts"],
            "summary": res.manifest["summary"]}
