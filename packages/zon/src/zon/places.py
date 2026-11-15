"""Z8 «any place»: names -> polygons -> grid cells -> an area-weighted regional series. Stdlib + NumPy, no GIS stack.

Sources (download once, see sim/fetch_places.py): Natural Earth admin-0 / admin-1 (public domain; NE itself warns
that some admin-1 borders outside the US are disputed or change) and GeoNames cities (CC BY 4.0: attribution
required). The ESRI shapefile reader below supports what Natural Earth ships: Polygon (5) and null shapes, UTF-8 dbf.

Honesty rules baked in:
- a place smaller than one cell (~55 km) gets the cell that contains it and the flag `menor_que_una_celda`;
- the regional series weights each cell by cos(lat) (equal-area), never by cell count;
- the cell count is context, not the verdict: the regional verdict comes from the regional series.
"""
from __future__ import annotations

import struct
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


class PlaceError(ValueError):
    pass


# ---------------------------------------------------------------- shapefile (.shp + .dbf)
def read_dbf(path: str | Path, encoding: str = "utf-8") -> list[dict]:
    b = Path(path).read_bytes()
    n, hlen, rlen = struct.unpack_from("<IHH", b, 4)
    fields, pos = [], 32
    while b[pos] != 0x0D:
        name = b[pos:pos + 11].split(b"\0", 1)[0].decode("ascii")
        fields.append((name, chr(b[pos + 11]), b[pos + 16]))
        pos += 32
    rows = []
    for r in range(n):
        off = hlen + r * rlen
        if b[off] == 0x2A:                                          # deleted record
            rows.append(None)
            continue
        off += 1
        row = {}
        for name, typ, ln in fields:
            raw = b[off:off + ln].decode(encoding, errors="replace").strip(" \x00")
            off += ln
            if typ in "NF":
                try:
                    row[name] = float(raw) if raw else None
                except ValueError:
                    row[name] = None
            else:
                row[name] = raw
        rows.append(row)
    return rows


def read_shp(path: str | Path) -> list[list[np.ndarray] | None]:
    """Each record -> list of rings (arrays [k, 2] of lon, lat), or None for null shapes."""
    b = Path(path).read_bytes()
    code, = struct.unpack_from(">i", b, 0)
    if code != 9994:
        raise PlaceError(f"{path}: not a shapefile")
    stype, = struct.unpack_from("<i", b, 32)
    if stype not in (0, 5):
        raise PlaceError(f"{path}: shape type {stype} not supported (only Polygon = 5)")
    out, pos = [], 100
    while pos + 8 <= len(b):
        _, clen = struct.unpack_from(">ii", b, pos)
        pos += 8
        end = pos + 2 * clen
        t, = struct.unpack_from("<i", b, pos)
        if t == 0:
            out.append(None)
        elif t == 5:
            nparts, npts = struct.unpack_from("<ii", b, pos + 36)
            parts = list(struct.unpack_from(f"<{nparts}i", b, pos + 44)) + [npts]
            pts = np.frombuffer(b, "<f8", 2 * npts, pos + 44 + 4 * nparts).reshape(npts, 2)
            out.append([pts[parts[k]:parts[k + 1]].copy() for k in range(nparts)])
        else:
            raise PlaceError(f"{path}: record shape type {t} not supported")
        pos = end
    return out


# ---------------------------------------------------------------- geometry
def points_in_rings(rings: list[np.ndarray], lon: np.ndarray, lat: np.ndarray, edge_block: int = 4096) -> np.ndarray:
    """Even-odd rule over all rings (holes and multipolygons included). lon/lat: 1-D arrays of the same length."""
    inside = np.zeros(lon.shape, dtype=bool)
    px, py = lon[None, :], lat[None, :]
    for ring in rings:
        x1, y1 = ring[:, 0], ring[:, 1]
        x2, y2 = np.roll(x1, -1), np.roll(y1, -1)
        for k in range(0, len(x1), edge_block):                    # bounded memory: edges x points per step
            a, b_, c, d = (v[k:k + edge_block, None] for v in (x1, y1, x2, y2))
            cross = (b_ > py) != (d > py)
            with np.errstate(divide="ignore", invalid="ignore"):
                xint = a + (py - b_) * (c - a) / (d - b_)
            inside ^= (np.count_nonzero(cross & (px < xint), axis=0) % 2).astype(bool)
    return inside


def rings_bbox(rings: list[np.ndarray]) -> tuple[float, float, float, float]:
    allp = np.concatenate(rings)
    return float(allp[:, 1].min()), float(allp[:, 0].min()), float(allp[:, 1].max()), float(allp[:, 0].max())


def cell_mask(rings: list[np.ndarray], lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, list[str]]:
    """[Y, X] mask of grid cells whose CENTER is inside the polygon. Tiny places fall back to the containing cell."""
    s, w, n, e = rings_bbox(rings)
    iy = np.nonzero((lat >= s) & (lat <= n))[0]
    ix = np.nonzero((lon >= w) & (lon <= e))[0]
    mask = np.zeros((len(lat), len(lon)), dtype=bool)
    notes = []
    if iy.size and ix.size:
        LA, LO = np.meshgrid(lat[iy], lon[ix], indexing="ij")
        sub = points_in_rings(rings, LO.ravel(), LA.ravel()).reshape(LA.shape)
        mask[np.ix_(iy, ix)] = sub
    if not mask.any():
        allp = np.concatenate(rings)
        cy, cx = float(allp[:, 1].mean()), float(allp[:, 0].mean())
        mask[int(np.argmin(np.abs(lat - cy))), int(np.argmin(np.abs(((lon - cx) + 180) % 360 - 180)))] = True
        notes.append("menor_que_una_celda")
    return mask, notes


