"""Sea ice from NASA passive microwave (NSIDC-0051 v2, monthly, 25 km polar stereographic, 1978 -> today).

    ext, cube, evidence = build("data/earthdata/sea_ice", "1979-01-01", "2025-12-31")

Two products from the same files:
- **Extent** per hemisphere (km2 of cells with concentration >= 15 %, the NSIDC convention; the pole hole the satellite
  never sees counts as ice, as the Sea Ice Index does). Cell areas come from the projection (Snyder 1987, polar
  stereographic on the Hughes 1980 ellipsoid, true scale at 70 degrees), not from a nominal 625 km2.
- **Concentration** averaged into the same 1 degree global grid as the other Earthdata cubes (pole hole = missing).

The concentration variable is named after the sensor (N07_, F08_, F11_, F13_, F17_ICECON): the single *_ICECON
variable of each file is read. Files are ~70 KB, downloaded whole; the evidence keeps their SHA-256.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from .. import earthdata as ed

SHORT_NAME, VERSION = "NSIDC-0051", "2"
A, INV_F = 6378273.0, 298.279411123064        # Hughes 1980 ellipsoid (the file's crs)
CELL = 25000.0
GRIDS = {"N": {"shape": (448, 304), "x0": -3850000.0, "y0": 5850000.0, "lon0": -45.0, "sign": 1.0},
         "S": {"shape": (332, 316), "x0": -3950000.0, "y0": 4350000.0, "lon0": 0.0, "sign": -1.0}}
EXTENT_THRESHOLD = 0.15
CITATION = ("DiGirolamo, N., C. L. Parkinson, D. J. Cavalieri, P. Gloersen, H. J. Zwally (2022). Sea Ice Concentrations "
            "from Nimbus-7 SMMR and DMSP SSM/I-SSMIS Passive Microwave Data, Version 2. NASA NSIDC DAAC. "
            "https://doi.org/10.5067/MPYG15WAA4WX")


def lat_lon_area(hemi: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per-cell latitude, longitude (degrees) and true area (km2) of the 25 km grid (Snyder 1987, eqs. 21-34)."""
    g = GRIDS[hemi]
    ny, nx = g["shape"]
    x = g["x0"] + CELL * (np.arange(nx) + 0.5)
    y = g["y0"] - CELL * (np.arange(ny) + 0.5)
    X, Y = np.meshgrid(x, y)
    f = 1 / INV_F
    e = np.sqrt(2 * f - f * f)
    pc = np.deg2rad(70.0)
    tc = np.tan(np.pi / 4 - pc / 2) / ((1 - e * np.sin(pc)) / (1 + e * np.sin(pc))) ** (e / 2)
    mc = np.cos(pc) / np.sqrt(1 - e * e * np.sin(pc) ** 2)
    rho = np.hypot(X, Y)
    t = rho * tc / (A * mc)
    phi = np.pi / 2 - 2 * np.arctan(t)
    for _ in range(8):                                   # converges to < 1e-12 rad in ~5 iterations
        es = e * np.sin(phi)
        phi = np.pi / 2 - 2 * np.arctan(t * ((1 - es) / (1 + es)) ** (e / 2))
    m = np.cos(phi) / np.sqrt(1 - (e * np.sin(phi)) ** 2)
    k = rho / (A * m)                                    # scale factor; area of a projected square = CELL^2 / k^2
    area = (CELL / 1000.0) ** 2 / k ** 2
    s = g["sign"]
    if s > 0:
        lon = np.rad2deg(np.arctan2(X, -Y)) + g["lon0"]
    else:
        lon = np.rad2deg(np.arctan2(X, Y)) + g["lon0"]
    lon = (lon + 180.0) % 360.0 - 180.0
    return s * np.rad2deg(phi), lon, area


def read_file(body: bytes) -> tuple[np.ndarray, np.ndarray, str]:
    """-> (concentration 0..1 with NaN, pole-hole mask, variable name)."""
    import h5py
    with h5py.File(io.BytesIO(body), "r") as f:
        names = [k for k in f if k.endswith("_ICECON")]
        if len(names) != 1:
            raise ed.EarthdataError(f"expected one *_ICECON variable, found {names}")
        ds = f[names[0]]
        raw = np.squeeze(ds[()]).astype(np.int32)
        attrs = ed._attrs(ds)
    pole = raw == 251
    c = ed.decode(raw, attrs)                            # valid_range 0..250, scale 0.004; flags 251-254 -> NaN
    return c, pole, names[0]


