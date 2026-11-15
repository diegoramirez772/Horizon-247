"""GPCP v2.3 monthly precipitation (no login). https://downloads.psl.noaa.gov/Datasets/gpcp/precip.mon.mean.nc

Global Precipitation Climatology Project, version 2.3 (Adler et al. 2018), 2.5° x 2.5°, 1979-present.
Merges satellite estimates (including NASA missions) with rain gauges. Served by NOAA PSL.
The file stores mm/day; ZON converts every month to an annualized rate (mm/day x 365.25 = mm/año),
so HORI's annual mean reads as millimetres per year.
Needs netCDF4 or h5py (pip install -e ".[netcdf]").
"""
from __future__ import annotations
import datetime as _dt
import os
import shutil
import urllib.request

import numpy as np

from ..provenance import file_record, now_utc
from .gistemp import _open, _origin

URL = "https://downloads.psl.noaa.gov/Datasets/gpcp/precip.mon.mean.nc"
FILE_NAME = "precip.mon.mean.nc"
DAYS_PER_YEAR = 365.25

DATASET = {
    "name": "GPCP v2.3 precipitación mensual (satélites + pluviómetros)",
    "provider": "GPCP (GEWEX); archivo servido por NOAA PSL",
    "url": URL,
    "version": "v2.3",
    "doi": "",   # Adler et al. 2018, Atmosphere 9(4):138; left empty until the team confirms
    "licence": "Sin restricciones de uso (NOAA PSL); citar GPCP / NOAA PSL",
    "kind": "analysis",
}


def fetch(data_dir: str, local_file: str | None = None, log=print) -> tuple[str, dict]:
    """Return (path to the .nc, provenance). Uses local_file if given, otherwise downloads URL once."""
    os.makedirs(data_dir, exist_ok=True)
    if local_file:
        src = os.path.abspath(local_file)
        return src, file_record(src)
    path = os.path.join(data_dir, FILE_NAME)
    downloaded_at = None
    if not os.path.exists(path):
        log(f"Descargando {URL}")
        tmp = path + ".part"
        with urllib.request.urlopen(URL, timeout=120) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f, length=1 << 20)
        os.replace(tmp, path)
        downloaded_at = now_utc()
    else:
        log(f"Usando archivo ya descargado: {path}")
    return path, file_record(path, downloaded_at)


def read(nc_path: str, start: int, end: int) -> dict:
    """lat, lon (-180..180, west to east), monthly times and precipitation in mm/año for [start, end]."""
    v = _open(nc_path)
    try:
        lat = np.asarray(v.get("lat"), float)
        lon = np.asarray(v.get("lon"), float)
        days = np.asarray(v.get("time"), float)
        origin = _origin(v.attr("time", "units") or "days since 1800-01-01 00:00:00")
        dates = [origin + _dt.timedelta(days=float(d)) for d in days]
        years = np.array([d.year for d in dates])
        keep = np.where((years >= start) & (years <= end))[0]
        if keep.size == 0:
            raise ValueError(f"El archivo no tiene meses entre {start} y {end}")
        values = v.get_slice("precip", int(keep[0]), int(keep[-1]) + 1).astype(np.float32)
    finally:
        v.close()
    values[~np.isfinite(values) | (np.abs(values) > 1e20) | (values < 0)] = np.nan   # missing = -9.96921e+36
    values *= np.float32(DAYS_PER_YEAR)
    # 0..360 -> -180..180, west to east
    lon = np.where(lon > 180, lon - 360, lon)
    order = np.argsort(lon)
    lon, values = lon[order], values[:, :, order]
    time = np.array([f"{dates[i].year}-{dates[i].month:02d}-15" for i in keep])
    last_month = f"{dates[keep[-1]].year}-{dates[keep[-1]].month:02d}"
    return {"lat": lat, "lon": lon, "time": time, "values": values, "last_month": last_month}
