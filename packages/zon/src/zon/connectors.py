"""Pluggable sources. Every connector answers the same two questions — «what are you?» and «what is NEW since this?» —
and leaves a trace in the health table (zon/health) every time it runs.

    c = CONNECTORS["power_place"](place="Durango", var="T2M", start=1981, index=idx)
    new = c.fetch(since="2026-08")          # {"times": [...], "values": [...], "provenance": {...}}

Kinds: «serie» (times + values for a monitor), «reportes» (swarm reports), «catalogo» (where the data is: granules and links,
nothing downloaded). Add a source = write a class with `name`, `kind`, `describe()` and `fetch(since)` and @register it.
"""
from __future__ import annotations

import csv
import json
import struct
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

CONNECTORS: dict[str, type] = {}


def register(cls):
    CONNECTORS[cls.name] = cls
    return cls


def _after(times, values, since):
    keep = [(t, v) for t, v in zip(times, values) if since is None or str(t) > str(since)]
    return [t for t, _ in keep], [None if v is None or not np.isfinite(v) else float(v) for _, v in keep]


@register
class PowerPlace:
    """NASA POWER (MERRA-2, Zarr on AWS): the monthly regional series of a named place."""
    name, kind = "power_place", "serie"

    def __init__(self, place: str, var: str, start: int = 1981, *, index, store=None, refresh: bool = True):
        self.place, self.var, self.start, self.index, self.store, self.refresh = place, var, start, index, store, refresh

    def describe(self) -> dict:
        return {"connector": self.name, "kind": self.kind, "source": "NASA POWER ARD (MERRA-2), Zarr en AWS", "place": self.place,
                "variable": self.var, "cadence": "mensual", "licence": "NASA open data"}

    def fetch(self, since=None) -> dict:
        from .fetch.power_zarr import PowerZarr
        from .query import place_series
        z = self.store or PowerZarr(refresh=self.refresh)
        s = place_series(self.place, self.var, self.start, int(time.strftime("%Y")), index=self.index, store=z)
        t, v = _after(s["months"], s["values"], since)
        return {"times": t, "values": v, "provenance": {**self.describe(), "dataset_url": s["meta"]["dataset"]["url"],
                                                         "dataset_sha256": s["meta"]["dataset"].get("sha256")}}


@register
class MarsDust:
    """Mars column dust optical depth, daily global mean (LMD/Montabone, reconstruction, CC BY-SA 3.0)."""
    name, kind = "mars_dust", "serie"

    def __init__(self, root: str = "data/mars"):
        self.root = root

    def describe(self) -> dict:
        return {"connector": self.name, "kind": self.kind, "source": "Mars Climate Database dust climatology (Montabone et al.)",
                "cadence": "diaria (sol)", "licence": "CC BY-SA 3.0", "note": "reconstrucción (kriging)"}

    def fetch(self, since=None) -> dict:
        from .fetch.mars_dust import load_mars_dust
        d = load_mars_dust(self.root)
        t, v = _after(d["daily_labels"], d["daily_global"], since)
        return {"times": t, "values": v, "provenance": {**self.describe(), "dataset_sha256": d["meta"]["dataset"]["sha256"]}}


@register
class CsvSeries:
    """Any sensor that writes a CSV (time column + value column). The file's SHA-256 is the provenance."""
    name, kind = "csv_series", "serie"

    def __init__(self, path: str, time_col: str = "time", value_col: str = "value"):
        self.path, self.time_col, self.value_col = path, time_col, value_col

    def describe(self) -> dict:
        return {"connector": self.name, "kind": self.kind, "source": f"archivo {Path(self.path).name}", "columns": [self.time_col, self.value_col]}

    def fetch(self, since=None) -> dict:
        import hashlib
        raw = Path(self.path).read_bytes()
        rows = list(csv.DictReader(raw.decode("utf-8").splitlines()))
        def num(x):
            try:
                return float(x)
            except (TypeError, ValueError):
                return float("nan")
        rows.sort(key=lambda r: r[self.time_col])
        t, v = _after([r[self.time_col] for r in rows], [num(r[self.value_col]) for r in rows], since)
        return {"times": t, "values": v, "provenance": {**self.describe(), "sha256": hashlib.sha256(raw).hexdigest()}}


@register
class HttpJsonSeries:
    """Any HTTP API that returns JSON with a list of times and a list of values (keys configurable)."""
    name, kind = "http_json", "serie"

    def __init__(self, url: str, times_key: str = "times", values_key: str = "values", opener=None, timeout: float = 30):
        self.url, self.tk, self.vk, self.timeout = url, times_key, values_key, timeout
        self.opener = opener or urllib.request.urlopen

    def describe(self) -> dict:
        return {"connector": self.name, "kind": self.kind, "source": urllib.parse.urlsplit(self.url).netloc}

    def fetch(self, since=None) -> dict:
        import hashlib
        with self.opener(self.url, timeout=self.timeout) as r:
            body = r.read()
        d = json.loads(body)
        t, v = _after(d[self.tk], [float("nan") if x is None else float(x) for x in d[self.vk]], since)
        return {"times": t, "values": v, "provenance": {**self.describe(), "sha256": hashlib.sha256(body).hexdigest()}}


