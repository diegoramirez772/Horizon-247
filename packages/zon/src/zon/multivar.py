"""Several NASA variables on ONE grid and ONE window -> one HORI layer each + the joint-change bundle.

    python -m zon multivar --window 2001 2025 --vars T2M PRECTOTCORR NDVI AOD SNOW_COVER --root data

Every variable is brought to the same 1-degree grid (box mean, cos-latitude weights for the POWER grid; Earthdata
cubes are already 1 degree) and the same complete years, so the rules of hori.joint compare like with like. Each
variable keeps its own source, kind (satellite / reanalysis) and delta in the manifest; nothing is mixed silently.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .build import update_index

EARTHDATA = {  # variable -> cube file pattern under <root>/earthdata (written by `zon earthdata cube` / sim/seaice_fetch.py)
    "NDVI": "ndvi/earthdata_ndvi_*.npz", "SOIL_MOISTURE": "soil_moisture/earthdata_soil_moisture_*.npz",
    "AOD": "aod/earthdata_aod_*.npz", "SNOW_COVER": "snow_cover/earthdata_snow_cover_*.npz",
    "SEA_ICE": "sea_ice/earthdata_sea_ice_*.npz"}
POWER = {"T2M": "planet/t2m_annual_1981-2025.npz", "PRECTOTCORR": "planet/prectotcorr_annual_1981-2025.npz"}


def _axes(deg: float = 1.0):
    ny, nx = int(180 / deg), int(360 / deg)
    return 90 - deg / 2 - deg * np.arange(ny), -180 + deg / 2 + deg * np.arange(nx)


def power_annual_1deg(path: str | Path, start: int, end: int):
    """POWER annual planet (0.5 x 0.625) -> annual cube on 1 degree boxes (cos-latitude weighted mean)."""
    from hori.api import Cube
    z = np.load(path, allow_pickle=False)
    years = z["years"].tolist()
    sel = [years.index(y) for y in range(start, end + 1)]
    ann, plat, plon = z["annual"][sel], z["lat"], z["lon"]
    meta = json.loads(str(z["meta"]))
    lat, lon = _axes()
    iy = np.clip(((90.0 - plat) // 1).astype(int), 0, 179)
    ix = np.clip(((plon + 180.0) // 1).astype(int), 0, 359)
    w = np.cos(np.deg2rad(plat))
    s = np.zeros((len(sel), 180, 360))
    c = np.zeros((len(sel), 180, 360))
    for r in range(len(plat)):
        v = ann[:, r, :]
        ok = np.isfinite(v)
        np.add.at(s[:, iy[r]], (slice(None), ix), np.where(ok, v, 0) * w[r])
        np.add.at(c[:, iy[r]], (slice(None), ix), ok * w[r])
    vals = np.where(c > 0, s / np.where(c > 0, c, 1), np.nan).astype("float32")
    meta = {**meta, "native_resolution_deg": 1.0,
            "notes": list(meta.get("notes", [])) + ["POWER 0.5 x 0.625 degrees averaged into 1 degree boxes (cos-latitude weights)."]}
    time = np.array([f"{y}-01-01" for y in range(start, end + 1)])
    return Cube(vals, np.isfinite(vals), time, lat, lon, meta)


def earthdata_cube(path: str | Path, start: int, end: int):
    """Monthly Earthdata cube -> the months of [start, end] (HORI makes the annual means itself)."""
    from hori.api import Cube
    z = np.load(path, allow_pickle=False)
    t = z["time"]
    keep = np.array([start <= int(s[:4]) <= end for s in t])
    v = z["values"][keep]
    return Cube(v, np.isfinite(v), t[keep], z["lat"], z["lon"], json.loads(str(z["meta"])))


def load(var: str, root: Path, start: int, end: int):
    if var in POWER:
        return power_annual_1deg(root / POWER[var], start, end)
    hits = sorted((root / "earthdata").glob(EARTHDATA[var]))
    if not hits:
        raise FileNotFoundError(f"no cube for {var} under {root / 'earthdata'} (run `zon earthdata cube` first)")
    return earthdata_cube(hits[-1], start, end)


def build_layer(var: str, root: Path, start: int, end: int, bundles: Path, *, tag: str = "1deg"):
    from hori.api import run_layer, write_bundle
    cube = load(var, root, start, end)
    res = run_layer(cube, profile="auto")
    rel = f"earth/{var.lower()}_{tag}_{start}-{end}"
    b = write_bundle(res, bundles / rel)
    update_index(bundles, rel, json.loads((b / "manifest.json").read_text(encoding="utf-8")))
    return res, cube, rel


def build_joint(results: dict, cubes: dict, rels: dict, start: int, end: int, bundles: Path, top: int = 40) -> Path:
    """Run every rule of hori.joint whose two variables are here; write arrays + manifest (kind = joint)."""
    from hori.api import JOINT_LEVELS, JOINT_RULES, joint_explain, run_joint
    lat, lon = _axes()
    layers = {v: {"effect": r.effect, "p_cons": r.p_cons, "verdict": r.verdict} for v, r in results.items()}
    units = {v: c.meta.get("variable", {}).get("unit", "") for v, c in cubes.items()}
    out = run_joint(layers)
    rel = f"earth/joint_{start}-{end}"
    d = bundles / rel
    d.mkdir(parents=True, exist_ok=True)
    rules, arrays = [], {}
    for rule in JOINT_RULES:
        if rule.id not in out:
            continue
        o = out[rule.id]
        o["level"].astype("u1").tofile(d / f"level_{rule.id}.u8")
        o["q_joint"].astype("<f4").tofile(d / f"q_{rule.id}.f32")
        arrays[f"level_{rule.id}"] = {"file": f"level_{rule.id}.u8", "dtype": "u8", "codes": JOINT_LEVELS}
        arrays[f"q_{rule.id}"] = {"file": f"q_{rule.id}.f32", "dtype": "f32"}
        idx = np.where(o["level"] >= 3)[0]
        idx = idx[np.lexsort((-np.abs(results[rule.a].effect[idx]), o["q_joint"][idx], -o["level"][idx].astype(int)))][:top]
        examples = [{"cell": int(i), "lat": float(lat[i // 360]), "lon": float(lon[i % 360]),
                     "q_joint": round(float(o["q_joint"][i]), 5),
                     "effect": {rule.a: round(float(results[rule.a].effect[i]), 4), rule.b: round(float(results[rule.b].effect[i]), 4)},
                     "text": joint_explain(rule, int(i), o, layers[rule.a], layers[rule.b], units)} for i in idx]
        rules.append({**o["summary"], "examples": examples})
    variables = {}
    for v, r in results.items():
        m = r.manifest
        variables[v] = {"layer": rels[v], "unit": units[v], "dataset": m.get("dataset", {}).get("name") or cubes[v].meta.get("dataset", {}).get("name"),
                        "kind": cubes[v].meta.get("dataset", {}).get("kind"), "delta_per_decade": m.get("params", {}).get("delta_per_decade"),
                        "probado_cells": int((r.verdict == 1).sum())}
    manifest = {"contract": "0.4", "kind": "joint", "id": f"joint_{start}-{end}", "profile": "earth",
                "title": {"es": f"Cambio conjunto {start}–{end}", "en": f"Joint change {start}–{end}"},
                "variable": {"name": "JOINT", "unit": ""},
                "grid": {"type": "latlon", "nlat": 180, "nlon": 360, "lat0": 89.5, "dlat": -1.0, "lon0": -179.5, "dlon": 1.0},
                "window": {"start": start, "end": end, "n": end - start + 1, "step": "annual"},
                "variables": variables, "rules": rules, "levels": JOINT_LEVELS, "arrays": arrays,
                "method": {"p_joint": "max(p_a, p_b) / 2 when both effects have the rule's (pre-declared) sign: one-sided intersection-union test",
                           "fdr": "Benjamini-Hochberg q = 0.10 per rule over cells where both variables are usable",
                           "level_4": "CONJUNTO_PROBADO: q_joint <= 0.10 and both variables PROBADO in their own layer",
                           "level_3": "AMBAS_PROBADO: both PROBADO in their own layers; the joint claim over the map is not reached",
                           "calibration": "sim/results_joint_calibration.json"},
                "honesty": {"data_real": True, "not_causal": True,
                            "note": {"es": "Que dos cambios ocurran en el mismo lugar no prueba que uno cause el otro.",
                                     "en": "Two changes at the same place do not prove that one causes the other."}}}
    (d / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return d


def run(vars_: list[str], start: int, end: int, root: str | Path = "data", bundles: str | Path | None = None) -> dict:
    root = Path(root)
    bundles = Path(bundles) if bundles else root / "bundles"
    results, cubes, rels = {}, {}, {}
    for v in vars_:
        results[v], cubes[v], rels[v] = build_layer(v, root, start, end, bundles)
    j = build_joint(results, cubes, rels, start, end, bundles)
    doc = json.loads((j / "manifest.json").read_text(encoding="utf-8"))
    return {"layers": rels, "joint": str(j), "rules": [{k: r[k] for k in ("rule", "counts", "observed_both_probado", "expected_if_unrelated", "ratio", "min_q_joint")}
                                                        for r in doc["rules"]]}
