"""NASA GISTEMP v4 (no login): monthly surface temperature anomalies on a 2-degree grid, 1880 -> today.

    g = Gistemp()                                    # downloads once (~26 MB), cached with sha256 + provenance
    cube = g.region_cube((22.3, -107.2, 26.8, -102.5), 1981, 2025)    # CubeData, lat north -> south (CUBE.md)

It is an independent check on POWER/MERRA-2: GISTEMP interpolates station and ship observations (GHCNv4 +
ERSSTv5, 1200 km smoothing), while MERRA-2 is a model-based reanalysis. Over the ocean GISTEMP is SEA SURFACE
temperature and POWER is air temperature at 2 m, so «global» comparisons mix two quantities; land comparisons
are the fair ones. Neighbouring GISTEMP cells are not independent (1200 km radius).
"""
from __future__ import annotations

import datetime as dt
import gzip
from pathlib import Path

import numpy as np

from ..cache import CacheMiss, ContentCache
from ..cube_io import CubeData
from ..net.http import PoliteHTTP, RateLimiter
from ..netcdf3 import read
from ..provenance import ProvenanceLog, RequestRecord, iso_utc
from .power import default_cache_dir

URL = "https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz"
SOURCE = "gistemp"
TTL = 7 * 24 * 3600.0                     # GISS updates monthly; a week-old copy is fine for trends
CITATION = ("GISTEMP Team, {year}: GISS Surface Temperature Analysis (GISTEMP), version 4. NASA Goddard Institute "
            "for Space Studies. Dataset accessed {date} at https://data.giss.nasa.gov/gistemp/. "
            "Lenssen, N., et al., 2019: Improvements in the GISTEMP uncertainty model. J. Geophys. Res. Atmos., 124.")


class Gistemp:
    def __init__(self, cache_dir: str | Path | None = None, *, url: str = URL, offline: bool = False,
                 http: PoliteHTTP | None = None, local_file: str | Path | None = None):
        self.url, self.local_file = url, local_file
        self.cache = ContentCache(cache_dir or default_cache_dir(), TTL, offline)
        self.http = http or PoliteHTTP(limiter=RateLimiter(1.0), timeout=300)
        self.prov = ProvenanceLog()
        self._ds = None
        self.sha256 = None

    def _bytes(self) -> bytes:
        if self.local_file:                                   # a copy downloaded by hand: hashed the same way
            body = Path(self.local_file).read_bytes()
            entry = self.cache.put(SOURCE, self.url, body, {"from_local_file": str(self.local_file)})
            self.prov.add(RequestRecord(self.url, 200, entry.sha256, entry.fetched_at, True))
            self.sha256 = entry.sha256
            return body
        entry = self.cache.get(SOURCE, self.url)
        if entry is None:
            if self.cache.offline:
                raise CacheMiss(self.url)
            res = self.http.get(self.url)
            entry = self.cache.put(SOURCE, self.url, res.body, {"elapsed": res.elapsed, "attempts": res.attempts})
            self.prov.add(RequestRecord(self.url, res.status, entry.sha256, entry.fetched_at, False, res.elapsed, res.attempts))
        else:
            self.prov.add(RequestRecord(self.url, 200, entry.sha256, entry.fetched_at, True))
        self.sha256 = entry.sha256
        return entry.body

    @property
    def ds(self):
        if self._ds is None:
            raw = self._bytes()
            self._ds = read(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)
        return self._ds

    def axes(self) -> tuple[list[str], np.ndarray, np.ndarray]:
        """(months 'YYYY-MM', lat ascending, lon ascending)."""
        units = self.ds.variables["time"].attrs.get("units", "")
        if not units.startswith("days since "):
            raise ValueError(f"GISTEMP time units {units!r} not understood")
        t0 = dt.datetime.fromisoformat(units[len("days since "):].strip())
        months = [(t0 + dt.timedelta(days=float(d))).strftime("%Y-%m") for d in self.ds.get("time")]
        return months, self.ds.get("lat"), self.ds.get("lon")

    def anomalies(self) -> np.ndarray:
        """[T, lat, lon] in K (= °C for anomalies), NaN where GISS has no estimate. Snapped to the 0.01 grid it was
        stored on (scale_factor is the float32 0.0099999998, so a plain multiply leaves 1e-9 noise)."""
        return np.round(self.ds.get("tempanomaly"), 2)

    def region_cube(self, bbox: tuple[float, float, float, float] | None, start: int, end: int) -> CubeData:
        """bbox = (south, west, north, east) on cell centers; None = the whole globe."""
        months, lat, lon = self.axes()
        keep = [k for k, m in enumerate(months) if start <= int(m[:4]) <= end]
        if bbox is None:
            iy, ix = np.arange(len(lat)), np.arange(len(lon))
        else:
            s, w, n, e = bbox
            iy = np.nonzero((lat >= s) & (lat <= n))[0]
            ix = np.nonzero((lon >= w) & (lon <= e))[0]
            if iy.size == 0 or ix.size == 0:                  # smaller than a 2-degree cell: the containing cell
                iy = np.array([int(np.argmin(np.abs(lat - (s + n) / 2)))])
                ix = np.array([int(np.argmin(np.abs(lon - (w + e) / 2)))])
        vals = self.anomalies()[np.ix_(keep, iy, ix)][:, ::-1, :].astype("float32")
        ds = self.ds
        tv = ds.variables["tempanomaly"]
        accessed = iso_utc()
        meta = {
            "id": f"gistemp_tempanomaly_monthly_{start}-{end}", "profile": "earth",
            "variable": {"name": "tempanomaly", "unit": tv.attrs.get("units", "K"),
                         "long_name": tv.attrs.get("long_name", ""), "cell_methods": tv.attrs.get("cell_methods", "")},
            "dataset": {"name": "GISTEMP v4 (GHCNv4 + ERSSTv5, 1200 km)", "provider": "NASA GISS", "url": self.url,
                        "version": ds.attrs.get("history", ""), "doi": None, "sha256": self.sha256,
                        "licence": "NASA open data (verify the GISS terms before publishing)", "kind": "analysis",
                        "base_period": "1951-1980"},
            "native_resolution_deg": 2.0, "native_resolution_lon_deg": 2.0, "grid_source": "netcdf",
            "aggregation": {"level": "monthly", "note": "monthly anomalies as published; aggregate in HORI"},
            "window": {"start": str(start), "end": str(end), "step": "monthly", "last_month": months[keep[-1]] if keep else None},
            "notes": ["GISTEMP smooths over 1200 km: neighbouring cells are not independent",
                      "over the ocean GISTEMP is sea-surface temperature, not 2 m air temperature"],
            "accessed_at": accessed, "citation": CITATION.format(year=accessed[:4], date=accessed[:10]),
            "provenance": self.prov.summary(),
        }
        return CubeData(vals, np.isfinite(vals), [f"{months[k]}-01" for k in keep], lat[iy][::-1].copy(), lon[ix].copy(), meta)