@register
class CocorahsReports:
    """CoCoRaHS condition monitoring (USA citizen reports) -> swarm reports with a STRUCTURED direction (the scale picked)."""
    name, kind = "cocorahs", "reportes"
    URL = "https://cocorahs.carto.com:443/api/v2/sql/?format=CSV&q=select%20*%20FROM%20table_1abk8awn0essfy5dnbf7lq"
    SCALE = {"Severely Dry": "bajo", "Moderately Dry": "bajo", "Mildly Dry": "bajo", "Mildly Wet": "alto", "Moderately Wet": "alto",
             "Severely Wet": "alto"}

    def __init__(self, path: str = "data/cocorahs/cm_all.csv"):
        self.path = path

    def describe(self) -> dict:
        return {"connector": self.name, "kind": self.kind, "source": "CoCoRaHS Condition Monitoring (EE. UU.)", "url": self.URL,
                "note": "fuente ciudadana NO verificada; revisar términos de uso antes de publicar"}

    def fetch(self, since=None) -> dict:
        csv.field_size_limit(10 ** 8)
        out = []
        for r in csv.DictReader(open(self.path, encoding="utf-8", errors="replace")):
            if not r["the_geom"] or (since and r["datetimestamp"] <= since):
                continue
            b = bytes.fromhex(r["the_geom"])
            x, y = struct.unpack("<dd", b[9:25])
            rep = {"id": f"cocorahs-{r['id']}", "reporter": {"id": f"cocorahs:{r['stationnumber']}", "type": "persona"},
                   "lat": y, "lon": x, "time": r["reportdate"] + "T12:00", "text": r["description"] or r["scalebar"]}
            if r["scalebar"] in self.SCALE:
                rep.update(theme="agua", direction=self.SCALE[r["scalebar"]])
            out.append(rep)
        return {"reports": out, "provenance": self.describe()}


@register
class CmrSearch:
    """NASA Earthdata CMR: WHERE the granules of a collection are for a box and dates (search is public; downloading most
    granules needs an Earthdata token, and NetCDF4/HDF5 needs a reader we do not ship yet: stated)."""
    name, kind = "cmr_search", "catalogo"
    BASE = "https://cmr.earthdata.nasa.gov/search/granules.json"

    def __init__(self, short_name: str, bbox: tuple, temporal: tuple, page_size: int = 50, opener=None):
        self.short_name, self.bbox, self.temporal, self.page_size = short_name, bbox, temporal, page_size
        self.opener = opener or urllib.request.urlopen

    def describe(self) -> dict:
        return {"connector": self.name, "kind": self.kind, "source": "NASA Earthdata CMR", "collection": self.short_name}

    def fetch(self, since=None) -> dict:
        s, w, n, e = self.bbox
        q = urllib.parse.urlencode({"short_name": self.short_name, "bounding_box": f"{w},{s},{e},{n}",
                                    "temporal": f"{since or self.temporal[0]},{self.temporal[1]}", "page_size": self.page_size,
                                    "sort_key": "start_date"})
        with self.opener(f"{self.BASE}?{q}", timeout=60) as r:
            d = json.loads(r.read())
        gr = [{"id": g.get("id"), "title": g.get("title"), "start": g.get("time_start"), "end": g.get("time_end"),
               "links": [l["href"] for l in g.get("links", []) if l.get("rel", "").endswith("/data#")]}
              for g in d.get("feed", {}).get("entry", [])]
        return {"granules": gr, "provenance": self.describe()}


# ---------------------------------------------------------------- health of every source
def run_source(con, source: str, fn, now: str | None = None):
    """Run a connector call and record how it went (time, error, last data). Re-raises the error after recording it."""
    from . import db
    now = now or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    t0 = time.perf_counter()
    try:
        out = fn()
    except Exception as e:
        ms = 1000 * (time.perf_counter() - t0)
        with db.tx(con):
            con.execute("INSERT INTO health (source, last_error, last_error_msg, failures, runs, last_ms) VALUES (?,?,?,1,1,?) "
                        "ON CONFLICT(source) DO UPDATE SET last_error=excluded.last_error, last_error_msg=excluded.last_error_msg, "
                        "failures=failures+1, runs=runs+1, last_ms=excluded.last_ms", (source, now, f"{type(e).__name__}: {e}"[:300], ms))
        raise
    ms = 1000 * (time.perf_counter() - t0)
    last = (out.get("times") or [None])[-1] if isinstance(out, dict) else None
    with db.tx(con):
        con.execute("INSERT INTO health (source, last_ok, last_data, failures, runs, last_ms) VALUES (?,?,?,0,1,?) "
                    "ON CONFLICT(source) DO UPDATE SET last_ok=excluded.last_ok, last_data=COALESCE(excluded.last_data, last_data), "
                    "failures=0, runs=runs+1, last_ms=excluded.last_ms", (source, now, last, ms))
    return out


def health_report(con, now: str, stale_hours: float = 24 * 40, fail_limit: int = 3) -> list[dict]:
    """Per source: ok | degradada (failing, < fail_limit times in a row) | caida (>= fail_limit) | sin_datos_recientes."""
    from datetime import datetime
    t = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
    out = []
    for r in con.execute("SELECT * FROM health ORDER BY source"):
        d = dict(r)
        st = "ok"
        if d["failures"] >= fail_limit:
            st = "caida"
        elif d["failures"] > 0:
            st = "degradada"
        elif d["last_ok"] and (t(now) - t(d["last_ok"])).total_seconds() / 3600 > stale_hours:
            st = "sin_datos_recientes"
        d["status"] = st
        out.append(d)
    return out
