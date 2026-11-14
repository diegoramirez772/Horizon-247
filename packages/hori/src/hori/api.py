"""Public, stable API of HORI. ZON and any other client must use ONLY this module.

    result = run_layer(Cube.from_npz("cube.npz"), Config())
    write_bundle(result, "bundles/earth/<id>")
"""
from __future__ import annotations

import json
import platform
import time
from pathlib import Path

import numpy as np

from . import __version__
from .aggregate import prepare, to_annual
from .config import Config
from .cube import Cube
from .detect import mde_per_decade, years_more
from .fdr import bh_adjust
from .result import LayerResult
from .stats import Z_CRIT, analyze, p_two
from .verdict import (CODES, FLAG_BITS, F_AUTOCORR_ALTA, F_COBERTURA_BAJA, F_DEPENDE_METODO, F_RECONSTRUCCION,
                      F_RESOLUCION_GRUESA, F_SIMULADO, decide)

__all__ = ["Config", "Cube", "LayerResult", "run_layer", "write_bundle"]
METHODS = ["MK-VC", "TFPW-WS", "OLS-AR1"]
CALIBRATION_NOTE = ("Measured by simulation (AR(1) Gaussian noise, n=23): false alarms 5.2% (phi=0.3) and 6.8% (phi=0.5); "
                    "power 92% / 78% at 2 sigma per decade. Illustrates, does not prove, behaviour on real data. See sim/.")


