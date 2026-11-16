"""Irrigation that does not switch off in a drought, seen from orbit (MODIS 250 m), judged by HORI.

The question: in a dry basin, how much land is already green BEFORE the irrigation canals open? Rain cannot
explain it (dry season) and the reservoirs are not releasing yet, so that green is, most likely, pumped
groundwater. Its yearly MINIMUM is a floor: the area that stayed irrigated even in the driest years.

Data: MOD13Q1 v061 NDVI, 16-day composites, 250 m, read as a box around a point from the ORNL DAAC MODIS
subset service (NASA; no account). LP DAAC OPeNDAP was measured on 2026-11-15: 2 of 3 MOD13Q1 granules answer
404 (no DMR++ index), so it is not used here. Every response is kept with its SHA-256.

What is measured and what is inferred (kept apart in the output):
- measured: NDVI per pixel and date; green area per year; HORI's verdict on each pixel's trend.
- inferred: «green before the canals open = groundwater». It rests on the canal calendar the caller gives.
- NOT measured: wells, volumes. The water bracket multiplies hectares by irrigation depths the caller states.

A pixel is «green» in a year when its pre-canal NDVI is >= `thr` AND stands >= `excess` above that year's
scene median. The second condition removes rain-fed greening of wet years (measured in La Laguna: without it
2015 counts 189,000 ha, with it 47,000; the year-to-year spread falls from 56 % to 16 %).
"""
from __future__ import annotations

import hashlib
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ORNL = ("https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude={lat}&longitude={lon}&band=250m_16_days_NDVI"
        "&startDate=A{d}&endDate=A{d}&kmAboveBelow={ns}&kmLeftRight={ew}")
R_SIN = 6371007.181            # radius of the MODIS sinusoidal sphere (m)
FILL = -2000                   # MOD13 NDVI fill is -3000; valid range starts at -2000
DOYS = (65, 81, 97, 113, 129, 145)      # 6 Mar .. 9 Jun composites: the dry season before the monsoon
PRE_CANAL = (65, 81)                    # 6 Mar .. 6 Apr: before the spring-summer canal releases (caller may change it)


class RiegoError(RuntimeError):
    pass


# ------------------------------------------------------------------ fetch (resumable, with evidence)
def fetch(lat: float, lon: float, km_ns: int, km_ew: int, years, out: str | Path, *, doys=DOYS, workers: int = 3,
          progress=None, opener=None) -> dict:
    """Box of MOD13Q1 NDVI around (lat, lon) for every year x composite -> out/A<yyyyddd>.npy (raw int16) and
    out/evidence.json. Dates already read are not asked again. `opener(url) -> bytes` is injectable for tests."""
    if not (0 < km_ns <= 100 and 0 < km_ew <= 100):
        raise RiegoError("the ORNL service allows at most 100 km above/below and left/right")
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    ev_p = out / "evidence.json"
    ev = json.loads(ev_p.read_text(encoding="utf-8")) if ev_p.exists() else {}
    get = opener or (lambda u: urllib.request.urlopen(
        urllib.request.Request(u, headers={"Accept": "application/json"}), timeout=120).read())

    def one(d: str):
        url = ORNL.format(lat=lat, lon=lon, d=d, ns=km_ns, ew=km_ew)
        err = ""
        for i in range(5):
            try:
                raw = get(url)
                j = json.loads(raw)
                s = j["subset"][0]
                a = np.array(s["data"], dtype=np.int16).reshape(j["nrows"], j["ncols"])
                np.save(out / f"A{d}.npy", a)
                return d, {"url": url, "sha256": hashlib.sha256(raw).hexdigest(), "proc_date": s["proc_date"],
                           "tile": s["tile"], "xll": float(j["xllcorner"]), "yll": float(j["yllcorner"]),
                           "cellsize": float(j["cellsize"]), "shape": [j["nrows"], j["ncols"]]}
            except Exception as e:  # network or a malformed answer: retry, then record why
                err = repr(e)[:200]
                if opener is None:
                    time.sleep(4 * (i + 1))
        return d, {"error": err}

    todo = [f"{y}{d:03d}" for y in years for d in doys]
    todo = [d for d in todo if d not in ev or "error" in ev[d]]
    with ThreadPoolExecutor(workers) as ex:
        for n, (d, row) in enumerate(ex.map(one, todo), 1):
            ev[d] = row
            if n % 10 == 0 or n == len(todo):
                ev_p.write_text(json.dumps(ev, indent=0), encoding="utf-8")
            if progress:
                progress(n, len(todo), d)
    return ev


