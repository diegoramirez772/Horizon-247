"""Public, stable API of HORI. ZON and any other client must use ONLY this module."""
from __future__ import annotations
import datetime as _dt
import json
import os
import platform
import numpy as np

from . import __version__
from .aggregate import monthly_to_annual, parse_year_month
from .config import Config
from .cube import Cube
from .engine import analyze, expanding_windows, region_series
from .result import LayerResult
from .verdict import F_RESOLUCION_GRUESA, F_SIMULADO, F_RECONSTRUCCION, FLAG_BITS, VERDICT_CODES, summary

__all__ = ["Cube", "Config", "LayerResult", "run_layer", "write_bundle", "load_config"]

METHODS = ["MK-VC", "TFPW-WS", "OLS-AR1"]

# Measured by the team's simulations (sim/, docs/SPEC.md section 5). Illustrates, does not prove with real data.
CALIBRATION = {
    "source": "sim/results_rule_search.txt, sim/results_mde_consensus.txt",
    "false_alarm_measured": {"n23_phi03": 0.052, "n23_phi05": 0.068, "n40_phi05": 0.056},
    "power_2sigma_decade": {"n23_phi03": 0.92, "n23_phi05": 0.78},
    "note": "simulación AR(1) gaussiano; ilustra, no prueba con datos reales",
}


def load_config(path: str | None = None) -> Config:
    """Read config/hori.yaml (or the given path); defaults if missing."""
    if path is None:
        path = os.path.join(os.path.dirname(__file__), "..", "..", "config", "hori.yaml")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return Config.from_yaml_text(f.read())
    return Config()


def _annual(cube: Cube, cfg: Config) -> tuple[np.ndarray, np.ndarray]:
    w = cube.meta.get("window", {})
    start, end = int(w["start"]), int(w["end"])
    years, _ = parse_year_month(cube.time)
    if len(np.unique(years)) == len(years):          # already one value per year
        keep = (years >= start) & (years <= end)
        vals = np.where(cube.valid, cube.values, np.nan)[keep].astype(np.float32)
        out = np.full((end - start + 1,) + vals.shape[1:], np.nan, np.float32)
        out[years[keep] - start] = vals
        return out, np.arange(start, end + 1)
    return monthly_to_annual(cube.values, cube.valid, cube.time, start, end, cfg.min_months_per_year)


def run_layer(cube: Cube, config: Config | None = None, regions: list | None = None) -> LayerResult:
    """cube -> findings (effect, tests, FDR, MDE, verdict, flags). See docs/SPEC.md sections 2-9.

    regions: optional list of {"id", "name": {"es","en"}, "bbox": [lonMin, latMin, lonMax, latMax], "source": {...}}.
    """
    cfg = config or Config()
    cube.check()
    meta = cube.meta
    kind = meta["dataset"]["kind"]
    base_flags = (F_SIMULADO if kind == "simulated" else 0) | (F_RECONSTRUCCION if kind == "reconstruction" else 0)

    annual, years = _annual(cube, cfg)                       # [n, Y, X]
    lat = np.asarray(cube.lat, float)
    lon = np.asarray(cube.lon, float)
    if cube.land_mask is not None:
        annual = np.where(cube.land_mask[None], annual, np.nan)
    # Contract: rows from north to south, columns from west to east.
    if lat.size > 1 and lat[0] < lat[-1]:
        annual, lat = annual[:, ::-1, :], lat[::-1]
    if lon.size > 1 and lon[0] > lon[-1]:
        annual, lon = annual[:, :, ::-1], lon[::-1]
    n, Y, X = annual.shape
    series = np.ascontiguousarray(annual.reshape(n, Y * X).T)   # [cells, n]

    res = analyze(series, cfg, base_flags)
    windows, emergence = ({}, None)
    if cfg.windows_expanding and n > max(cfg.windows_min_n, cfg.min_years):
        windows, emergence = expanding_windows(series, years, cfg, base_flags)

    lat_c = np.repeat(lat, X)
    lon_c = np.tile(lon, Y)
    region_entries = _regions(series, lat_c, lon_c, years, regions or [], cfg, base_flags, meta["id"])

    result = LayerResult(
        effect=res["effect"], ci_lo=res["ci_lo"], ci_hi=res["ci_hi"], sigma=res["sigma"], r1=res["r1"],
        p_cons=res["p_cons"], q_cons=res["q_cons"], mde=res["mde"], years_more=res["years_more"],
        verdict=res["verdict"], flags=res["flags"], nvalid=res["nvalid"], nsig_methods=res["nsig_methods"],
        naive_sig=res["naive_sig"], series=series, windows=windows, emergence_year=emergence,
        regions=region_entries,
    )
    result.manifest = _manifest(cube, cfg, lat, lon, years, result, res["_outside_table"])
    return result