def build(work: str | Path, start: str = "1979-01-01", end: str = "2025-12-31", *, workers: int = 4, progress=None):
    work = Path(work)
    (work / "granules").mkdir(parents=True, exist_ok=True)
    coll = ed.collection(SHORT_NAME, VERSION)
    gs = [g for g in ed.granules(SHORT_NAME, VERSION, start, end, names=["NSIDC0051_SEAICE_PS_?25km_??????_v2.0.nc"])
          if len(g.title.split("_")[4]) == 6]                                                           # monthly files
    part = work / "evidence.partial.json"
    done = json.loads(part.read_text()) if part.exists() else {}
    geo = {h: lat_lon_area(h) for h in GRIDS}

    def one(g):
        body, _, _ = ed.http_get(g.url)
        c, pole, var = read_file(body)
        hemi = g.title.split("_")[3][0]
        lat, lon, area = geo[hemi]
        if c.shape != lat.shape:
            raise ed.EarthdataError(f"{g.title}: shape {c.shape} != grid {lat.shape}")
        ext = float(area[(c >= EXTENT_THRESHOLD) | pole].sum())
        icearea = float((np.nan_to_num(c) * area).sum())
        grid, _ = ed.to_grid(c, lat, lon, 1.0)
        np.save(work / "granules" / f"{ed._safe(g.title)}.npy", grid.astype("float32"))
        return g, {"granule": g.title, "concept_id": g.id, "time_start": g.time_start, "url": g.url, "variable": var,
                   "hemisphere": hemi, "file_sha256": hashlib.sha256(body).hexdigest(), "array_sha256": ed.array_sha256(c),
                   "extent_km2": round(ext, 1), "area_km2": round(icearea, 1), "pole_hole_cells": int(pole.sum()),
                   "bytes_moved": len(body)}

    todo = [g for g in gs if g.title not in done]
    with ThreadPoolExecutor(workers) as ex:
        for i, (g, row) in enumerate(ex.map(one, todo), 1):
            done[g.title] = row
            if i % 20 == 0:
                part.write_text(json.dumps(done))
            if progress:
                progress(len(done), len(gs), g.time_start[:7])
    part.write_text(json.dumps(done))
    rows = [done[g.title] for g in gs]
    months = sorted({r["time_start"][:7] for r in rows})
    extent = {h: {m: None for m in months} for h in GRIDS}
    lat1, lon1 = ed.grid_axes(1.0)
    cube = np.full((len(months), len(lat1), len(lon1)), np.nan, dtype="float32")
    mi = {m: i for i, m in enumerate(months)}
    for r in rows:
        extent[r["hemisphere"]][r["time_start"][:7]] = r["extent_km2"]
        g = np.load(work / "granules" / f"{ed._safe(r['granule'])}.npy")
        i = mi[r["time_start"][:7]]
        cube[i] = np.where(np.isfinite(g), g, cube[i])
    evidence = {"evidence_version": 1, "collection": coll, "granules": rows, "citation": CITATION,
                "method": {"extent": f"sum of true cell areas with concentration >= {EXTENT_THRESHOLD}; pole hole counted as ice",
                           "area_source": "Snyder 1987 polar stereographic scale factor, Hughes 1980 ellipsoid, true scale 70 deg",
                           "grid": "1 degree mean of 25 km cells (pole hole = missing)"},
                "cube_sha256": ed.array_sha256(cube), "software": ed._software(),
                "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    from ..cube_io import CubeData
    meta = {"id": f"earthdata_sea_ice_{months[0][:4]}-{months[-1][:4]}", "profile": "earth", "body": "earth",
            "variable": {"name": "SEA_ICE", "unit": "1", "long_name": "Sea ice concentration (fraction)"},
            "dataset": {"name": f"{SHORT_NAME} v{VERSION} — {coll['title']}", "kind": "satellite", "doi": coll["doi"],
                        "concept_id": coll["concept_id"], "licence": "NASA EOSDIS data: no restrictions on use; cite the DOI",
                        "sha256": evidence["cube_sha256"]},
            "native_resolution_deg": 1.0, "notes": ["Pole hole (never seen by the satellite) is missing in the grid."]}
    cube_data = CubeData(cube, np.isfinite(cube), [f"{m}-01" for m in months], lat1, lon1, meta)
    return extent, cube_data, evidence