def load(out: str | Path) -> dict:
    """-> {"ndvi": {year: {doy: [ny, nx] float32, NaN = fill}}, "lat": [ny], "lon": [ny, nx], "ha": per pixel}."""
    out = Path(out)
    ev = {d: r for d, r in json.loads((out / "evidence.json").read_text(encoding="utf-8")).items() if "error" not in r}
    if not ev:
        raise RiegoError(f"no usable dates in {out}")
    shapes = {(tuple(r["shape"]), float(r["xll"]), float(r["yll"]), float(r["cellsize"])) for r in ev.values()}
    if len(shapes) != 1:
        raise RiegoError("the dates do not share one grid (different box or cell size)")
    (ny, nx), xll, yll, cs = next(iter(shapes))
    ndvi: dict = {}
    for d in sorted(ev):
        a = np.load(out / f"A{d}.npy").astype("float32")
        ndvi.setdefault(int(d[:4]), {})[int(d[4:])] = np.where(a < FILL, np.nan, a / 10000.0)
    lat = np.degrees((yll + cs * (ny - np.arange(ny) - 0.5)) / R_SIN)
    x = np.degrees((xll + cs * (np.arange(nx) + 0.5)) / R_SIN)
    lon = x[None, :] / np.cos(np.radians(lat))[:, None]          # sinusoidal: longitude depends on the row
    return {"ndvi": ndvi, "lat": lat, "x": x, "lon": lon, "ha": cs * cs / 1e4, "evidence": ev}


# ------------------------------------------------------------------ the measure
def window_mean(ndvi: dict, doys, min_valid: int = 1) -> tuple[list, np.ndarray]:
    """Mean NDVI of the given composites per year -> (years, [T, ny, nx]); NaN where fewer than `min_valid` are valid.
    A year missing any of the composites is left out (it would not be comparable)."""
    years = [y for y in sorted(ndvi) if all(d in ndvi[y] for d in doys)]
    if not years:
        raise RiegoError("no year has every composite of the window")
    out = []
    for y in years:
        s = np.stack([ndvi[y][d] for d in doys])
        ok = np.isfinite(s)
        with np.errstate(invalid="ignore"):
            out.append(np.where(ok.sum(0) >= min_valid, np.where(ok, s, 0).sum(0) / np.maximum(ok.sum(0), 1), np.nan))
    return years, np.stack(out).astype("float32")


def green_mask(pre: np.ndarray, thr: float = 0.40, excess: float = 0.20) -> np.ndarray:
    """[T, ny, nx] bool: NDVI >= thr AND >= that year's scene median + excess (rain-fed greening is not irrigation)."""
    with np.errstate(invalid="ignore"):
        med = np.nanmedian(pre.reshape(len(pre), -1), axis=1)[:, None, None]
        return (pre >= thr) & (pre - med >= excess)