def _regions(series, lat_c, lon_c, years, regions, cfg, base_flags, layer_id) -> list:
    if not regions:
        return []
    mats, ncells = [], []
    for r in regions:
        s, k = region_series(series, lat_c, lon_c, r["bbox"])
        mats.append(s)
        ncells.append(k)
    M = np.vstack(mats)
    res = analyze(M, cfg, base_flags)
    # FDR across the named regions (SPEC 8.2): analyze() runs BH over these rows only.
    q_regions = res["q_cons"]
    em = np.full(len(regions), np.nan)
    if cfg.windows_expanding and M.shape[1] > max(cfg.windows_min_n, cfg.min_years):
        _, em = expanding_windows(M, years, cfg, base_flags)
    out = []
    for i, r in enumerate(regions):
        flags = int(res["flags"][i]) | (F_RESOLUCION_GRUESA if ncells[i] < 4 else 0)
        ym = res["years_more"][i]
        entry = {
            "n_cells": ncells[i], "weights": "area (cos lat) × celdas válidas", "flags": flags,
            "series": [None if not np.isfinite(v) else round(float(v), 5) for v in M[i]],
            "effect": _num(res["effect"][i]), "ci": [_num(res["ci_lo"][i]), _num(res["ci_hi"][i])],
            "p_cons": _num(res["p_cons"][i]), "q_regions": _num(q_regions[i]),
            "verdict": int(res["verdict"][i]), "mde": _num(res["mde"][i]),
            "years_more": None if not np.isfinite(ym) else int(ym),
            "emergence_year": None if not np.isfinite(em[i]) else int(em[i]),
            "nsig_methods": int(res["nsig_methods"][i]), "sigma": _num(res["sigma"][i]),
        }
        out.append({"id": r["id"], "name": r["name"], "bbox": r.get("bbox"), "source": r.get("source"),
                    "layer": layer_id, "data": entry})
    return out


def _num(x):
    x = float(x)
    return None if not np.isfinite(x) else round(x, 6)


