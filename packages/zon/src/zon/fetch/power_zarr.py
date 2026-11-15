"""NASA POWER Analysis-Ready Data on AWS (public S3, no account): the whole planet as Zarr v2, read chunk by chunk.

    store = PowerZarr()                                  # monthly, UTC, MERRA-2
    block = store.read_block("T2M", row=7, col=3)        # the full history of up to 30 x 30 cells
    cube = store.region_cube("T2M", (22.3, -107.2, 26.8, -102.5), 2001, 2024)   # same CubeData as the API path

One chunk = all months x 30 lat x 30 lon. Everything is read from the store's own metadata (.zmetadata): shapes,
codecs, axes, units. If NASA changes the layout or a codec we do not know, it fails with a clear message.
"""
from __future__ import annotations

import collections
import datetime as dt
import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..cache import CacheMiss, ContentCache
from ..codecs import decode_chunk
from ..cube_io import CubeData
from ..net.http import HTTPStatusError, PoliteHTTP, RateLimiter
from ..provenance import ProvenanceLog, RequestRecord, iso_utc
from .power import CITATION, LICENCE_NOTE, default_cache_dir

BUCKET_URL = "https://nasa-power.s3.us-west-2.amazonaws.com"
STORE = "merra2/temporal/power_merra2_monthly_temporal_lst.zarr"   # local solar time: identical to the API (verified)
STORE_UTC = "merra2/temporal/power_merra2_monthly_temporal_utc.zarr"
SOURCE = "nasa_power_zarr"
# MERRA-2 was produced in four streams; the first year of each later stream is a documented place where artefacts can
# appear (UCAR Climate Data Guide: breaks at 1990-91, 2000-01 and 2010-11, mostly deep soil; reanalyses.org: stream 100 =
# 1980-1991, 200 = 1992-2000, 300 = 2001-2010, 400 = 2011-). HORI only CHECKS whether flagged breaks pile up there.
KNOWN_BREAKS = {"years": [1992, 2001, 2011], "source": "MERRA-2 production streams (GMAO); see UCAR Climate Data Guide"}
META_TTL = 24 * 3600.0          # metadata can change when a month is added; chunks are content-hashed anyway


class ZarrError(Exception):
    pass


@dataclass
class Block:
    """One decoded chunk, trimmed to the real grid and to the months that have data."""
    var: str
    row: int
    col: int
    values: np.ndarray          # [T_valid, ny, nx] float32, lat ascending (as stored)
    lat: np.ndarray             # [ny] ascending
    lon: np.ndarray             # [nx] ascending
    months: list                # ["YYYY-MM", ...] of the T_valid months
    sha256: str


