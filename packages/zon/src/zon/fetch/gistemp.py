"""NASA GISTEMP v4 (no login). https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz

Downloads (or reuses) the file, records sha256 / size / download time, and reads the monthly
temperature anomaly grid (2° x 2°, 1200 km smoothing) into a HORI cube.
Needs netCDF4 or h5py (pip install -e ".[netcdf]").
"""
from __future__ import annotations
import datetime as _dt
import gzip
import os
import shutil
import urllib.request

import numpy as np

from ..provenance import file_record, now_utc

URL = "https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz"
GZ_NAME = "gistemp1200_GHCNv4_ERSSTv5.nc.gz"

DATASET = {
    "name": "GISTEMP v4 (GHCNv4 + ERSSTv5, 1200 km)",
    "provider": "NASA GISS",
    "url": URL,
    "version": "v4",
    "doi": "",   # GISTEMP Team / Lenssen et al. 2019 (10.1029/2018JD029522); left empty until the team confirms
    "licence": "NASA open data",
    "kind": "analysis",
}


def fetch(data_dir: str, local_file: str | None = None, log=print) -> tuple[str, dict]:
    """Return (path to the uncompressed .nc, provenance). Uses local_file if given (a .nc or .nc.gz you
    downloaded yourself), otherwise downloads URL into data_dir (once)."""
    os.makedirs(data_dir, exist_ok=True)
    if local_file:
        src = os.path.abspath(local_file)
        prov = file_record(src)
        if src.endswith(".gz"):
            nc = os.path.join(data_dir, os.path.basename(src)[:-3])
            _gunzip(src, nc)
            return nc, prov
        return src, prov

    gz = os.path.join(data_dir, GZ_NAME)
    downloaded_at = None
    if not os.path.exists(gz):
        log(f"Descargando {URL}")
        tmp = gz + ".part"
        with urllib.request.urlopen(URL, timeout=120) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f, length=1 << 20)
        os.replace(tmp, gz)
        downloaded_at = now_utc()
    else:
        log(f"Usando archivo ya descargado: {gz}")
    prov = file_record(gz, downloaded_at)
    nc = gz[:-3]
    if not os.path.exists(nc) or os.path.getmtime(nc) < os.path.getmtime(gz):
        _gunzip(gz, nc)
    return nc, prov


def _gunzip(src: str, dst: str) -> None:
    with gzip.open(src, "rb") as fi, open(dst + ".part", "wb") as fo:
        shutil.copyfileobj(fi, fo, length=1 << 20)
    os.replace(dst + ".part", dst)


def read(nc_path: str, start: int, end: int) -> dict:
    """Read lat, lon, monthly times and tempanomaly for the years [start, end] only (low memory)."""
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
        values = v.get_slice("tempanomaly", int(keep[0]), int(keep[-1]) + 1)
        time = np.array([f"{dates[i].year}-{dates[i].month:02d}-15" for i in keep])
        last_month = f"{dates[keep[-1]].year}-{dates[keep[-1]].month:02d}"
        return {"lat": lat, "lon": lon, "time": time, "values": values.astype(np.float32), "last_month": last_month}
    finally:
        v.close()


def _origin(units: str) -> _dt.datetime:
    s = units.split("since", 1)[1].strip().split()[0]
    y, m, d = (int(x) for x in s.split("-"))
    return _dt.datetime(y, m, d)


class _NetCDF4:
    def __init__(self, path):
        import netCDF4  # type: ignore
        self.ds = netCDF4.Dataset(path)
        self.ds.set_auto_maskandscale(True)

    def get(self, name):
        return np.ma.filled(self.ds.variables[name][:], np.nan)

    def get_slice(self, name, a, b):
        return np.ma.filled(self.ds.variables[name][a:b].astype(np.float32), np.nan)

    def attr(self, name, key):
        return getattr(self.ds.variables[name], key, None)

    def close(self):
        self.ds.close()


class _H5:
    """Fallback reader: netCDF-4 files are HDF5 underneath. Applies _FillValue, scale_factor, add_offset."""

    def __init__(self, path):
        import h5py  # type: ignore
        self.f = h5py.File(path, "r")

    def _fix(self, name, raw):
        var = self.f[name]
        out = raw.astype(np.float32)
        for key in ("_FillValue", "missing_value"):
            fill = var.attrs.get(key)
            if fill is not None:
                out[raw == np.asarray(fill).ravel()[0]] = np.nan
        scale = var.attrs.get("scale_factor")
        offset = var.attrs.get("add_offset")
        if scale is not None:
            out *= np.float32(np.asarray(scale).ravel()[0])
        if offset is not None:
            out += np.float32(np.asarray(offset).ravel()[0])
        return out

    def get(self, name):
        return self._fix(name, self.f[name][...])

    def get_slice(self, name, a, b):
        return self._fix(name, self.f[name][a:b])

    def attr(self, name, key):
        v = self.f[name].attrs.get(key)
        return v.decode() if isinstance(v, bytes) else (str(v) if v is not None else None)

    def close(self):
        self.f.close()


def _open(path):
    try:
        return _NetCDF4(path)
    except ImportError:
        pass
    try:
        return _H5(path)
    except ImportError:
        raise SystemExit("Falta un lector de netCDF. Instala uno:  pip install netCDF4   (o  pip install h5py)")