def _manifest(cube: Cube, cfg: Config, lat, lon, years, r: LayerResult, outside_table: bool) -> dict:
    meta = cube.meta
    ds = dict(meta["dataset"])
    var = dict(meta["variable"])
    unit = var.get("unit", "")
    var.setdefault("unit_per_decade", f"{unit}/década")
    kind = ds.get("kind", "")
    simulated = kind == "simulated"
    n = len(years)
    dlat = float(lat[1] - lat[0]) if len(lat) > 1 else -1.0
    dlon = float(lon[1] - lon[0]) if len(lon) > 1 else 1.0
    warnings = list(meta.get("notes", []))
    if outside_table:
        warnings.append(f"n = {n} está fuera de la tabla del factor MDE (15 a 40 años): se usó el borde de la tabla.")
    if simulated:
        warnings.insert(0, "Datos simulados: no es un resultado sobre datos reales.")
    honesty = meta.get("honesty") or {}
    provider = ds.get("provider", "")
    m = {
        "contract": "0.2" if r.windows else "0.1",
        "id": meta["id"],
        "profile": meta.get("profile", "earth"),
        "title": meta.get("title", {"es": meta["id"], "en": meta["id"]}),
        "variable": var,
        "entity": {"kind": "region_cell", "body": meta.get("profile", "earth"), "count": int(r.verdict.size),
                   "valid": int((r.verdict > 0).sum())},
        "grid": {"type": "latlon", "nlat": int(len(lat)), "nlon": int(len(lon)), "lat0": float(lat[0]), "dlat": dlat,
                 "lon0": float(lon[0]), "dlon": dlon,
                 "native_resolution_deg": float(meta.get("native_resolution_deg", abs(dlon))),
                 **({"effective_resolution_note": meta["effective_resolution_note"]} if meta.get("effective_resolution_note") else {})},
        "dataset": ds,
        "window": {"start": int(years[0]), "end": int(years[-1]), "n": n, "step": "annual",
                   "aggregation": f"media de anomalías mensuales; año válido con ≥{cfg.min_months_per_year}/12 meses"},
        "params": {"alpha": cfg.alpha, "fdr_q": cfg.fdr_q, "delta_sigma_per_decade": cfg.delta_sigma_per_decade,
                   "min_valid_years": max(cfg.min_years, int(np.ceil(cfg.min_valid_fraction * n)))},
        "methods": METHODS,
        "arrays": {
            "effect": {"file": "effect.f32", "dtype": "f32", "unit": "unit_per_decade"},
            "ci_lo": {"file": "ci_lo.f32", "dtype": "f32"}, "ci_hi": {"file": "ci_hi.f32", "dtype": "f32"},
            "sigma": {"file": "sigma.f32", "dtype": "f32", "note": "sd interanual de la serie sin tendencia"},
            "r1": {"file": "r1.f32", "dtype": "f32"},
            "p_cons": {"file": "p_cons.f32", "dtype": "f32", "note": "máx. de los p de los 3 métodos"},
            "q_cons": {"file": "q_cons.f32", "dtype": "f32", "note": "ajustado por FDR (Benjamini-Hochberg)"},
            "mde": {"file": "mde.f32", "dtype": "f32", "unit": "unit_per_decade"},
            "years_more": {"file": "years_more.f32", "dtype": "f32", "note": "años extra para poder descartar cambios ≥ δ; 255 = más de 60"},
            "verdict": {"file": "verdict.u8", "dtype": "u8"}, "flags": {"file": "flags.u8", "dtype": "u8"},
            "nvalid": {"file": "nvalid.u8", "dtype": "u8"},
            "nsig_methods": {"file": "nsig_methods.u8", "dtype": "u8", "note": "cuántos de los 3 métodos son significativos al α sin corregir"},
            "naive_sig": {"file": "naive_sig.u8", "dtype": "u8", "note": "1 si el MK ingenuo (sin correcciones) marcaría la celda"},
        },
        "series": {"file": "series.f32", "dtype": "f32", "shape": ["cells", "n"], "years": [int(y) for y in years]},
        "verdict_codes": VERDICT_CODES,
        "flag_bits": FLAG_BITS,
        "summary": summary(r.verdict, r.naive_sig),
        "calibration": CALIBRATION,
        "honesty": {
            "data_real": not simulated,
            "simulated": simulated,
            "label_es": honesty.get("label_es") or ("Datos simulados" if simulated else f"Datos reales {provider}".strip()),
            "label_en": honesty.get("label_en") or ("Simulated data" if simulated else f"Real {provider} data".strip()),
        },
        "warnings": warnings,
        "build": {"hori": __version__, "python": platform.python_version(), "numpy": np.__version__,
                  "seed": cfg.seed, "created_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "input_sha256": ds.get("sha256", ""), "params": cfg.to_dict()},
    }
    if r.windows:
        ends = sorted(r.windows)
        m["windows"] = {"mode": "expanding", "start": int(years[0]), "ends": ends,
                        "min_n": max(cfg.windows_min_n, cfg.min_years)}
        m["arrays"]["emergence_year"] = {"file": "emergence_year.f32", "dtype": "f32",
                                         "note": "primer año de fin desde el cual la celda es PROBADO y se mantiene; NaN si nunca"}
    return m


def _write(path: str, a: np.ndarray, dtype: str) -> None:
    arr = np.ascontiguousarray(a, dtype="<f4" if dtype == "f32" else np.uint8)
    with open(path, "wb") as f:
        f.write(arr.tobytes())


def write_bundle(result: LayerResult, out_dir: str) -> None:
    """Write manifest.json + binary arrays following contract/SPEC.md (little-endian, row-major north->south)."""
    os.makedirs(out_dir, exist_ok=True)
    spec = result.manifest["arrays"]
    for name in LayerResult.ARRAY_NAMES:
        _write(os.path.join(out_dir, spec[name]["file"]), getattr(result, name), spec[name]["dtype"])
    _write(os.path.join(out_dir, "series.f32"), result.series, "f32")
    if result.windows:
        for end, arrs in result.windows.items():
            wd = os.path.join(out_dir, "windows", str(end))
            os.makedirs(wd, exist_ok=True)
            for k in ("verdict", "flags"):
                _write(os.path.join(wd, f"{k}.u8"), arrs[k], "u8")
            for k in ("effect", "q_cons", "mde", "years_more"):
                _write(os.path.join(wd, f"{k}.f32"), arrs[k], "f32")
        _write(os.path.join(out_dir, "emergence_year.f32"), result.emergence_year, "f32")
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(result.manifest, f, ensure_ascii=False, indent=2)