def regional_series(values: np.ndarray, lat: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, dict]:
    """Area-weighted (cos lat) mean over the masked cells, per time step, using only valid cells at each step.

    values [T, Y, X]; lat [Y]. Returns (series [T], info). A time step with < 80 % of the place's weight valid is NaN.
    """
    w = np.cos(np.deg2rad(lat))[:, None] * mask
    wsum = float(w.sum())
    if wsum <= 0:
        raise PlaceError("empty mask")
    v = np.asarray(values, dtype=float)
    ok = np.isfinite(v) & mask[None]
    wt = np.where(ok, w[None], 0.0)
    cover = wt.sum(axis=(1, 2)) / wsum
    with np.errstate(invalid="ignore", divide="ignore"):
        s = (np.where(ok, v, 0.0) * wt).sum(axis=(1, 2)) / wt.sum(axis=(1, 2))
    s[cover < 0.8] = np.nan
    return s, {"n_cells": int(mask.sum()), "weights": "cos(lat) x celda dentro", "min_coverage": float(cover.min())}


# ---------------------------------------------------------------- names
def norm(text: str) -> str:
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return " ".join("".join(c if c.isalnum() else " " for c in t).split())


@dataclass
class Place:
    id: str
    kind: str                         # country | admin1 | city
    name: dict                        # {"es", "en"}
    country: str
    rings: list = field(default_factory=list, repr=False)   # polygons (empty for cities)
    point: tuple | None = None        # (lat, lon) for cities
    population: int = 0
    source: dict = field(default_factory=dict)
    aliases: tuple = ()

    def to_entity_place(self) -> dict:
        geom = {"type": "point", "point": list(self.point)} if self.point else \
            {"type": "bbox", "bbox": [round(v, 4) for v in rings_bbox(self.rings)], "polygon_source": self.source.get("name")}
        rel = [{"rel": "part_of", "target": f"earth-{norm(self.country).replace(' ', '-')}"}] if self.kind != "country" else []
        return {"id": f"earth-{self.id}", "name": self.name, "geometry": geom, "relations": rel, "source": self.source}


KIND_RANK = {"country": 0, "admin1": 1, "city": 2}


class PlaceIndex:
    def __init__(self, places: list[Place]):
        self.places = places
        self._by = {}
        for p in places:
            for key in {norm(p.name.get("es", "")), norm(p.name.get("en", "")), *map(norm, p.aliases)} - {""}:
                self._by.setdefault(key, []).append(p)

    def search(self, text: str, limit: int = 5) -> list[Place]:
        """Exact (accent/case-insensitive) matches first, then prefix matches; country > admin-1 > city by population.

        'Mexico' is the country (the State of Mexico stays as an alternative); 'Durango' is the state, not the city.
        """
        q = norm(text)
        if not q:
            return []
        rank = lambda p: (KIND_RANK.get(p.kind, 9), -p.population, p.id)
        exact = sorted(self._by.get(q, []), key=rank)
        if len(exact) >= limit:
            return exact[:limit]
        seen = {p.id for p in exact}
        pref = sorted({p.id: p for k, ps in self._by.items() if k.startswith(q) and k != q for p in ps
                       if p.id not in seen}.values(), key=rank)
        return (exact + pref)[:limit]

    @classmethod
    def from_natural_earth(cls, admin0_shp=None, admin1_shp=None, cities_tsv=None, min_population: int = 15000):
        places: list[Place] = []
        ne = {"name": "Natural Earth", "licence": "public domain", "url": "https://www.naturalearthdata.com"}
        for shp, kind in ((admin0_shp, "country"), (admin1_shp, "admin1")):
            if not shp:
                continue
            shp = Path(shp)
            for geom, attrs in zip(read_shp(shp), read_dbf(shp.with_suffix(".dbf"))):
                if geom is None or attrs is None:
                    continue
                g = lambda *ks: next((attrs[k] for k in ks if attrs.get(k)), "")
                en = g("NAME_EN", "NAME", "name")
                es = g("NAME_ES", "NAME", "name") or en
                if kind == "country":
                    pid, country = norm(g("ADM0_A3", "ISO_A3") + " " + en).replace(" ", "-"), en
                    alias = (g("NAME_LONG"), g("FORMAL_EN"), g("NAME"))
                else:
                    country = g("admin", "ADMIN")
                    pid = norm(f"{g('iso_3166_2', 'adm1_code')} {en}").replace(" ", "-")
                    alias = (g("name", "NAME"), g("name_alt"), g("woe_name"))
                places.append(Place(pid, kind, {"es": es, "en": en}, country, geom, source={**ne, "layer": shp.stem},
                                    aliases=tuple(a for a in alias if a)))
        if cities_tsv:
            gn = {"name": "GeoNames", "licence": "CC BY 4.0 (attribution required)", "url": "https://www.geonames.org"}
            for line in Path(cities_tsv).read_text(encoding="utf-8").splitlines():
                f = line.split("\t")
                if len(f) < 15 or int(f[14] or 0) < min_population:
                    continue
                places.append(Place(f"gn-{f[0]}", "city", {"es": f[1], "en": f[1]}, f[8], point=(float(f[4]), float(f[5])),
                                    population=int(f[14] or 0), source=gn, aliases=(f[2],)))
        return cls(places)