def centroid_shift(a: np.ndarray, b: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> dict | None:
    """Where the green moved: centroid of mask a -> centroid of mask b, in km and compass bearing."""
    if not a.any() or not b.any():
        return None
    la = np.broadcast_to(lat[:, None], a.shape)
    (la0, lo0), (la1, lo1) = ((float(la[m].mean()), float(lon[m].mean())) for m in (a, b))
    dy = (la1 - la0) * 111.195
    dx = (lo1 - lo0) * 111.195 * np.cos(np.radians((la0 + la1) / 2))
    return {"from": [round(la0, 4), round(lo0, 4)], "to": [round(la1, 4), round(lo1, 4)],
            "km": round(float(np.hypot(dx, dy)), 2), "bearing_deg": round(float(np.degrees(np.arctan2(dx, dy)) % 360), 1)}


def hori_trend(pre: np.ndarray, years: list, lat: np.ndarray, x: np.ndarray, *, rows: int = 24):
    """HORI's verdict on each pixel's trend, ONE false-discovery family for the whole box. -> (verdict, effect/decade)."""
    from hori.api import run_grid
    from hori.config import Config
    tm = np.array([f"{y}-{m:02d}-01" for y in years for m in range(1, 13)])
    meta = {"id": "ndvi250_pre_canal", "profile": "earth", "body": "earth",
            "variable": {"name": "NDVI_pre_canal", "unit": "1", "long_name": "NDVI before the canals open (MOD13Q1 250 m)"},
            "dataset": {"name": "MOD13Q1 v061", "kind": "satellite", "doi": "10.5067/MODIS/MOD13Q1.061"},
            "native_resolution_deg": 10 / 4800}

    def blocks():  # one value per year, repeated over the 12 months so HORI's annual mean returns it unchanged
        for y0 in range(0, pre.shape[1], rows):
            yield y0, 0, np.repeat(pre[:, y0:y0 + rows], 12, axis=0)
    res = run_grid(blocks(), lat, x, tm, meta, Config())
    sh = pre.shape[1:]
    return res.verdict.reshape(sh), res.effect.reshape(sh)


def summarize(years: list, green: np.ndarray, ha: float, lat: np.ndarray, lon: np.ndarray, *, verdict=None, effect=None,
              inside: np.ndarray | None = None, depths_m: dict | None = None, span: int = 5, bin_deg: float = 0.05) -> dict:
    """The finding. `inside` restricts every count to a region (e.g. one state). `depths_m` = {"label": metres/year}
    gives the water bracket for the floor; without it no volume is stated."""
    g = green if inside is None else green & inside[None]
    n = len(years)
    area = g.reshape(n, -1).sum(1) * ha
    k = int(np.argmin(area))
    freq = g.sum(0)
    first, last = g[:span].sum(0), g[-span:].sum(0)
    new, lost = (last >= span - 1) & (first <= 1), (first >= span - 1) & (last <= 1)
    out = {"years": [int(y) for y in years], "pixel_ha": round(ha, 4),
           "green_ha": {int(y): int(round(a)) for y, a in zip(years, area)},
           "floor_ha": int(round(area[k])), "floor_year": int(years[k]), "median_ha": int(round(float(np.median(area)))),
           "spread_cv": round(float(area.std() / area.mean()), 3) if area.mean() else None,
           "core_ha": int(round(float((freq >= 0.8 * n).sum() * ha))), "ever_ha": int(round(float((freq >= 1).sum() * ha))),
           "new_ha": int(round(float(new.sum() * ha))), "lost_ha": int(round(float(lost.sum() * ha))),
           "shift": centroid_shift(first >= span - 1, last >= span - 1, lat, lon)}
    if depths_m:
        out["floor_water_hm3"] = {k_: round(area[k] * d / 100.0, 1) for k_, d in depths_m.items()}   # ha x m = 0.01 hm3
        out["depths_m"] = depths_m
    if verdict is not None:
        m = np.ones(verdict.shape, bool) if inside is None else inside
        up, down = (verdict == 1) & (effect > 0) & m, (verdict == 1) & (effect < 0) & m
        out["hori"] = {"supported_up_ha": int(round(float(up.sum() * ha))), "supported_down_ha": int(round(float(down.sum() * ha))),
                       "no_change_px": int(((verdict == 4) & m).sum()), "inconclusive_px": int(((verdict == 3) & m).sum()),
                       "candidate_px": int(((verdict == 2) & m).sum()), "pixels": int(m.sum())}
    # coarse cells for a map: hectares of core / new / lost green per bin
    la = np.broadcast_to(lat[:, None], lon.shape)
    cells: dict = {}
    for name, mask in (("core", freq >= 0.8 * n), ("new", new), ("lost", lost)):
        ky = np.round(la[mask] / bin_deg).astype(int)
        kx = np.round(lon[mask] / bin_deg).astype(int)
        for (a, b), c in zip(*np.unique(np.stack([ky, kx], 1), axis=0, return_counts=True)) if mask.any() else ():
            cells.setdefault((int(a), int(b)), {"core": 0, "new": 0, "lost": 0})[name] = int(round(c * ha))
    out["cells"] = [{"lat": round(a * bin_deg, 4), "lon": round(b * bin_deg, 4), **v} for (a, b), v in sorted(cells.items())]
    return out


def run(lat: float, lon: float, km_ns: int, km_ew: int, start: int, end: int, out: str | Path, *, name: str = "",
        thr: float = 0.40, excess: float = 0.20, pre_canal=PRE_CANAL, depths_m: dict | None = None,
        region_rings=None, region_name: str = "", workers: int = 3, progress=None, offline: bool = False) -> dict:
    """Fetch (unless offline) -> measure -> HORI -> out/finding.json. `region_rings` (zon.places rings) adds the
    same finding restricted to that region."""
    from . import places
    out = Path(out)
    if not offline:
        ev = fetch(lat, lon, km_ns, km_ew, range(start, end + 1), out, workers=workers, progress=progress)
        bad = [d for d, r in ev.items() if "error" in r]
        if bad:
            raise RiegoError(f"{len(bad)} dates could not be read (run again to retry): {bad[:5]}")
    d = load(out)
    years, pre = window_mean(d["ndvi"], pre_canal)
    green = green_mask(pre, thr, excess)
    verdict, effect = hori_trend(pre, years, d["lat"], d["x"])
    doc = {"id": "riego_" + (name or f"{lat}_{lon}"), "name": name, "center": [lat, lon], "box_km": [km_ns, km_ew],
           "method": {"product": "MOD13Q1 v061 (NDVI 250 m, 16 days)", "doi": "10.5067/MODIS/MOD13Q1.061",
                      "access": "ORNL DAAC MODIS subset service", "pre_canal_doys": list(pre_canal), "thr": thr, "excess": excess,
                      "measured": "NDVI per pixel; green area per year; HORI verdict per pixel (one FDR family)",
                      "inferred": "green before the canals open is taken as groundwater irrigation; it depends on the canal calendar",
                      "not_measured": "wells and volumes; the water bracket is hectares x the irrigation depths stated in depths_m"},
           "all": summarize(years, green, d["ha"], d["lat"], d["lon"], verdict=verdict, effect=effect, depths_m=depths_m),
           "evidence": {"dates": len(d["evidence"]),
                        "sha256": hashlib.sha256("".join(d["evidence"][k]["sha256"] for k in sorted(d["evidence"])).encode()).hexdigest()}}
    if region_rings is not None:
        la = np.broadcast_to(d["lat"][:, None], d["lon"].shape)
        inside = places.points_in_rings(region_rings, d["lon"].ravel(), la.ravel()).reshape(d["lon"].shape)
        doc["region"] = {"name": region_name, **summarize(years, green, d["ha"], d["lat"], d["lon"], verdict=verdict,
                                                          effect=effect, inside=inside, depths_m=depths_m)}
    (out / "finding.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    return doc
