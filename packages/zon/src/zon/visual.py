"""Imagery pack for the web globe: downloads NASA GIBS / Trek tiles once so the demo runs without internet (H10).

The web reads them from `apps/web/public/tiles/<provider>/<layer>/<date|static>/<z>/<row>/<col>.<ext>` when opened
with `?sinred=1` (apps/web/src/core/map/imagery.ts, `setTileRoot`). Same geographic grid as the live services:
GIBS level z spans 288/2^z degrees in 512 px tiles; Trek level z spans 180/2^z degrees in 256 px tiles.

Also answers which dates really have a picture over a place (`dates`): an empty GIBS tile is a ~1 KB transparent
PNG, a real one is tens to hundreds of KB (measured over Durango, 2026-11-15).

    python -m zon.visual pack  --layer BlueMarble_ShadedRelief_Bathymetry --levels 0-2
    python -m zon.visual pack  --layer MODIS_Terra_CorrectedReflectance_TrueColor --date 2026-11-10 --levels 0-2
    python -m zon.visual pack  --layer MODIS_Terra_CorrectedReflectance_TrueColor --date 2026-11-10 --bbox -106,23,-103,26 --levels 3-8
    python -m zon.visual dates --layer HLS_S30_Nadir_BRDF_Adjusted_Reflectance --lat 24.02 --lon -104.66 --start 2026-10-01 --end 2026-11-06

Stdlib only. Every file written is listed with its SHA-256 in `manifest.json` next to the tiles (provenance).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Same table as imagery.ts (id → provider, matrix set, extension, max level, daily, has date in the URL).
LAYERS: dict[str, tuple[str, str, str, int, bool]] = {
    "BlueMarble_ShadedRelief_Bathymetry": ("gibs", "500m", "jpeg", 7, False),
    "VIIRS_CityLights_2012": ("gibs", "500m", "jpeg", 7, False),
    "MODIS_Terra_CorrectedReflectance_TrueColor": ("gibs", "250m", "jpg", 8, True),
    "VIIRS_SNPP_CorrectedReflectance_TrueColor": ("gibs", "250m", "jpg", 8, True),
    "HLS_S30_Nadir_BRDF_Adjusted_Reflectance": ("gibs", "31.25m", "png", 11, True),
    "HLS_L30_Nadir_BRDF_Adjusted_Reflectance": ("gibs", "31.25m", "png", 11, True),
    "MODIS_Terra_Cloud_Fraction_Day": ("gibs", "2km", "png", 5, True),
    "IMERG_Precipitation_Rate": ("gibs", "2km", "png", 5, True),
    "MODIS_Terra_L3_NDVI_Monthly": ("gibs", "1km", "png", 6, True),
    "MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day": ("gibs", "2km", "png", 5, True),
    "LPRM_AMSR2_Surface_Soil_Moisture_C1_Band_Day_Daily": ("gibs", "2km", "png", 5, True),
    "MODIS_Combined_Flood_2-Day": ("gibs", "250m", "png", 8, True),
    "MODIS_Terra_NDSI_Snow_Cover": ("gibs", "500m", "png", 7, True),
    "MODIS_Terra_Aerosol": ("gibs", "2km", "png", 5, True),
    "GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies": ("gibs", "1km", "png", 6, True),
    "Mars_Viking_MDIM21_ClrMosaic_global_232m": ("trek", "Mars/EQ", "jpg", 7, False),
    "Mars_MGS_MOLA_ClrShade_merge_global_463m": ("trek", "Mars/EQ", "jpg", 6, False),
    "LRO_WAC_Mosaic_Global_303ppd_v02": ("trek", "Moon/EQ", "jpg", 6, False),
}

EMPTY_BYTES = 1500  # GIBS answers a ~1 KB transparent PNG where there is no data that day


def geometry(provider: str, z: int) -> tuple[float, int, int]:
    """(tile span in degrees, columns, rows) at level z."""
    if provider == "gibs":
        span = 288 / 2**z
        return span, math.ceil(360 / span - 1e-9), math.ceil(180 / span - 1e-9)
    span = 180 / 2**z
    return span, 2 ** (z + 1), 2**z


def tiles(provider: str, z: int, bbox: tuple[float, float, float, float]) -> list[tuple[int, int, int]]:
    span, cols, rows = geometry(provider, z)
    x0, y0, x1, y1 = bbox
    c0, c1 = max(0, math.floor((x0 + 180) / span)), min(cols - 1, math.floor((x1 + 180 - 1e-9) / span))
    r0, r1 = max(0, math.floor((90 - y1) / span)), min(rows - 1, math.floor((90 - y0 - 1e-9) / span))
    return [(z, r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]


def url(layer: str, z: int, r: int, c: int, date: str | None) -> str:
    provider, tms, ext, _, dated = LAYERS[layer]
    if provider == "gibs":
        d = f"{date}/" if dated and date else ""
        return f"https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{layer}/default/{d}{tms}/{z}/{r}/{c}.{ext}"
    return f"https://trek.nasa.gov/tiles/{tms}/{layer}/1.0.0/default/default028mm/{z}/{r}/{c}.{ext}"


def get(u: str, tries: int = 3) -> tuple[bytes, str | None]:
    for k in range(tries):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "HORIZON247-ZON/visual (NASA Space Apps 2026)"})
            with urllib.request.urlopen(req, timeout=30) as f:
                return f.read(), f.headers.get("layer-time-actual")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return b"", None
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(0.6 * 2**k)
    return b"", None


def parse_levels(s: str) -> list[int]:
    a, _, b = s.partition("-")
    return list(range(int(a), int(b or a) + 1))


def pack(layer: str, levels: list[int], bbox: tuple[float, float, float, float], date: str | None, out: Path, workers: int = 4) -> dict:
    provider, _, ext, max_level, dated = LAYERS[layer]
    if dated and not date:
        raise SystemExit(f"{layer} necesita --date")
    folder = out / provider / layer / (date if dated else "static")
    jobs = [t for z in levels if z <= max_level for t in tiles(provider, z, bbox)]
    written, empty, served = [], 0, set()

    def one(t: tuple[int, int, int]):
        z, r, c = t
        dest = folder / str(z) / str(r) / f"{c}.{ext}"
        if dest.exists() and dest.stat().st_size >= EMPTY_BYTES:
            return dest, dest.read_bytes(), None
        body, actual = get(url(layer, z, r, c, date))
        if len(body) < EMPTY_BYTES:
            return None, b"", actual
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        return dest, body, actual

    with ThreadPoolExecutor(workers) as pool:  # polite: 4 at a time, like the web
        for dest, body, actual in pool.map(one, jobs):
            if actual:
                served.add(actual[:10])
            if dest is None:
                empty += 1
                continue
            written.append({"path": str(dest.relative_to(out)), "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()})
    manifest = out / "manifest.json"
    data = json.loads(manifest.read_text()) if manifest.exists() else {"tiles": {}}
    data["tiles"].update({w["path"]: {"bytes": w["bytes"], "sha256": w["sha256"]} for w in written})
    data.setdefault("packs", []).append({
        "layer": layer, "date": date, "served_dates": sorted(served), "levels": levels, "bbox": list(bbox),
        "tiles": len(written), "empty": empty, "bytes": sum(w["bytes"] for w in written),
        "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    })
    out.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    return data["packs"][-1]


def dates(layer: str, lat: float, lon: float, start: str, end: str, level: int | None = None) -> list[dict]:
    """Which days have a real picture over (lat, lon): one small request per day at a mid level."""
    provider, _, _, max_level, dated = LAYERS[layer]
    if not dated:
        return [{"date": None, "bytes": -1, "has_image": True}]
    z = min(level if level is not None else max_level - 1, max_level)
    (zz, r, c), = tiles(provider, z, (lon, lat, lon, lat))
    d0, d1 = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    days = [(d0 + dt.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
    with ThreadPoolExecutor(4) as pool:
        sizes = list(pool.map(lambda d: len(get(url(layer, zz, r, c, d))[0]), days))
    return [{"date": d, "bytes": n, "has_image": n >= EMPTY_BYTES} for d, n in zip(days, sizes)]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="zon.visual", description="Imágenes de la NASA para el globo, también sin internet")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pack", help="descarga tiles para usarlos sin red")
    p.add_argument("--layer", required=True, choices=sorted(LAYERS))
    p.add_argument("--date")
    p.add_argument("--levels", default="0-2")
    p.add_argument("--bbox", default="-180,-90,180,90", help="lonMin,latMin,lonMax,latMax")
    p.add_argument("--out", default="apps/web/public/tiles")
    d = sub.add_parser("dates", help="qué días tienen imagen sobre un punto")
    d.add_argument("--layer", required=True, choices=sorted(LAYERS))
    d.add_argument("--lat", type=float, required=True)
    d.add_argument("--lon", type=float, required=True)
    d.add_argument("--start", required=True)
    d.add_argument("--end", required=True)
    d.add_argument("--level", type=int)
    a = ap.parse_args(argv)
    if a.cmd == "pack":
        bbox = tuple(float(v) for v in a.bbox.split(","))
        res = pack(a.layer, parse_levels(a.levels), bbox, a.date, Path(a.out))
        print(json.dumps(res, ensure_ascii=False))
    else:
        for row in dates(a.layer, a.lat, a.lon, a.start, a.end, a.level):
            print(f"{row['date']}  {'imagen' if row['has_image'] else 'sin imagen'}  {row['bytes']} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
