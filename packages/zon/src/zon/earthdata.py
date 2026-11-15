"""NASA Earthdata, any mission: CMR -> granules -> only the variable you need -> monthly cube + reproducible evidence.

    r = Recipe(id="ndvi_mod13c2", short_name="MOD13C2", version="061", variable="/MOD_Grid.../CMG_0_05_Deg_Monthly_NDVI",
               access="opendap", ...)
    cube, evidence = build_cube(r, "data/earthdata/ndvi_mod13c2")      # resumable; one .npy per granule in the work dir
    reproduce(evidence, k=5)                                            # re-reads k granules and compares SHA-256

Three ways in, chosen per product (what NASA serves for it, measured 2026-11-15):
- `opendap`: Hyrax in Earthdata Cloud subsets on the server (variable + index range + stride) and answers NetCDF-4.
  It even turns HDF4 (MODIS) into NetCDF-4, so no HDF4 library is needed here.
- `range`: HTTP Range requests into a cloud HDF5/NetCDF-4 file; h5py reads only the chunks of the variable.
- `download`: the whole file (HDF5/NetCDF-4 via h5py, NetCDF classic via zon.netcdf3).
Zarr v2 stores are read with `ZarrStore` (zon.codecs; blosc, zlib, gzip).

Evidence: for every granule the URL actually used, the server-side constraint, and the SHA-256 of the DECODED array
(float32, little-endian, before regridding). Server responses carry timestamps, so hashing the bytes would not be
reproducible; hashing what was read is. `reproduce` re-reads and compares.

Token: environment variable EARTHDATA_TOKEN. It is sent only to NASA Earthdata hosts, never on a redirect to another host
(S3 pre-signed URLs reject it anyway), never written to evidence, logs or error messages.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from . import __version__

CMR = "https://cmr.earthdata.nasa.gov/search"
HYRAX = "https://opendap.earthdata.nasa.gov/collections/{concept}/granules/{granule}.dap.nc4"
TOKEN_ENV = "EARTHDATA_TOKEN"
TRUSTED = (".earthdata.nasa.gov", ".earthdatacloud.nasa.gov", ".gesdisc.eosdis.nasa.gov", "urs.earthdata.nasa.gov")
UA = f"HORIZON247-ZON/{__version__} (NASA Space Apps 2026; earthdata reader)"


class EarthdataError(Exception):
    pass


def _token(required: bool = True) -> str | None:
    t = os.environ.get(TOKEN_ENV)
    if required and not t:
        raise EarthdataError(f"{TOKEN_ENV} is not set (create a token at urs.earthdata.nasa.gov)")
    return t


def _redact(text: str) -> str:
    t = os.environ.get(TOKEN_ENV)
    return text.replace(t, "***") if t else text


def _trusted(url: str) -> bool:
    host = urllib.parse.urlsplit(url).hostname or ""
    return any(host == h.lstrip(".") or host.endswith(h) for h in TRUSTED)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def http_get(url: str, *, headers: dict | None = None, auth: bool = True, timeout: float = 300, retries: int = 6,
             max_redirects: int = 8) -> tuple[bytes, str, int]:
    """GET with manual redirects (the token is only attached on Earthdata hosts). -> (body, final_url, status)."""
    tok = _token(auth) if auth else None
    for attempt in range(retries + 1):
        cur = url
        try:
            for _ in range(max_redirects):
                h = {"User-Agent": UA, **(headers or {})}
                if tok and _trusted(cur):
                    h["Authorization"] = f"Bearer {tok}"
                try:
                    with _OPENER.open(urllib.request.Request(cur, headers=h), timeout=timeout) as r:
                        return r.read(), cur, r.status
                except urllib.error.HTTPError as e:
                    if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                        cur = urllib.parse.urljoin(cur, e.headers["Location"])
                        continue
                    if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                        raise TimeoutError(f"HTTP {e.code}")
                    body = e.read()[:300]
                    raise EarthdataError(_redact(f"HTTP {e.code} for {cur.split('?')[0]}: {body!r}")) from None
            raise EarthdataError("too many redirects")
        except (TimeoutError, urllib.error.URLError, ConnectionError, OSError) as e:
            if isinstance(e, EarthdataError) or attempt == retries:
                raise EarthdataError(_redact(f"network error for {url.split('?')[0]}: {e}")) from None
            time.sleep(min(60, 2 ** attempt * 3))
    raise EarthdataError("unreachable")


# ------------------------------------------------------------------ CMR (search, no token)
@dataclass
class Granule:
    id: str                     # CMR concept id
    title: str                  # GranuleUR: what Hyrax calls the granule
    time_start: str
    time_end: str
    url: str                    # data link (https)
    size_mb: float | None = None


def collection(short_name: str, version: str | None = None) -> dict:
    q = {"short_name": short_name, "page_size": 10}
    if version:
        q["version"] = version
    body, _, _ = http_get(f"{CMR}/collections.umm_json?{urllib.parse.urlencode(q)}", auth=False, timeout=60)
    items = json.loads(body).get("items", [])
    if not items:
        raise EarthdataError(f"no collection {short_name} {version or ''} in CMR")
    it = items[0]
    umm, meta = it["umm"], it["meta"]
    doi = (umm.get("DOI") or {}).get("DOI")
    return {"concept_id": meta["concept-id"], "provider": meta.get("provider-id"), "short_name": umm.get("ShortName"),
            "version": umm.get("Version"), "title": umm.get("EntryTitle"), "doi": doi,
            "processing_level": (umm.get("ProcessingLevel") or {}).get("Id"),
            "use_constraints": (umm.get("UseConstraints") or {}).get("Description")}


def granules(short_name: str, version: str | None, start: str, end: str, bbox: tuple | None = None,
             page_size: int = 500, names: list[str] | None = None) -> list[Granule]:
    """All granules in [start, end] (ISO dates), oldest first. bbox = (S, W, N, E). `names`: granule-name patterns
    with * and ? that CMR filters itself (measured: 1,510 granules of a daily product took 158 s to list)."""
    out, after = [], None
    while True:
        q = [("short_name", short_name), ("temporal", f"{start},{end}"), ("page_size", page_size), ("sort_key", "start_date")]
        if version:
            q.append(("version", version))
        if bbox:
            s, w, n, e = bbox
            q.append(("bounding_box", f"{w},{s},{e},{n}"))
        if names:
            q += [("readable_granule_name[]", n) for n in names] + [("options[readable_granule_name][pattern]", "true")]
        h = {"CMR-Search-After": after} if after else {}
        req = urllib.request.Request(f"{CMR}/granules.json?{urllib.parse.urlencode(q)}", headers={"User-Agent": UA, **h})
        for attempt in range(5):                          # CMR drops connections now and then (SSL EOF seen 11-15)
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    ents = json.loads(r.read())["feed"]["entry"]
                    after = r.headers.get("CMR-Search-After")
                break
            except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
                if attempt == 4:
                    raise
                time.sleep(5 * 2 ** attempt)
        for g in ents:
            href = next((l["href"] for l in g.get("links", []) if l.get("rel", "").endswith("/data#")
                         and l["href"].startswith("https://") and not l["href"].endswith((".xml", ".html", ".png", ".jpg"))), None)
            if href:
                out.append(Granule(g["id"], g["title"], g["time_start"], g.get("time_end") or g["time_start"], href,
                                   float(g["granule_size"]) if g.get("granule_size") else None))
        if len(ents) < page_size or not after:
            return out


# ------------------------------------------------------------------ readers
class RangeFile(io.RawIOBase):
    """Read-only file over HTTP Range requests with a block cache (for h5py.File(fileobj)). Counts the bytes it moved."""

    def __init__(self, url: str, block: int = 1 << 16):     # 64 KB: measured 1.7 MB moved per SMAP granule (1 MB: the whole 30 MB)
        super().__init__()
        self.block, self.pos, self.cache, self.bytes_moved, self.requests = block, 0, {}, 0, 0
        self.url = self._resolve(url)                       # follow the login redirect once (pre-signed URL ~1 h)
        self.size = self._size

    def _resolve(self, url: str) -> str:
        body, final, status = http_get(url, headers={"Range": "bytes=0-1023"})
        if status != 206:
            raise EarthdataError("the server ignored the Range header; use access='download'")
        self.bytes_moved += len(body)
        self.requests += 1
        self._size = None
        return final

    def _fetch(self, i: int) -> bytes:
        if i not in self.cache:
            a = i * self.block
            body, _, _ = http_get(self.url, headers={"Range": f"bytes={a}-{a + self.block - 1}"}, auth=_trusted(self.url))
            self.cache[i] = body
            self.bytes_moved += len(body)
            self.requests += 1
        return self.cache[i]

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        if whence == 2:
            if self.size is None:
                self._probe_size()
            self.pos = self.size + off
        else:
            self.pos = off if whence == 0 else self.pos + off
        return self.pos

    def _probe_size(self):
        req = urllib.request.Request(self.url, headers={"User-Agent": UA, "Range": "bytes=0-0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            cr = r.headers.get("Content-Range", "")
        self.size = int(cr.rsplit("/", 1)[1])

    def readinto(self, b):
        n, out, p = len(b), bytearray(), self.pos
        while len(out) < n:
            i, off = divmod(p, self.block)
            chunk = self._fetch(i)[off:off + n - len(out)]
            if not chunk:
                break
            out += chunk
            p += len(chunk)
        b[:len(out)] = out
        self.pos = p
        return len(out)


def _h5(obj):
    try:
        import h5py                                         # BSD; the only non-stdlib reader
    except ImportError as e:
        raise EarthdataError("HDF5 / NetCDF-4 needs h5py (pip install h5py)") from e
    return h5py.File(obj, "r")


def _attrs(ds) -> dict:
    out = {}
    for k, v in ds.attrs.items():
        if k in ("DIMENSION_LIST", "REFERENCE_LIST", "_Netcdf4Dimid", "_Netcdf4Coordinates"):
            continue
        if isinstance(v, bytes | np.bytes_):
            v = v.decode("utf-8", "replace")
        elif isinstance(v, np.ndarray):
            v = v.tolist() if v.size > 1 else v.reshape(-1)[0].item() if v.size else None
        elif isinstance(v, np.generic):
            v = v.item()
        out[k] = v
    return out


def read_vars(source, paths: list[str]) -> dict[str, tuple[np.ndarray, dict]]:
    """bytes (whole file / OPeNDAP answer) or a file-like -> {path: (raw array, attributes)}. Format from the magic."""
    if isinstance(source, bytes | bytearray):
        magic = bytes(source[:8])
        if magic.startswith(b"CDF"):
            from .netcdf3 import read as nc3
            ds = nc3(bytes(source))
            return {p: (ds.raw(p.strip("/")), dict(ds.variables[p.strip("/")].attrs)) for p in paths}
        if magic.startswith(b"\x0e\x03\x13\x01"):
            raise EarthdataError("HDF4 file: use access='opendap' (Hyrax converts it) or install pyhdf")
        source = io.BytesIO(source)
    with _h5(source) as f:
        out = {}
        for p in paths:
            key = p.strip("/")
            if key not in f:
                raise EarthdataError(f"variable {p!r} not in the file; it has: {sorted(_walk(f))[:30]}")
            ds = f[key]
            out[p] = (ds[()], _attrs(ds))
        return out


def _walk(f) -> list[str]:
    names = []
    f.visititems(lambda n, o: names.append(n) if hasattr(o, "shape") else None)
    return names


def decode(raw: np.ndarray, attrs: dict, scale: str = "cf") -> np.ndarray:
    """Raw stored values -> physical float64 with NaN for fill / out of valid range.

    scale="cf": x * scale_factor + add_offset (CF conventions). scale="divide": (x - add_offset) / scale_factor
    (the MODIS HDF4 convention, e.g. NDVI stored x10000 with scale_factor = 10000). The recipe states which one.
    """
    x = np.asarray(raw).astype(np.float64)
    bad = np.zeros(x.shape, bool)
    for k in ("_FillValue", "missing_value"):
        if attrs.get(k) is not None:
            for fv in np.atleast_1d(attrs[k]):
                bad |= x == float(fv)
    vr = attrs.get("valid_range")
    if vr is not None and np.size(vr) == 2:
        bad |= (x < float(vr[0])) | (x > float(vr[1]))
    for k, op in (("valid_min", np.less), ("valid_max", np.greater)):
        if attrs.get(k) is not None:
            bad |= op(x, float(np.atleast_1d(attrs[k])[0]))
    sf = float(np.atleast_1d(attrs.get("scale_factor", 1.0))[0])
    ao = float(np.atleast_1d(attrs.get("add_offset", 0.0))[0])
    x = (x - ao) / sf if scale == "divide" else x * sf + ao
    x[bad] = np.nan
    return x


def to_grid(values: np.ndarray, lat: np.ndarray, lon: np.ndarray, deg: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Mean of all finite samples in each deg x deg box. lat/lon are 1-D axes or 2-D per-pixel (any projection).
    -> (grid [180/deg, 360/deg] north -> south, west -> east; NaN where empty, count of samples)."""
    v = np.asarray(values, dtype=np.float64)
    la, lo = np.asarray(lat, dtype=np.float64), np.asarray(lon, dtype=np.float64)
    if la.ndim == 1 and lo.ndim == 1 and v.ndim == 2:
        la, lo = np.broadcast_to(la[:, None], v.shape), np.broadcast_to(lo[None, :], v.shape)
    ny, nx = int(round(180 / deg)), int(round(360 / deg))
    ok = np.isfinite(v) & np.isfinite(la) & np.isfinite(lo) & (np.abs(la) <= 90)
    lo_w = ((lo[ok] + 180.0) % 360.0)
    iy = np.clip(((90.0 - la[ok]) / deg).astype(int), 0, ny - 1)
    ix = np.clip((lo_w / deg).astype(int), 0, nx - 1)
    k = iy * nx + ix
    s = np.bincount(k, weights=v[ok], minlength=ny * nx)
    c = np.bincount(k, minlength=ny * nx)
    with np.errstate(invalid="ignore", divide="ignore"):
        g = np.where(c > 0, s / np.maximum(c, 1), np.nan)
    return g.reshape(ny, nx), c.reshape(ny, nx)


