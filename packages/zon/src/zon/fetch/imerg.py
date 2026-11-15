"""NASA GPM IMERG (satellite rain, monthly, V07) — the SECOND rain source, independent of MERRA-2 (POWER).

Granules are found with CMR, downloaded with an Earthdata token (environment variable EARTHDATA_TOKEN, never printed or
stored), read with h5py (HDF5; BSD licence, the only non-stdlib reader), reduced to a 1-degree grid and the granule is
deleted: a 25-year cube is ~80 MB instead of ~6 GB. Units: mm/day (IMERG stores mm/hr). Each granule's SHA-256 is kept.
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
SHORT_NAME, VERSION = "GPM_3IMERGM", "07"


def granule_urls(start: str, end: str) -> list[tuple[str, str]]:
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode({"short_name": SHORT_NAME, "version": VERSION, "temporal": f"{start},{end}",
                                    "page_size": 200, "page_num": page, "sort_key": "start_date"})
        with urllib.request.urlopen(f"{CMR}?{q}", timeout=60) as r:
            ents = json.loads(r.read())["feed"]["entry"]
        for g in ents:
            href = next((l["href"] for l in g["links"] if l.get("rel", "").endswith("/data#") and l["href"].endswith(".HDF5")), None)
            if href:
                out.append((g["time_start"][:7], href))
        if len(ents) < 200:
            return out
        page += 1


def read_granule(path: str | Path, deg: int = 1) -> np.ndarray:
    """-> [180/deg lat north->south, 360/deg lon] mm/day, mean of the 0.1-degree cells that have data."""
    import h5py
    with h5py.File(path, "r") as f:
        v = f["Grid/precipitation"][0].astype("float64")          # [lon 3600, lat 1800], mm/hr
    v[v < 0] = np.nan
    k = 10 * deg
    b = v.reshape(3600 // k, k, 1800 // k, k)
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            m = np.nanmean(b, axis=(1, 3)) * 24.0                 # [lon, lat] mm/day
    return m.T[::-1]                                              # [lat north->south, lon]


def build_cube(start: str, end: str, out_npz: str | Path, work: str | Path, *, deg: int = 1, progress=None) -> Path:
    token = os.environ.get("EARTHDATA_TOKEN")
    if not token:
        raise RuntimeError("EARTHDATA_TOKEN is not set")
    work, out_npz = Path(work), Path(out_npz)
    work.mkdir(parents=True, exist_ok=True)
    part = out_npz.with_suffix(".partial.json")
    done = json.loads(part.read_text()) if part.exists() else {}
    urls = granule_urls(start, end)
    for i, (month, href) in enumerate(urls, 1):
        if month in done:
            continue
        tmp = work / Path(href).name
        req = urllib.request.Request(href, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=600) as r:
            data = r.read()
        tmp.write_bytes(data)
        grid = read_granule(tmp, deg)
        np.save(work / f"{month}.npy", grid.astype("float32"))
        done[month] = {"url": href, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        tmp.unlink()
        part.write_text(json.dumps(done))
        if progress:
            progress(i, len(urls), month)
    months = sorted(done)
    cube = np.stack([np.load(work / f"{m}.npy") for m in months])
    lat = 90 - deg / 2 - deg * np.arange(180 // deg)
    lon = -180 + deg / 2 + deg * np.arange(360 // deg)
    meta = {"dataset": {"name": "NASA GPM IMERG Final Run monthly V07 (GPM_3IMERGM)", "kind": "satellite", "units": "mm/day",
                        "doi": "10.5067/GPM/IMERG/3B-MONTH/07", "licence": "NASA open data (EOSDIS)",
                        "regrid": f"{deg} degree mean of 0.1-degree cells", "granules": done}}
    np.savez(out_npz, rain=cube, months=np.array(months), lat=lat, lon=lon, meta=np.array(json.dumps(meta)))
    return out_npz
