"""NASA POWER connector (MERRA-2 meteorology, no account needed): https://power.larc.nasa.gov/docs/services/api/

What makes it more than a wrapper:
  * polite by design: adaptive rate limiting, retries with backoff + jitter, honours Retry-After;
  * never repeats a request: content-addressed cache with integrity checks and an offline mode;
  * dedupes by grid cell: nearby points that fall in the same cell become ONE request (the docs warn against
    repeating the same location);
  * learns the real native grid: `probe_native_grid` infers cell size and alignment from the API itself;
  * validates every response (parameters, fill values, expected length) and records provenance + hashes;
  * builds cubes in the ZON -> HORI format (contract/CUBE.md) for any bounding box;
  * knows how fresh the data is: `latest_available`.
Stdlib + NumPy only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..cache import CacheMiss, ContentCache
from ..cube_io import CubeData
from ..net.http import HTTPStatusError, PoliteHTTP, RateLimiter
from ..provenance import ProvenanceLog, RequestRecord, iso_utc

BASE_URL = "https://power.larc.nasa.gov/api/temporal"
SOURCE = "nasa_power"
LICENCE_NOTE = "CC BY 4.0 per the AWS Open Data registry entry for NASA POWER; verify the API terms before publishing."
CITATION = "NASA Prediction of Worldwide Energy Resources (POWER) was accessed on {date} from https://registry.opendata.aws/nasa-power."
MAX_POINT_PARAMS = 20          # documented limit for point requests
LEVELS = ("monthly", "daily")


class PowerError(Exception):
    """The API answered, but not with usable data (bad parameter, missing field, bad request)."""


def default_cache_dir() -> Path:
    return Path(os.environ.get("ZON_CACHE_DIR", Path.cwd() / "data" / "cache"))


# ------------------------------------------------------------------ grid
@dataclass(frozen=True)
class GridSpec:
    """A regular lat/lon lattice. The default is the MERRA-2 grid; `probe_native_grid` can replace it with the measured one."""
    lat0: float = -90.0
    dlat: float = 0.5
    lon0: float = -180.0
    dlon: float = 0.625
    source: str = "assumed-merra2"

    def snap(self, lat: float, lon: float) -> tuple[float, float]:
        la = self.lat0 + self.dlat * round((lat - self.lat0) / self.dlat)
        lo = self.lon0 + self.dlon * round((lon - self.lon0) / self.dlon)
        return round(la, 4), round(lo, 4)

    def axes(self, south: float, west: float, north: float, east: float) -> tuple[list[float], list[float]]:
        """Cell centers inside the box: latitudes north->south, longitudes west->east."""
        i0, i1 = math.ceil((south - self.lat0) / self.dlat - 1e-9), math.floor((north - self.lat0) / self.dlat + 1e-9)
        j0, j1 = math.ceil((west - self.lon0) / self.dlon - 1e-9), math.floor((east - self.lon0) / self.dlon + 1e-9)
        lats = [round(self.lat0 + self.dlat * i, 4) for i in range(i0, i1 + 1)][::-1]
        lons = [round(self.lon0 + self.dlon * j, 4) for j in range(j0, j1 + 1)]
        return lats, lons


@dataclass
class GridProbe:
    dlat: float | None
    dlon: float | None
    center_lat: float | None
    center_lon: float | None
    network_requests: int
    conclusion: str
    confident: bool

    def to_grid(self) -> GridSpec:
        if not self.confident:
            raise PowerError(f"probe is not conclusive: {self.conclusion}")
        dlat, dlon = _nominal(self.dlat), _nominal(self.dlon)
        lat0 = _anchor(self.center_lat, -90.0, dlat)
        lon0 = _anchor(self.center_lon, -180.0, dlon)
        return GridSpec(lat0, dlat, lon0, dlon, source="probed")


def _anchor(center: float, canonical_origin: float, step: float, tol: float = 0.03) -> float:
    """Prefer the standard lattice (anchored at -90 / -180) when the measured center agrees with it within `tol`."""
    canonical_center = canonical_origin + step * round((center - canonical_origin) / step)
    if abs(center - canonical_center) <= tol:
        return canonical_origin
    return round((center - canonical_origin) % step + canonical_origin, 4)


def _nominal(width: float, tol: float = 0.03) -> float:
    for c in (0.25, 0.3125, 0.5, 0.625, 1.0, 1.25, 2.0):      # common reanalysis / source grids
        if abs(width - c) <= tol:
            return c
    return round(width, 3)


# ------------------------------------------------------------------ parsed response
@dataclass
class PowerSeries:
    level: str
    lat: float
    lon: float
    elevation: float | None
    units: dict
    keys: list[str]
    values: dict            # param -> float array aligned to `keys` (NaN where POWER sent the fill value)
    header: dict
    url: str
    sha256: str
    fetched_at: float
    from_cache: bool
    warnings: list = field(default_factory=list)

    def monthly(self, param: str) -> tuple[list[int], np.ndarray, np.ndarray]:
        """(years, matrix [n_years, 12], POWER's own annual value per year). Key month 13 is POWER's annual mean."""
        if self.level != "monthly":
            raise PowerError("monthly() needs a monthly series")
        years = sorted({int(k[:4]) for k in self.keys})
        idx = {k: i for i, k in enumerate(self.keys)}
        mat = np.full((len(years), 12), np.nan)
        ann = np.full(len(years), np.nan)
        for yi, y in enumerate(years):
            for m in range(1, 13):
                i = idx.get(f"{y}{m:02d}")
                if i is not None:
                    mat[yi, m - 1] = self.values[param][i]
            i = idx.get(f"{y}13")
            if i is not None:
                ann[yi] = self.values[param][i]
        return years, mat, ann


def _fmt_day(d) -> str:
    if isinstance(d, (dt.date, dt.datetime)):
        return d.strftime("%Y%m%d")
    return str(d)


def parse_response(obj: dict, params: list[str], level: str, start, end, *, url: str, sha256: str,
                   fetched_at: float, from_cache: bool) -> PowerSeries:
    pr = (obj.get("properties") or {}).get("parameter")
    if not pr:
        raise PowerError(f"no data in response: {obj.get('messages') or obj}")
    missing = [p for p in params if p not in pr]
    if missing:
        raise PowerError(f"parameters missing in response: {missing}; messages={obj.get('messages')}")
    header = obj.get("header") or {}
    fill = float(header.get("fill_value", -999.0))
    keys = sorted(pr[params[0]].keys())
    warnings: list[str] = []
    values: dict = {}
    for p in params:
        raw = np.array([pr[p].get(k, fill) for k in keys], dtype=float)
        bad = (raw == fill) | ~np.isfinite(raw)
        if np.any((raw < -900) & ~bad):
            warnings.append(f"{p}: values below -900 that are not the declared fill value ({fill})")
        raw[bad] = np.nan
        values[p] = raw
        if bad.any():
            warnings.append(f"{p}: {int(bad.sum())} missing values (fill value {fill})")
    if level == "monthly":
        expected = (int(end) - int(start) + 1) * 13
    else:
        d0, d1 = dt.datetime.strptime(_fmt_day(start), "%Y%m%d"), dt.datetime.strptime(_fmt_day(end), "%Y%m%d")
        expected = (d1 - d0).days + 1
    if len(keys) != expected:
        warnings.append(f"expected {expected} time keys, got {len(keys)}")
    coords = (obj.get("geometry") or {}).get("coordinates") or [None, None, None]
    units = {p: (obj.get("parameters") or {}).get(p, {}) for p in params}
    return PowerSeries(level, float(coords[1]) if coords[1] is not None else float("nan"),
                       float(coords[0]) if coords[0] is not None else float("nan"),
                       coords[2] if len(coords) > 2 else None, units, keys, values, header, url, sha256,
                       fetched_at, from_cache, warnings)


# ------------------------------------------------------------------ client
class PowerClient:
    def __init__(self, cache_dir: str | Path | None = None, *, http: PoliteHTTP | None = None,
                 community: str = "AG", offline: bool = False, grid: GridSpec | None = None,
                 ttl_seconds: float | None = None, base_url: str = BASE_URL, min_interval: float = 1.0,
                 workers: int = 2, clock=time.time):
        self.cache = ContentCache(cache_dir or default_cache_dir(), ttl_seconds, offline, clock)
        self.http = http or PoliteHTTP(limiter=RateLimiter(min_interval))
        self.community, self.base_url, self.workers = community, base_url.rstrip("/"), workers
        self.grid = grid or GridSpec()
        self.prov = ProvenanceLog()
        self._clock = clock

    # -- requests
    def build_url(self, level: str, lat: float, lon: float, params: list[str], start, end) -> str:
        if level not in LEVELS:
            raise PowerError(f"level must be one of {LEVELS}")
        if not params or len(params) > MAX_POINT_PARAMS:
            raise PowerError(f"point requests take 1..{MAX_POINT_PARAMS} parameters")
        q = [("parameters", ",".join(sorted(params))), ("community", self.community), ("longitude", f"{lon:.4f}"),
             ("latitude", f"{lat:.4f}"), ("start", _fmt_day(start)), ("end", _fmt_day(end)), ("format", "JSON")]
        return f"{self.base_url}/{level}/point?" + urllib.parse.urlencode(q, safe=",")

    def _fetch(self, url: str, ttl: float | None = None):
        entry = self.cache.get(SOURCE, url, ttl)
        if entry is not None:
            self.prov.add(RequestRecord(url, 200, entry.sha256, entry.fetched_at, True))
            return entry.body, entry.sha256, entry.fetched_at, True
        if self.cache.offline:
            raise CacheMiss(url)
        try:
            res = self.http.get(url)
        except HTTPStatusError as e:
            try:
                msg = json.loads(e.body).get("messages")
            except ValueError:
                msg = e.body[:200]
            raise PowerError(f"POWER rejected the request (HTTP {e.status}): {msg}") from e
        stored = self.cache.put(SOURCE, url, res.body, {"elapsed": res.elapsed, "attempts": res.attempts})
        self.prov.add(RequestRecord(url, res.status, stored.sha256, stored.fetched_at, False, res.elapsed, res.attempts))
        return res.body, stored.sha256, stored.fetched_at, False

    def point(self, lat: float, lon: float, params: list[str], start, end, level: str = "monthly", *,
              snap: bool = True, ttl: float | None = None) -> PowerSeries:
        """One location. With snap=True the point is moved to its grid-cell center, so every location in the same cell is the SAME cached request."""
        qlat, qlon = self.grid.snap(lat, lon) if snap else (lat, lon)
        url = self.build_url(level, qlat, qlon, params, start, end)
        body, sha, fetched_at, cached = self._fetch(url, ttl)
        try:
            obj = json.loads(body)
        except ValueError as e:
            raise PowerError(f"response is not JSON: {body[:120]!r}") from e
        return parse_response(obj, sorted(params), level, start, end, url=url, sha256=sha, fetched_at=fetched_at, from_cache=cached)

    def point_many(self, cells: list[tuple[float, float]], params, start, end, level="monthly", *, progress=None):
        """Many cells, fetched with bounded concurrency through the shared rate limiter. Returns (results, failures)."""
        results, failures = {}, {}
        done = 0

        def one(cell):
            return cell, self.point(cell[0], cell[1], params, start, end, level)

        with ThreadPoolExecutor(max_workers=self.workers) as ex:
            futures = [(c, ex.submit(one, c)) for c in cells]
            for cell, fut in futures:
                try:
                    results[cell] = fut.result()[1]
                except (PowerError, CacheMiss, Exception) as e:           # keep going; report at the end
                    failures[cell] = f"{type(e).__name__}: {e}"
                done += 1
                if progress:
                    progress(done, len(cells))
        return results, failures

    # -- cubes (ZON -> HORI)
    def region_cube(self, bbox: tuple[float, float, float, float], params: list[str], start, end, level: str = "monthly", *,
                    max_cells: int = 400, max_fail_fraction: float = 0.05, progress=None) -> dict[str, CubeData]:
        """bbox = (south, west, north, east). One cube per parameter. Cells are the grid-cell centers inside the box."""
        lats, lons = self.grid.axes(*bbox)
        cells = [(la, lo) for la in lats for lo in lons]
        if not cells:
            raise PowerError("the bounding box contains no grid-cell centers")
        if len(cells) > max_cells:
            raise PowerError(f"{len(cells)} cells exceeds max_cells={max_cells}; narrow the box or raise the limit on purpose")
        results, failures = self.point_many(cells, params, start, end, level, progress=progress)
        if len(failures) > max_fail_fraction * len(cells):
            raise PowerError(f"{len(failures)}/{len(cells)} cells failed (> {max_fail_fraction:.0%}): {next(iter(failures.values()))}")
        first = next(iter(results.values()))
        if level == "monthly":
            years = sorted({int(k[:4]) for k in first.keys})
            time_axis = [f"{y}-{m:02d}-01" for y in years for m in range(1, 13)]
        else:
            time_axis = [f"{k[:4]}-{k[4:6]}-{k[6:]}" for k in first.keys]
        T, Y, X = len(time_axis), len(lats), len(lons)
        li, lj = {v: i for i, v in enumerate(lats)}, {v: j for j, v in enumerate(lons)}
        warnings = sorted({w for s in results.values() for w in s.warnings})
        accessed = iso_utc()
        header = first.header
        cubes: dict[str, CubeData] = {}
        for p in params:
            vals = np.full((T, Y, X), np.nan, dtype="float32")
            elev = np.full((Y, X), np.nan)
            for (la, lo), s in results.items():
                series = s.monthly(p)[1].reshape(-1) if level == "monthly" else s.values[p]
                vals[:, li[la], lj[lo]] = series
                if s.elevation is not None:
                    elev[li[la], lj[lo]] = s.elevation
            meta = {
                "id": f"power_{p}_{level}_{_fmt_day(start)}-{_fmt_day(end)}", "profile": "earth",
                "variable": {"name": p, "unit": first.units[p].get("units", ""), "long_name": first.units[p].get("longname", "")},
                "dataset": {"name": "NASA POWER (" + "/".join(header.get("sources", ["?"])) + ")",
                            "provider": "NASA Langley Research Center POWER Project", "version": (header.get("api") or {}).get("version"),
                            "doi": None, "url": self.base_url, "sha256": self.prov.combined_sha256(), "licence": LICENCE_NOTE,
                            "kind": "reanalysis" if header.get("sources") == ["MERRA2"] else "analysis"},
                "native_resolution_deg": self.grid.dlat, "native_resolution_lon_deg": self.grid.dlon, "grid_source": self.grid.source,
                "aggregation": {"level": level, "note": "monthly series exclude POWER's month-13 annual mean; aggregate in HORI"},
                "window": {"start": str(_fmt_day(start)), "end": str(_fmt_day(end)), "step": level},
                "cell_elevation_m": np.where(np.isfinite(elev), np.round(elev, 1), None).tolist(),
                "failed_cells": [list(c) for c in failures], "notes": warnings, "accessed_at": accessed,
                "citation": CITATION.format(date=accessed[:10]), "provenance": self.prov.summary(),
            }
            cubes[p] = CubeData(vals, np.isfinite(vals), time_axis, np.array(lats), np.array(lons), meta)
        return cubes

    # -- intelligence
    def probe_native_grid(self, lat: float, lon: float, param: str = "T2M", years=(2010, 2011),
                          tol: float = 0.01, max_offset: float = 1.0) -> GridProbe:
        """Infer the true cell size and alignment: find where the returned series stops being identical when the point moves.

        Binary search along each axis and direction. If values change at tiny offsets the API is interpolating (no plateaus)
        and the probe says so instead of guessing.
        """
        n0 = self.prov.summary()["from_network"]
        base = self.point(lat, lon, [param], years[0], years[1], "monthly", snap=False).values[param]

        def same(dlat, dlon):
            v = self.point(lat + dlat, lon + dlon, [param], years[0], years[1], "monthly", snap=False).values[param]
            return np.array_equal(v, base, equal_nan=True)

        def boundary(axis: int, sign: int):
            probe = (lambda o: same(sign * o, 0.0)) if axis == 0 else (lambda o: same(0.0, sign * o))
            if probe(max_offset):
                return None                                      # no change within the search range
            lo, hi = 0.0, max_offset
            while hi - lo > tol:
                mid = (lo + hi) / 2
                lo, hi = (mid, hi) if probe(mid) else (lo, mid)
            return (lo + hi) / 2

        out = {}
        for name, axis in (("lat", 0), ("lon", 1)):
            out[name] = (boundary(axis, +1), boundary(axis, -1))
        n_net = self.prov.summary()["from_network"] - n0
        if any(b is None for pair in out.values() for b in pair):
            return GridProbe(None, None, None, None, n_net, f"no change within ±{max_offset}°: cells wider than the search range", False)
        if any(b < 2 * tol for pair in out.values() for b in pair):
            return GridProbe(None, None, None, None, n_net, "values change at tiny offsets: no plateaus (interpolated or point-based)", False)
        dlat, dlon = out["lat"][0] + out["lat"][1], out["lon"][0] + out["lon"][1]
        clat, clon = lat + (out["lat"][0] - out["lat"][1]) / 2, lon + (out["lon"][0] - out["lon"][1]) / 2
        return GridProbe(round(dlat, 3), round(dlon, 3), round(clat, 4), round(clon, 4), n_net,
                         f"cell ≈ {dlat:.3f}° lat × {dlon:.3f}° lon; center ≈ ({clat:.3f}, {clon:.3f}); tolerance ±{tol}°", True)

    def latest_available(self, level: str = "monthly", param: str = "T2M", lat: float = 24.0, lon: float = -104.6,
                         ttl: float = 3600.0) -> str | None:
        """The most recent period with real data (the fill value marks 'not yet available'). Short cache so it stays fresh."""
        today = dt.date.today()
        if level == "monthly":
            s = self.point(lat, lon, [param], today.year - 1, today.year, "monthly", ttl=ttl)
            last = [k for k, v in zip(s.keys, s.values[param]) if np.isfinite(v) and not k.endswith("13")]
            return f"{last[-1][:4]}-{last[-1][4:6]}" if last else None
        s = self.point(lat, lon, [param], today - dt.timedelta(days=45), today, "daily", ttl=ttl)
        last = [k for k, v in zip(s.keys, s.values[param]) if np.isfinite(v)]
        return f"{last[-1][:4]}-{last[-1][4:6]}-{last[-1][6:]}" if last else None


# ------------------------------------------------------------------ CLI
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m zon.fetch.power", description="NASA POWER connector (no account needed)")
    ap.add_argument("--cache-dir")
    ap.add_argument("--offline", action="store_true", help="use only the cache")
    ap.add_argument("--min-interval", type=float, default=1.0, help="seconds between requests (be polite)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("point"); p.add_argument("--lat", type=float, required=True); p.add_argument("--lon", type=float, required=True)
    p.add_argument("--start", type=int, required=True); p.add_argument("--end", type=int, required=True)
    p.add_argument("--param", action="append"); p.add_argument("--level", default="monthly", choices=LEVELS)
    pr = sub.add_parser("probe"); pr.add_argument("--lat", type=float, default=24.02); pr.add_argument("--lon", type=float, default=-104.65)
    la = sub.add_parser("latest"); la.add_argument("--level", default="monthly", choices=LEVELS)
    c = sub.add_parser("cube"); c.add_argument("--bbox", type=float, nargs=4, metavar=("S", "W", "N", "E"), required=True)
    c.add_argument("--start", type=int, required=True); c.add_argument("--end", type=int, required=True)
    c.add_argument("--param", action="append"); c.add_argument("--level", default="monthly", choices=LEVELS)
    c.add_argument("--out", required=True, help="output folder; one .npz per parameter")
    c.add_argument("--probe-first", action="store_true", help="measure the native grid first and use it")
    args = ap.parse_args(argv)
    client = PowerClient(args.cache_dir, offline=args.offline, min_interval=args.min_interval)
    if args.cmd == "point":
        s = client.point(args.lat, args.lon, args.param or ["T2M", "PRECTOTCORR"], args.start, args.end, args.level)
        print(f"cell center ({client.grid.snap(args.lat, args.lon)}) elevation {s.elevation} m · source {s.header.get('sources')} · "
              f"API {s.header.get('api')} · {'cache' if s.from_cache else 'network'}")
        for p_, v in s.values.items():
            print(f"  {p_} [{s.units[p_].get('units')}]: {int(np.isfinite(v).sum())}/{len(v)} values, first {v[:3].round(2).tolist()}")
        for w in s.warnings:
            print("  warning:", w)
    elif args.cmd == "probe":
        r = client.probe_native_grid(args.lat, args.lon)
        print(r.conclusion, f"· {r.network_requests} network requests")
    elif args.cmd == "latest":
        print(client.latest_available(args.level))
    elif args.cmd == "cube":
        if args.probe_first:
            probe = client.probe_native_grid(sum(args.bbox[0::2]) / 2, sum(args.bbox[1::2]) / 2)
            print("probe:", probe.conclusion)
            if probe.confident:
                client.grid = probe.to_grid()
        cubes = client.region_cube(tuple(args.bbox), args.param or ["T2M", "PRECTOTCORR"], args.start, args.end, args.level,
                                   progress=lambda i, n: print(f"\r  {i}/{n} cells", end="", file=sys.stderr))
        print(file=sys.stderr)
        for name, cube in cubes.items():
            path = cube.write_npz(Path(args.out) / f"{cube.meta['id']}.npz")
            print(f"{name}: cube {cube.values.shape} → {path}  ({client.prov.summary()['from_network']} network requests)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