def run_layer(cube: Cube, config: Config | None = None) -> LayerResult:
    """cube -> findings per cell (effect, tests, FDR, MDE, verdict, flags). See docs/SPEC.md sections 2-5."""
    cfg = config or Config()
    annual, years, anomaly = to_annual(cube.values, cube.time, cfg.min_months)
    n = len(years)
    shape = annual.shape[1:]
    Z = annual.reshape(n, -1).T.astype(float)                       # [cells, n], row-major north->south, west->east
    cells = Z.shape[0]
    series, nvalid, usable, filled = prepare(Z, cfg.min_years, cfg.min_valid_fraction, cfg.max_interior_gap_years)

    nan = lambda: np.full(cells, np.nan)
    effect, ci_lo, ci_hi, sigma, r1, p_cons, mde, yrs, delta = (nan() for _ in range(9))
    nsig = np.zeros(cells, dtype=np.uint8)
    naive = np.zeros(cells, dtype=np.uint8)
    if usable.any():
        s = analyze(series[usable], cfg.tfpw_ws_iterations)
        pvc, pws, pols = p_two(s["z_vc"]), p_two(s["z_ws"]), p_two(s["z_ols"])
        effect[usable] = s["sen"] * 10.0
        half = Z_CRIT * s["se_ols"] * 10.0
        ci_lo[usable], ci_hi[usable] = effect[usable] - half, effect[usable] + half
        sigma[usable], r1[usable] = s["sigma"], s["r1"]
        p_cons[usable] = np.maximum.reduce([pvc, pws, pols])
        nsig[usable] = ((pvc <= cfg.alpha).astype(int) + (pws <= cfg.alpha) + (pols <= cfg.alpha)).astype(np.uint8)
        naive[usable] = (np.abs(s["z_naive"]) > Z_CRIT).astype(np.uint8)
        mde[usable] = mde_per_decade(s["sigma"], s["r1"], n)
        delta[usable] = cfg.delta_per_decade if cfg.delta_per_decade is not None else cfg.delta_sigma_per_decade * s["sigma"]
        yrs[usable] = years_more(mde[usable], delta[usable], n)
    q = bh_adjust(p_cons)
    with np.errstate(invalid="ignore"):
        verdict = decide(usable, q, nsig, mde, delta, cfg.fdr_q)

    flags = np.zeros(cells, dtype=np.uint8)
    flags[usable & ((nsig == 1) | (nsig == 2))] |= F_DEPENDE_METODO
    flags[filled] |= F_COBERTURA_BAJA
    flags[usable & (r1 > 0.5)] |= F_AUTOCORR_ALTA
    ds = cube.meta.get("dataset", {})
    if float(cube.meta.get("native_resolution_deg", 0) or 0) >= cfg.coarse_resolution_deg:
        flags[usable] |= F_RESOLUCION_GRUESA
    if ds.get("kind") == "reconstruction":
        flags[usable] |= F_RECONSTRUCCION
    if ds.get("kind") == "simulated":
        flags[usable] |= F_SIMULADO

    lat, lon = np.asarray(cube.lat, dtype=float), np.asarray(cube.lon, dtype=float)
    dlat = float(lat[1] - lat[0]) if len(lat) > 1 else -float(cube.meta.get("native_resolution_deg", 1.0))
    dlon = float(lon[1] - lon[0]) if len(lon) > 1 else float(cube.meta.get("native_resolution_lon_deg", 1.0))
    simulated = ds.get("kind") == "simulated"
    var = cube.meta.get("variable", {})
    summary = {"cells_valid": int(usable.sum()), "naive_marked": int(naive.sum()),
               **{CODES[c].lower(): int((verdict == c).sum()) for c in CODES}}
    manifest = {
        "contract": "0.1", "id": cube.meta.get("id", "layer"), "profile": cube.meta.get("profile", "earth"),
        "variable": {"name": var.get("name", ""), "unit": var.get("unit", ""), "unit_per_decade": f"{var.get('unit', '')}/década"},
        "entity": {"kind": "region_cell", "body": "earth", "count": cells, "valid": int(usable.sum())},
        "grid": {"type": "latlon", "nlat": int(shape[0]), "nlon": int(shape[1]), "lat0": float(lat[0]), "dlat": dlat,
                 "lon0": float(lon[0]), "dlon": dlon,
                 "native_resolution_deg": float(cube.meta.get("native_resolution_deg", abs(dlat)))},
        "dataset": ds,
        "window": {"start": years[0], "end": years[-1], "n": n, "step": "annual",
                   "aggregation": f"mean of monthly anomalies; >= {cfg.min_months}/12 months per year" if anomaly else "annual input"},
        "params": {"alpha": cfg.alpha, "fdr_q": cfg.fdr_q, "delta_sigma_per_decade": cfg.delta_sigma_per_decade,
                   "delta_per_decade": cfg.delta_per_decade, "min_valid_years": cfg.min_years},
        "methods": METHODS, "verdict_codes": {str(k): v for k, v in CODES.items()},
        "flag_bits": {str(k): v for k, v in FLAG_BITS.items()}, "summary": summary,
        "calibration": {"note": CALIBRATION_NOTE},
        "honesty": {"data_real": not simulated, "simulated": simulated,
                    "label_es": "Datos simulados" if simulated else f"Datos reales: {ds.get('name', 'NASA')}",
                    "label_en": "Simulated data" if simulated else f"Real data: {ds.get('name', 'NASA')}"},
        "warnings": list(cube.meta.get("notes", [])),
        "build": {"hori": __version__, "python": platform.python_version(), "numpy": np.__version__, "seed": cfg.seed,
                  "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
    }
    return LayerResult(effect, ci_lo, ci_hi, sigma, r1, p_cons, q, mde, yrs, verdict, flags,
                       nvalid.astype(np.uint8), nsig, naive, series, years, manifest)


def write_bundle(result: LayerResult, out_dir: str, title_es: str | None = None, title_en: str | None = None) -> Path:
    """Write manifest.json + binary arrays (little-endian) following contract/SPEC.md."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    arrays = {"effect": ("f32", result.effect), "ci_lo": ("f32", result.ci_lo), "ci_hi": ("f32", result.ci_hi),
              "sigma": ("f32", result.sigma), "r1": ("f32", result.r1), "p_cons": ("f32", result.p_cons),
              "q_cons": ("f32", result.q_cons), "mde": ("f32", result.mde), "years_more": ("f32", result.years_more),
              "verdict": ("u8", result.verdict), "flags": ("u8", result.flags), "nvalid": ("u8", result.nvalid),
              "nsig_methods": ("u8", result.nsig_methods), "naive_sig": ("u8", result.naive_sig)}
    listing = {}
    for name, (dt, arr) in arrays.items():
        fname = f"{name}.{dt}"
        np.asarray(arr).astype("<f4" if dt == "f32" else "u1").tofile(out / fname)
        listing[name] = {"file": fname, "dtype": dt}
    result.series.astype("<f4").tofile(out / "series.f32")
    m = dict(result.manifest)
    var = m["variable"]
    m["title"] = {"es": title_es or var["name"], "en": title_en or var["name"]}
    m["arrays"] = listing
    m["series"] = {"file": "series.f32", "dtype": "f32", "shape": ["cells", "n"], "years": result.years}
    (out / "manifest.json").write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
    return out