def grid_axes(deg: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    ny, nx = int(round(180 / deg)), int(round(360 / deg))
    return 90 - deg / 2 - deg * np.arange(ny), -180 + deg / 2 + deg * np.arange(nx)


def array_sha256(a: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(a, dtype="<f4").tobytes()).hexdigest()


# ------------------------------------------------------------------ recipes
@dataclass
class Recipe:
    """Everything needed to rebuild a monthly cube from NASA, written down (no hidden choice)."""
    id: str
    short_name: str
    version: str
    variable: str                       # path inside the file
    lat: str                            # path of the latitude (1-D axis or 2-D per pixel), or "axis:first,step,stride"
    lon: str                            # (regular grid: centre of the first cell, step, stride used in `slices`)
    access: str = "opendap"             # opendap | range | download
    slices: str = ""                    # OPeNDAP index constraint for the variable, e.g. "[0:4:3599][0:4:7199]"
    lat_slice: str = ""
    lon_slice: str = ""
    scale: str = "cf"                   # cf | divide (see decode)
    quality: dict | None = None         # {"path": ..., "rule": "bit0_clear"} -> keep only recommended-quality pixels
    start: str = "2001-01-01"
    end: str = "2025-12-31"
    days: list | None = None            # daily products: days of the month to sample (None = every granule)
    names: list | None = None           # granule-name patterns (* ?) applied by CMR
    fixed_coords: bool = False          # lat/lon identical in every granule (fixed grid): read once, as row/column axes
    deg: float = 1.0
    phys_min: float | None = None       # physically impossible values -> NaN (counted in the evidence)
    phys_max: float | None = None
    units: str = ""
    long_name: str = ""
    kind: str = "satellite"             # satellite | reanalysis | model
    licence: str = "NASA EOSDIS data: no restrictions on use; cite the DOI"
    notes: list = field(default_factory=list)

    def granule_paths(self, with_coords: bool = True) -> list[str]:
        return [self.variable] + [p for p in (self.lat, self.lon) if with_coords and not p.startswith("axis:")] + \
            ([self.quality["path"]] if self.quality else [])


def _axis(spec: str, n: int) -> np.ndarray:
    first, step, stride = (float(x) for x in spec[5:].split(","))
    return first + step * stride * np.arange(n)


def _month(t: str) -> str:
    return t[:7]


def select(recipe: Recipe, gs: list[Granule]) -> list[Granule]:
    """Daily products: keep the sampled days (one granule per day, the latest processing if repeated)."""
    if not recipe.days:
        return gs
    best = {}
    for g in gs:
        d = g.time_start[:10]
        if int(d[8:10]) in recipe.days:
            best[d] = g                                   # later in the list = later processing for the same day
    return [best[d] for d in sorted(best)]


def read_granule(recipe: Recipe, g: Granule, concept_id: str, coords: tuple | None = None) -> tuple[np.ndarray, dict]:
    """One granule -> (grid [180/deg, 360/deg], evidence row). `coords` = (lat axis, lon axis) for fixed grids."""
    t0 = time.time()
    paths = recipe.granule_paths(with_coords=coords is None)
    if recipe.access == "opendap":
        ce = ";".join([recipe.variable + recipe.slices]
                      + [p + sl for p, sl in ((recipe.lat, recipe.lat_slice), (recipe.lon, recipe.lon_slice)) if not p.startswith("axis:")]
                      + ([recipe.quality["path"] + recipe.slices] if recipe.quality else []))
        url = HYRAX.format(concept=concept_id, granule=urllib.parse.quote(g.title, safe=":")) + \
            "?dap4.ce=" + urllib.parse.quote(ce, safe="")
        body, _, _ = http_get(url)
        moved, src = len(body), body
        used = {"url": url.split("?")[0], "constraint": ce}
    elif recipe.access == "range":
        src = RangeFile(g.url)
        used = {"url": g.url}
    elif recipe.access == "download":
        body, _, _ = http_get(g.url)
        moved, src = len(body), body
        used = {"url": g.url, "file_sha256": hashlib.sha256(body).hexdigest()}
    else:
        raise EarthdataError(f"unknown access {recipe.access!r}")
    data = read_vars(src, paths)
    if isinstance(src, RangeFile):
        moved = src.bytes_moved
        used["range_requests"] = src.requests
    raw, attrs = data[recipe.variable]
    v = np.squeeze(decode(raw, attrs, recipe.scale))
    if coords is not None:
        lat, lon = coords
    else:
        lat = _axis(recipe.lat, v.shape[0]) if recipe.lat.startswith("axis:") else np.squeeze(decode(*data[recipe.lat]))
        lon = _axis(recipe.lon, v.shape[-1]) if recipe.lon.startswith("axis:") else np.squeeze(decode(*data[recipe.lon]))
    n_q = 0
    if recipe.quality:
        q = np.squeeze(np.asarray(data[recipe.quality["path"]][0]))
        if recipe.quality.get("rule") == "bit0_clear":
            drop = (q.astype(np.int64) & 1) != 0
        else:
            raise EarthdataError(f"unknown quality rule {recipe.quality.get('rule')!r}")
        n_q = int((drop & np.isfinite(v)).sum())
        v = np.where(drop, np.nan, v)
    n_phys = 0
    if recipe.phys_min is not None or recipe.phys_max is not None:
        lo_, hi_ = recipe.phys_min if recipe.phys_min is not None else -np.inf, recipe.phys_max if recipe.phys_max is not None else np.inf
        out = np.isfinite(v) & ((v < lo_) | (v > hi_))
        n_phys = int(out.sum())
        v = np.where(out, np.nan, v)
    grid, count = to_grid(v, lat, lon, recipe.deg)
    row = {"granule": g.title, "concept_id": g.id, "time_start": g.time_start, **used, "shape": list(v.shape),
           "array_sha256": array_sha256(v), "valid_pixels": int(np.isfinite(v).sum()), "dropped_quality": n_q,
           "dropped_physical_range": n_phys, "bytes_moved": int(moved), "seconds": round(time.time() - t0, 2)}
    return grid.astype("float32"), row


def build_cube(recipe: Recipe, work: str | Path, *, workers: int = 3, progress=None, limit: int | None = None):
    """-> (CubeData monthly [T, 180/deg, 360/deg], evidence dict). Resumable: granules already read are not asked again."""
    from .cube_io import CubeData

    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    coll = collection(recipe.short_name, recipe.version)
    gs = select(recipe, granules(recipe.short_name, recipe.version, recipe.start, recipe.end, names=recipe.names))
    if limit:
        gs = gs[:limit]
    if not gs:
        raise EarthdataError(f"no granules for {recipe.short_name} {recipe.version} in {recipe.start}..{recipe.end}")
    part = work / "evidence.partial.json"
    done = json.loads(part.read_text()) if part.exists() else {}
    todo = [g for g in gs if g.title not in done]
    failed: dict[str, str] = {}

    # h5py holds one global lock while it reads, and with access="range" the reading IS the network wait: threads
    # would queue behind each other (measured: 6 threads ~ 1 granule at a time). Range access uses processes.
    pool = ProcessPoolExecutor if recipe.access == "range" else ThreadPoolExecutor
    coords = None
    if recipe.fixed_coords and todo:
        cf = work / "coords.npz"
        if not cf.exists():
            la, lo = fixed_axes(recipe, todo[0])
            np.savez(cf, lat=la, lon=lo, from_granule=np.array(todo[0].title))
        z = np.load(cf)
        coords = (z["lat"], z["lon"])
    jobs = [(recipe, g, coll["concept_id"], str(work), coords) for g in todo]
    with pool(max(1, workers)) as ex:
        for i, (g, row) in enumerate(ex.map(_job, jobs), 1):
            if "failed" in row:
                failed[g.title] = row["failed"]
                continue
            done[g.title] = row
            if i % 5 == 0 or i == len(todo):
                part.write_text(json.dumps(done))
            if progress:
                progress(len(done), len(gs), g.time_start[:10])
    part.write_text(json.dumps(done))
    if failed:
        raise EarthdataError(f"{len(failed)} granules failed (the {len(done)} read are kept; run again to fetch only the "
                             f"missing ones). First: {next(iter(failed.items()))}")
    by_month: dict[str, list[str]] = {}
    for g in gs:
        by_month.setdefault(_month(g.time_start), []).append(g.title)
    months = sorted(by_month)
    lat, lon = grid_axes(recipe.deg)
    cube = np.full((len(months), len(lat), len(lon)), np.nan, dtype="float32")
    n_per_month = []
    for i, m in enumerate(months):
        stack = np.stack([np.load(work / f"{_safe(t)}.npy") for t in by_month[m]])
        with np.errstate(invalid="ignore"):
            cnt = np.isfinite(stack).sum(0)
            cube[i] = np.where(cnt > 0, np.nansum(stack, 0) / np.maximum(cnt, 1), np.nan)
        n_per_month.append(len(by_month[m]))
    rows = [done[g.title] for g in gs]
    meta = {"id": f"earthdata_{recipe.id}_{months[0][:4]}-{months[-1][:4]}", "profile": "earth", "body": "earth",
            "variable": {"name": recipe.id.upper(), "unit": recipe.units, "long_name": recipe.long_name},
            "dataset": {"name": f"{coll['short_name']} v{coll['version']} — {coll['title']}", "kind": recipe.kind,
                        "doi": coll["doi"], "concept_id": coll["concept_id"], "provider": coll["provider"],
                        "licence": recipe.licence, "sha256": hashlib.sha256("".join(r["array_sha256"] for r in rows).encode()).hexdigest()},
            "native_resolution_deg": recipe.deg, "notes": list(recipe.notes),
            "regrid": f"mean of all valid pixels in each {recipe.deg} degree box"}
    time_axis = [f"{m}-01" for m in months]
    cd = CubeData(cube, np.isfinite(cube), time_axis, lat, lon, meta)
    evidence = {"evidence_version": 1, "recipe": asdict(recipe), "collection": coll, "granules": rows,
                "granules_per_month": dict(zip(months, n_per_month)),
                "cube_sha256": array_sha256(cube), "software": _software(),
                "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "reproduce": f"python -m zon earthdata reproduce --evidence <this file> --k 5",
                "token": f"read from ${TOKEN_ENV}; never stored"}
    return cd, evidence


def fixed_axes(recipe: Recipe, g: Granule) -> tuple[np.ndarray, np.ndarray]:
    """Read lat/lon of one granule of a fixed grid and reduce them to a latitude per row and a longitude per column
    (the median of the valid pixels; the spread is checked so a grid that is NOT fixed by rows/columns is refused)."""
    src = RangeFile(g.url) if recipe.access == "range" else http_get(g.url)[0]
    d = read_vars(src, [recipe.lat, recipe.lon])
    lat2, lon2 = np.squeeze(decode(*d[recipe.lat])), np.squeeze(decode(*d[recipe.lon]))
    lat2[np.abs(lat2) > 90], lon2[np.abs(lon2) > 180] = np.nan, np.nan      # fill (-9999) without a _FillValue attribute
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        la, lo = np.nanmedian(lat2, axis=1), np.nanmedian(lon2, axis=0)
        spread = max(np.nanmax(np.abs(lat2 - la[:, None])), np.nanmax(np.abs(lon2 - lo[None, :])))
    if not spread < 1e-3:
        raise EarthdataError(f"lat/lon are not constant along rows/columns (spread {spread}); fixed_coords does not apply")
    return la, lo


def _job(args):
    recipe, g, concept_id, work, coords = args
    try:
        grid, row = read_granule(recipe, g, concept_id, coords)
    except Exception as e:                            # one bad granule must not stop the run (h5py turns a network error
                                                      # inside a range read into SystemError/OSError)
        return g, {"failed": _redact(str(e))[:300]}
    np.save(Path(work) / f"{_safe(g.title)}.npy", grid)
    return g, row


def _safe(t: str) -> str:
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in t)


def _software() -> dict:
    s = {"zon": __version__, "numpy": np.__version__}
    try:
        import h5py
        s["h5py"] = h5py.__version__
    except ImportError:
        pass
    return s


def reproduce(evidence: dict, k: int = 5, seed: int = 247) -> dict:
    """Re-read k granules named in the evidence (seeded choice) and compare the SHA-256 of what was decoded."""
    r = Recipe(**evidence["recipe"])
    rows = evidence["granules"]
    idx = sorted(np.random.default_rng(seed).choice(len(rows), size=min(k, len(rows)), replace=False).tolist())
    checks = []
    for i in idx:
        row = rows[i]
        g = Granule(row["concept_id"], row["granule"], row["time_start"], row["time_start"],
                    row["url"] if r.access != "opendap" else "")
        if r.access != "opendap":
            g.url = row["url"]
        _, new = read_granule(r, g, evidence["collection"]["concept_id"])
        checks.append({"granule": row["granule"], "match": new["array_sha256"] == row["array_sha256"],
                       "was": row["array_sha256"][:16], "now": new["array_sha256"][:16]})
    return {"checked": len(checks), "matches": sum(c["match"] for c in checks), "checks": checks}
