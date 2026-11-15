"""«This month, where on the planet is it unusual?» — HORI's anomaly z for the LAST month of every cell, in parallel.

    python -m zon anomaly-map --param T2M --out data [--workers 2]
Reads the POWER Zarr chunks (cache or network), computes hori.api.z_last per chunk in separate processes, and writes a bundle
`earth/anomaly_<var>_<YYYY-MM>/` with z.f32 and point.u8 (|z| >= 3.5), rows north -> south like every global bundle.
Honesty in the manifest: with ~1.5 false alarms per 1000 per cell (gaussian noise; more with heavy tails), a planet of
207,936 cells shows ~300 «points» by chance alone, and neighbouring cells are correlated: read clusters, not single cells.
"""
from __future__ import annotations

import json
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from .fetch.power_zarr import PowerZarr


def _job(args):
    from hori.api import z_last
    y0, x0, vals, transform = args
    T, ny, nx = vals.shape
    return y0, x0, ny, nx, z_last(vals.reshape(T, ny * nx).astype(float), 12, transform=transform).astype("float32")


def anomaly_map(var: str, out_root, *, start: int = 1981, store: PowerZarr | None = None, workers: int = 2, z_alarm: float = 3.5,
                progress=None) -> dict:
    from hori.api import physical_class
    z = store or PowerZarr(offline=True)
    last = z.latest_month(var)
    end = int(last[:4])
    gen, lat, lon, months = z.grid_blocks(var, start, end)
    k = [m[:7] for m in months].index(last) + 1
    at = z.attrs(var)
    transform = "sqrt" if physical_class({"name": var, "unit": at.get("units", "")}) == "flujo_de_agua" else None
    Z = np.full((len(lat), len(lon)), np.nan, dtype="float32")
    t0, n = time.time(), 0
    with ProcessPoolExecutor(workers) as ex:
        futs = [ex.submit(_job, (y0, x0, vals[:k], transform)) for y0, x0, vals in gen]
        for f in futs:
            y0, x0, ny, nx, zz = f.result()
            Z[y0:y0 + ny, x0:x0 + nx] = zz.reshape(ny, nx)
            n += 1
            if progress:
                progress(n)
    el = time.time() - t0
    flat = Z.ravel()
    point = (np.abs(np.nan_to_num(flat)) >= z_alarm).astype("u1")
    w = np.repeat(np.cos(np.deg2rad(lat)), len(lon))
    ok = np.isfinite(flat)
    out = Path(out_root) / "bundles" / "earth" / f"anomaly_{var.lower()}_{last}"
    out.mkdir(parents=True, exist_ok=True)
    flat.astype("<f4").tofile(out / "z.f32")
    point.tofile(out / "point.u8")
    man = {"contract": "0.7", "kind": "anomaly_map", "id": f"anomaly_{var.lower()}_{last}", "profile": "earth",
           "variable": {"name": var, "unit": at.get("units", ""), "long_name": at.get("long_name", "")}, "month": last,
           "window": {"start": start, "end": end, "n": k},
           "grid": {"type": "latlon", "nlat": len(lat), "nlon": len(lon), "lat0": float(lat[0]), "dlat": float(lat[1] - lat[0]),
                    "lon0": float(lon[0]), "dlon": float(lon[1] - lon[0])},
           "params": {"z_alarm": z_alarm, "transform": transform, "method": "hori.anomaly.z_last (igual a detect para el último mes)"},
           "summary": {"cells": int(ok.sum()), "points": int(point.sum()), "area_share_points": round(float((w * point).sum() / w[ok].sum()), 5),
                       "area_share_high": round(float((w * (np.nan_to_num(flat) >= z_alarm)).sum() / w[ok].sum()), 5),
                       "area_share_low": round(float((w * (np.nan_to_num(flat) <= -z_alarm)).sum() / w[ok].sum()), 5),
                       "expected_by_chance_cells": int(round(0.0015 * ok.sum()))},
           "arrays": {"z": {"file": "z.f32", "dtype": "f32"}, "point": {"file": "point.u8", "dtype": "u8"}},
           "dataset": {"name": "NASA POWER ARD (MERRA-2), Zarr on AWS", "kind": "reanalysis", "url": z.url},
           "build": {"seconds": round(el, 1), "workers": workers},
           "honesty": {"es": "Desviación estadística del mes frente a los años previos de cada celda. Por azar se esperan ~0.15 % de "
                             "celdas marcadas, y las vecinas están correlacionadas: hay que leer manchas, no celdas sueltas. No es prueba "
                             "de daño ni de peligro.", "data_real": True}}
    (out / "manifest.json").write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"out": str(out), **man["summary"], "seconds": round(el, 1)}