class PowerZarr:
    def __init__(self, cache_dir: str | Path | None = None, *, store: str = STORE, base_url: str = BUCKET_URL,
                 http: PoliteHTTP | None = None, offline: bool = False, workers: int = 8, min_interval: float = 0.1,
                 refresh: bool = False):
        self.url = f"{base_url.rstrip('/')}/{store}"
        self.cache = ContentCache(cache_dir or default_cache_dir(), None, offline)
        self.http = http or PoliteHTTP(limiter=RateLimiter(min_interval))
        self.workers = workers
        self.refresh = refresh          # Z3: a chunk spans all months, so a new month changes it: never trust the cache
        self.prov = ProvenanceLog()
        self._meta = None
        self._axes = None

    # -- bytes
    def _get(self, rel: str, ttl: float | None = None) -> tuple[bytes, str]:
        url = f"{self.url}/{rel}"
        entry = self.cache.get(SOURCE, url, ttl)
        if entry is not None:
            self.prov.add(RequestRecord(url, 200, entry.sha256, entry.fetched_at, True))
            return entry.body, entry.sha256
        if self.cache.offline:
            raise CacheMiss(url)
        try:
            res = self.http.get(url)
        except HTTPStatusError as e:
            raise ZarrError(f"POWER store answered HTTP {e.status} for {rel}: the bucket or layout may have changed") from e
        stored = self.cache.put(SOURCE, url, res.body, {"elapsed": res.elapsed, "attempts": res.attempts})
        self.prov.add(RequestRecord(url, res.status, stored.sha256, stored.fetched_at, False, res.elapsed, res.attempts))
        return res.body, stored.sha256

    # -- metadata
    @property
    def meta(self) -> dict:
        if self._meta is None:
            body, _ = self._get(".zmetadata", ttl=0.0 if self.refresh else META_TTL)
            try:
                self._meta = json.loads(body)["metadata"]
            except (ValueError, KeyError) as e:
                raise ZarrError("the store has no consolidated .zmetadata (layout changed?)") from e
        return self._meta

    def variables(self) -> list[str]:
        return sorted(k[:-len("/.zarray")] for k in self.meta if k.endswith("/.zarray")
                      and k.split("/")[0] not in ("time", "lat", "lon"))

    def zarray(self, var: str) -> dict:
        try:
            za = self.meta[f"{var}/.zarray"]
        except KeyError:
            raise ZarrError(f"variable {var!r} is not in the store") from None
        if za.get("zarr_format") != 2:
            raise ZarrError(f"{var}: only Zarr v2 is supported")
        return za

    def attrs(self, var: str) -> dict:
        """CF-like attributes NASA publishes per variable (units, definition, valid_min/max, cell_methods...)."""
        return dict(self.meta.get(f"{var}/.zattrs", {}))

    def _coord(self, name: str) -> np.ndarray:
        za = self.zarray(name)
        if [int(c) for c in za["chunks"]] != [int(s) for s in za["shape"]]:
            raise ZarrError(f"coordinate {name} is chunked; not supported")
        body, _ = self._get(f"{name}/0", ttl=0.0 if self.refresh else None)
        return decode_chunk(body, za)

    @property
    def axes(self) -> tuple[list[str], np.ndarray, np.ndarray]:
        """(months 'YYYY-MM', lat ascending, lon ascending), decoded from the store itself."""
        if self._axes is None:
            units = self.attrs("time").get("units", "")
            if not units.startswith("days since "):
                raise ZarrError(f"time units {units!r} not understood")
            t0 = dt.datetime.fromisoformat(units[len("days since "):].strip())
            days = self._coord("time")
            months = [(t0 + dt.timedelta(days=int(d))).strftime("%Y-%m") for d in days]
            if len(set(months)) != len(months):
                raise ZarrError("time axis is not one value per month")
            self._axes = (months, self._coord("lat").astype(float), self._coord("lon").astype(float))
        return self._axes

    def grid_step(self) -> tuple[float, float]:
        _, lat, lon = self.axes
        return float(lat[1] - lat[0]), float(lon[1] - lon[0])

    # -- chunks
    def chunk_index(self, lat: float, lon: float, var: str = "T2M") -> tuple[int, int]:
        _, la, lo = self.axes
        _, cy, cx = self.zarray(var)["chunks"]
        i = int(np.argmin(np.abs(la - lat)))
        j = int(np.argmin(np.abs(((lo - lon) + 180.0) % 360.0 - 180.0)))
        return i // cy, j // cx

    def n_chunks(self, var: str) -> tuple[int, int]:
        za = self.zarray(var)
        return math.ceil(za["shape"][1] / za["chunks"][1]), math.ceil(za["shape"][2] / za["chunks"][2])

    def read_block(self, var: str, row: int, col: int, *, keep_empty_months: bool = False) -> Block:
        za = self.zarray(var)
        if len(za["shape"]) != 3:
            raise ZarrError(f"{var}: expected (time, lat, lon)")
        body, sha = self._get(f"{var}/0.{row}.{col}", ttl=0.0 if self.refresh else None)
        arr = decode_chunk(body, za)
        months, lat, lon = self.axes
        _, cy, cx = za["chunks"]
        ys, xs = slice(row * cy, min((row + 1) * cy, len(lat))), slice(col * cx, min((col + 1) * cx, len(lon)))
        arr = arr[:, : ys.stop - ys.start, : xs.stop - xs.start]
        T = len(months)
        if keep_empty_months:
            t_end = T
        else:                                                    # months reserved for the future are all NaN
            has = np.isfinite(arr.reshape(arr.shape[0], -1)).any(axis=1)
            t_end = int(np.nonzero(has)[0][-1]) + 1 if has.any() else 0
        return Block(var, row, col, arr[:t_end], lat[ys], lon[xs], months[:t_end], sha)

    def read_blocks(self, var: str, coords: list[tuple[int, int]], progress=None) -> list[Block]:
        """Several chunks, in parallel through the shared polite limiter; returned in the order asked."""
        self.axes                                                # fetch metadata once, not per thread
        done = [0]

        def one(rc):
            b = self.read_block(var, *rc)
            done[0] += 1
            if progress:
                progress(done[0], len(coords))
            return b

        with ThreadPoolExecutor(max_workers=self.workers) as ex:
            return list(ex.map(one, coords))

    def iter_blocks(self, var: str, coords: list[tuple[int, int]], prefetch: int | None = None):
        """Yield blocks in order while at most `prefetch` are downloading/decoded ahead: RAM stays ~ prefetch x 2 MB."""
        self.axes
        window = prefetch or 2 * self.workers
        with ThreadPoolExecutor(max_workers=self.workers) as ex:
            pending = collections.deque()
            it = iter(coords)
            for rc in it:
                pending.append(ex.submit(self.read_block, var, *rc))
                if len(pending) >= window:
                    break
            while pending:
                blk = pending.popleft().result()
                nxt = next(it, None)
                if nxt is not None:
                    pending.append(ex.submit(self.read_block, var, *nxt))
                yield blk

    def grid_blocks(self, var: str, start: int, end: int, coords: list[tuple[int, int]] | None = None):
        """(y0, x0, values[T, ny, nx]) for hori.api.run_grid: rows north -> south, months start..end only.

        Returns (generator, lat north->south, lon, time axis). Missing months at the end of a block stay NaN.
        """
        months, lat, lon = self.axes
        want = [k for k, m in enumerate(months) if start <= int(m[:4]) <= end]
        if not want:
            raise ZarrError(f"no months between {start} and {end}")
        _, cy, cx = self.zarray(var)["chunks"]
        ny, nx = self.n_chunks(var)
        coords = coords or [(r, c) for r in range(ny) for c in range(nx)]
        nlat = len(lat)

        def gen():
            for b in self.iter_blocks(var, coords):
                v = np.full((len(want),) + b.values.shape[1:], np.nan, dtype="float32")
                ok = [k for k in want if k < b.values.shape[0]]
                v[: len(ok)] = b.values[ok]
                y_top = nlat - (b.row * cy + b.values.shape[1])           # first north->south row of this block
                yield y_top, b.col * cx, v[:, ::-1, :]

        return gen(), lat[::-1].copy(), lon.copy(), [f"{months[k]}-01" for k in want]

    def sample_values(self, var: str, start: int, end: int, k: int = 12, cells_per_block: int = 64) -> np.ndarray:
        """[T, k * cells_per_block] monthly values from k chunks spread over all latitudes and longitudes
        (deterministic), for profile inference: one chunk is one region, not the variable."""
        months, _, _ = self.axes
        want = [i for i, m in enumerate(months) if start <= int(m[:4]) <= end]
        ny, nx = self.n_chunks(var)
        picks = [(int(round(r)), int(round(c))) for r, c in zip(np.linspace(1, ny - 2, k), np.linspace(0, nx - 1, k)[::-1])]
        out = []
        rng = np.random.default_rng(247)
        for b in self.iter_blocks(var, sorted(set(picks))):
            v = np.full((len(want),) + b.values.shape[1:], np.nan, dtype="float32")
            ok = [i for i in want if i < b.values.shape[0]]
            v[: len(ok)] = b.values[ok]
            flat = v.reshape(len(want), -1)
            out.append(flat[:, rng.choice(flat.shape[1], min(cells_per_block, flat.shape[1]), replace=False)])
        return np.concatenate(out, axis=1)

    def latest_month(self, var: str = "T2M", probe: tuple[float, float] = (24.5, -104.375)) -> str:
        """Last month with data, read from a real chunk (the time axis already includes future months)."""
        return self.read_block(var, *self.chunk_index(*probe, var=var)).months[-1]

    # -- cubes (ZON -> HORI), same shape as the API path
    def region_cube(self, var: str, bbox: tuple[float, float, float, float], start: int, end: int) -> CubeData:
        """bbox = (south, west, north, east); cells whose centers fall inside. Lat is flipped to north -> south (CUBE.md)."""
        s, w, n, e = bbox
        months, lat, lon = self.axes
        dlat, dlon = self.grid_step()
        iy = np.nonzero((lat >= s - 1e-9) & (lat <= n + 1e-9))[0]
        ix = np.nonzero((lon >= w - 1e-9) & (lon <= e + 1e-9))[0]
        if iy.size == 0 or ix.size == 0:
            raise ZarrError("the bounding box contains no grid-cell centers (antimeridian boxes not supported yet)")
        _, cy, cx = self.zarray(var)["chunks"]
        coords = sorted({(int(a) // cy, int(b) // cx) for a in iy for b in ix})
        blocks = {(b.row, b.col): b for b in self.read_blocks(var, coords)}
        want = [m for m in months if start <= int(m[:4]) <= end]
        if not want:
            raise ZarrError(f"no months between {start} and {end}")
        tpos = {m: k for k, m in enumerate(months)}
        vals = np.full((len(want), iy.size, ix.size), np.nan, dtype="float32")
        for yy, a in enumerate(iy):
            for xx, b in enumerate(ix):
                blk = blocks[(int(a) // cy, int(b) // cx)]
                t = [tpos[m] for m in want if tpos[m] < len(blk.months)]
                vals[: len(t), yy, xx] = blk.values[t, int(a) - blk.row * cy, int(b) - blk.col * cx]
        vals, lat_out = vals[:, ::-1, :].copy(), lat[iy][::-1]
        at = self.attrs(var)
        accessed = iso_utc()
        meta = {
            "id": f"powerzarr_{var}_monthly_{start}-{end}", "profile": "earth",
            "variable": {"name": var, "unit": at.get("units", ""), "long_name": at.get("long_name", ""),
                         "definition": at.get("definition", ""), "valid_min": at.get("valid_min"),
                         "valid_max": at.get("valid_max"), "cell_methods": at.get("cell_methods", "")},
            "dataset": {"name": "NASA POWER ARD (MERRA-2), Zarr on AWS", "provider": "NASA Langley Research Center POWER Project",
                        "version": self.meta.get(".zattrs", {}).get("comment", ""), "doi": None, "url": self.url,
                        "sha256": hashlib.sha256("".join(sorted(blocks[c].sha256 for c in coords)).encode()).hexdigest(), "licence": LICENCE_NOTE,
                        "kind": "reanalysis", "time_standard": "UTC" if self.url.endswith("_utc.zarr") else "LST",
                        "known_breaks": KNOWN_BREAKS},
            "native_resolution_deg": abs(dlat), "native_resolution_lon_deg": abs(dlon), "grid_source": "zarr-store",
            "aggregation": {"level": "monthly", "note": "monthly means as published; aggregate in HORI"},
            "window": {"start": str(start), "end": str(end), "step": "monthly", "last_month": want[-1] if want else None},
            "chunks": [list(c) for c in coords], "notes": [], "accessed_at": accessed,
            "citation": CITATION.format(date=accessed[:10]), "provenance": self.prov.summary(),
        }
        time_axis = [f"{m}-01" for m in want]
        return CubeData(vals, np.isfinite(vals), time_axis, lat_out, lon[ix].copy(), meta)
