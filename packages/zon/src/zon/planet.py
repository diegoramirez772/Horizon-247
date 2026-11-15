"""The planet, offline: an annual cube built once from the POWER chunks, and the evidence timeline on top of it.

    annual_planet("T2M", 1981, 2025, "data")          # chunks (cache) -> data/planet/t2m_annual_1981-2025.npz (~75 MB)
    build_timeline(npz, "data/bundles/earth/timeline_t2m_1981-2025", workers=2)

Why a cube: every later question (time machine, events, any place, a new delta) reads 75 MB from disk instead of
decoding 260 chunks again, with no network. Annual values are HORI's own aggregation (hori.api.to_annual) over the
full period, so the last window reproduces the global bundle.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .fetch.power_zarr import PowerZarr
from .provenance import iso_utc


def annual_planet(var: str, start: int, end: int, out_root: str | Path, *, store: PowerZarr | None = None,
                  min_months: int = 9, progress=None) -> Path:
    from hori.api import to_annual                                      # public API only

    z = store or PowerZarr()
    gen, lat, lon, time_axis = z.grid_blocks(var, start, end)
    annual, years, shas = None, None, 0
    for k, (y0, x0, vals) in enumerate(gen, 1):
        a, yrs, _ = to_annual(vals, time_axis, min_months)
        if annual is None:
            years = yrs
            annual = np.full((len(yrs), len(lat), len(lon)), np.nan)
        annual[:, y0:y0 + a.shape[1], x0:x0 + a.shape[2]] = a
        if progress:
            progress(k)
    at = z.attrs(var)
    meta = {"id": f"powerzarr_{var}_annual_{start}-{end}", "profile": "earth",
            "variable": {"name": var, "unit": at.get("units", ""), "long_name": at.get("long_name", ""),
                         "definition": at.get("definition", ""), "valid_min": at.get("valid_min"),
                         "valid_max": at.get("valid_max"), "cell_methods": at.get("cell_methods", "")},
            "dataset": {"name": "NASA POWER ARD (MERRA-2), Zarr on AWS", "kind": "reanalysis", "url": z.url,
                        "sha256": z.prov.combined_sha256(), "time_standard": "LST"},
            "aggregation": f"mean of monthly anomalies (vs {start}-{end} monthly means); >= {min_months}/12 months",
            "native_resolution_deg": 0.5, "native_resolution_lon_deg": 0.625, "built_at": iso_utc()}
    out = Path(out_root) / "planet" / f"{var.lower()}_annual_{start}-{end}.npz"
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out, annual=annual, years=np.array(years), lat=lat, lon=lon, meta=np.array(json.dumps(meta, ensure_ascii=False)))
    return out


def _reason(tier: int, event: int, d: dict, i: int, ends: list, unit: str) -> dict:
    from hori.api import EVENT_CODES
    eff, k = float(d["effect_now"][i]), float(d["strength"][i])
    if tier == 0:
        name = EVENT_CODES[event]
        es = {"CRUZO": f"Evento: la evidencia cruzó a PROBADO con el dato de {ends[-1]}",
              "SE_DEBILITO": f"Evento: dejó de ser PROBADO con el dato de {ends[-1]}",
              "CAMBIO_SIGNO": f"Evento: la tendencia cambió de signo con el dato de {ends[-1]}",
              "NUEVO": f"Evento: primera vez con datos suficientes ({ends[-1]})"}[name]
    elif tier == 1:
        em = d["emergence_year"][i]
        es = f"PROBADO desde {int(em)}: {eff:+.2f} {unit}/década, {k:.1f}× el mínimo detectable"
    elif tier == 2:
        es = "Por emerger: señal sin confirmar o a ≤ 5 años de poder saberse"
    else:
        es = "Sin novedad"
    return {"es": es, "origin": "HORI"}


def build_timeline(annual_npz: str | Path, out_dir: str | Path, *, config=None, min_n: int = 15, workers: int = 2,
                   top: int = 100, progress=None) -> dict:
    """Annual cube -> expanding-window timeline bundle (arrays + timeline.json). Returns the stats dict."""
    from hori.api import EVENT_CODES, TIER_CODES, Config, infer_profile, run_timeline

    z = np.load(annual_npz, allow_pickle=False)
    annual, years, lat, lon = z["annual"], z["years"].tolist(), z["lat"], z["lon"]
    meta = json.loads(str(z["meta"]))
    prof = infer_profile(meta["variable"])
    cfg, delta_source = prof.apply(config or Config())
    n, ny, nx = annual.shape
    tl = run_timeline(annual.reshape(n, ny * nx), years, cfg, min_n=min_n, workers=workers, progress=progress)
    d = dict(tl.derived)
    d["effect_now"] = tl.effect[-1]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    files = {"verdict_by_window.u8": tl.verdict, "emergence_year.f32": d["emergence_year"],
             "first_probado_year.f32": d["first_probado_year"], "reversals.u8": d["reversals"],
             "sign_flip.u8": d["sign_flip"].astype("u1"), "event.u8": d["event"], "priority_tier.u8": d["tier"],
             "priority_strength.f32": d["strength"], "priority_order.u32": d["order"].astype("<u4")}
    for name, arr in files.items():
        np.asarray(arr).astype({"u8": "u1", "f32": "<f4", "u32": "<u4"}[name.rsplit(".", 1)[1]]).tofile(out / name)
    unit = meta["variable"].get("unit", "")
    top_list = []
    for i in d["order"][:top].tolist():
        top_list.append({"cell": i, "lat": float(lat[i // nx]), "lon": float(lon[i % nx]),
                         "tier": TIER_CODES[int(d["tier"][i])], "event": EVENT_CODES[int(d["event"][i])],
                         "effect": round(float(d["effect_now"][i]), 3), "strength": round(float(d["strength"][i]), 2),
                         "reason": _reason(int(d["tier"][i]), int(d["event"][i]), d, i, tl.ends, unit)})
    em = d["emergence_year"]
    hist = {str(int(y)): int((em == y).sum()) for y in tl.ends}
    doc = {"contract": "0.4", "kind": "timeline", "id": meta["id"].replace("_annual_", "_timeline_"),
           "variable": meta["variable"], "dataset": meta["dataset"],
           "grid": {"type": "latlon", "nlat": ny, "nlon": nx, "lat0": float(lat[0]), "dlat": float(lat[1] - lat[0]),
                    "lon0": float(lon[0]), "dlon": float(lon[1] - lon[0])},
           "windows": {"mode": "expanding", "start": int(years[0]), "ends": tl.ends, "min_n": min_n},
           "params": {"alpha": cfg.alpha, "fdr_q": cfg.fdr_q, "delta_per_decade": cfg.delta_per_decade,
                      "delta_source": delta_source, "methods": list(cfg.methods)},
           "profile_spec": prof.to_dict(), "stats": d["stats"], "emergence_histogram": hist,
           "event_codes": {str(k): v for k, v in EVENT_CODES.items()}, "tier_codes": {str(k): v for k, v in TIER_CODES.items()},
           "arrays": {k: {"file": k, "shape": ["windows", "cells"] if k.startswith("verdict_by") else ["cells"]} for k in files},
           "priority_top": top_list,
           "honesty": {"es": "Reanálisis con la versión ACTUAL de los datos: es un ensayo retrospectivo, no lo que se publicó "
                             "cada año. Las ventanas están anidadas: es la evolución de la evidencia, no pruebas independientes.",
                       "en": "Backtest on TODAY's data version, not what was published each year. Windows are nested: "
                             "this is the evolution of the evidence, not independent tests."}}
    (out / "timeline.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return {**d["stats"], "emergence_histogram": hist, "final_verdict": tl.verdict[-1], "out": str(out)}
