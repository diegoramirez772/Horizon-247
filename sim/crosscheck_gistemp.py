"""Z1 + H12 check: POWER/MERRA-2 (reanalysis) against GISTEMP v4 (observations), 1981-2025, with HORI's own rule.

    PYTHONPATH=packages/zon/src:packages/hori/src python3 sim/crosscheck_gistemp.py

1. Durango (Natural Earth polygon): regional series from each source -> HORI verdict, Sen slope and interval.
2. Land map: POWER annual anomalies averaged (cos lat) into GISTEMP's 2-degree cells; per-cell Sen slopes compared.
3. Land-only global mean trend from each source.
Land = GISTEMP cell centre inside a Natural Earth admin-0 polygon. Ocean is excluded on purpose (SST vs 2 m air).
"""
import json
import time
from pathlib import Path

import numpy as np

from hori.api import Config, Cube, cell_stats, run_layer
from zon.fetch.gistemp import Gistemp
from zon.fetch.power_zarr import PowerZarr
from zon.places import PlaceIndex, cell_mask, regional_series

S, E = 1981, 2025
OUT = Path("data/crosscheck")
OUT.mkdir(parents=True, exist_ok=True)
t0 = time.time()
g = Gistemp(local_file="data/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz")
gc = g.region_cube(None, S, E)                                        # [T, 90, 180] north -> south
glat, glon = gc.lat, gc.lon
idx = PlaceIndex.from_natural_earth("data/places/ne_10m_admin_0_countries.shp", "data/places/ne_10m_admin_1_states_provinces.shp")
report = {"window": f"{S}-{E}"}


def regional_verdict(values, lat, lon, time_axis, mask, meta, label):
    series, info = regional_series(values, lat, mask)
    v = series.astype("float32")[:, None, None]
    m = {**meta, "native_resolution_deg": 0.0, "notes": []}
    r = run_layer(Cube(v, np.isfinite(v), np.array(time_axis), np.array([float(lat.mean())]), np.array([float(lon.mean())]), m),
                  profile="auto", place={"name": {"es": label, "en": label}, "source": {"name": "crosscheck"}})
    return {"verdict": ["INSUFICIENTE", "PROBADO", "CANDIDATA", "NO_CONCLUYENTE", "SIN_CAMBIO"][int(r.verdict[0])],
            "effect": round(float(r.effect[0]), 3), "ci": [round(float(r.ci_lo[0]), 3), round(float(r.ci_hi[0]), 3)],
            "p": float(r.p_cons[0]), "e": float(r.e_cons[0]), "n_cells": info["n_cells"]}


# 1 · Durango
dgo = idx.search("Durango")[0]
z = PowerZarr(offline=True)
plat_full = z.axes[1]
mask_p, _ = cell_mask(dgo.rings, plat_full, z.axes[2])
iy, ix = np.nonzero(mask_p.any(axis=1))[0], np.nonzero(mask_p.any(axis=0))[0]
pc = z.region_cube("T2M", (plat_full[iy[0]], z.axes[2][ix[0]], plat_full[iy[-1]], z.axes[2][ix[-1]]), S, E)
sub = mask_p[iy[0]:iy[-1] + 1, ix[0]:ix[-1] + 1][::-1]
gmask, gnotes = cell_mask(dgo.rings, glat[::-1], glon)                 # cell_mask expects any lat order; flip back after
gmask = gmask[::-1]
report["durango"] = {"power": regional_verdict(pc.values, pc.lat, pc.lon, pc.time, sub, pc.meta, "Durango POWER"),
                     "gistemp": regional_verdict(gc.values, glat, glon, gc.time, gmask, gc.meta, "Durango GISTEMP"),
                     "gistemp_cells_note": gnotes}

# 2 · land map at 2 degrees
pz = np.load("data/planet/t2m_annual_1981-2025.npz")
pann, plat, plon = pz["annual"], pz["lat"], pz["lon"]                 # [45, 361, 576], lat north -> south
yi = np.clip(np.searchsorted(-glat, -plat - 1.0), 0, len(glat) - 1)  # GISTEMP row containing each POWER row
yi = np.array([int(np.argmin(np.abs(glat - la))) for la in plat])
xi = np.array([int(np.argmin(np.abs(((glon - lo) + 180) % 360 - 180))) for lo in plon])
w = np.cos(np.deg2rad(plat))
agg = np.zeros((pann.shape[0], len(glat), len(glon)))
wsum = np.zeros((len(glat), len(glon)))
for r in range(len(plat)):                                            # cos-weighted block mean, row by row
    np.add.at(agg[:, yi[r]], (slice(None), xi), pann[:, r, :] * w[r])
    np.add.at(wsum[yi[r]], xi, w[r])
agg /= np.where(wsum > 0, wsum, np.nan)
land = np.zeros((len(glat), len(glon)), bool)
for p in idx.places:
    if p.kind == "country":
        m, notes = cell_mask(p.rings, glat, glon)
        if not notes:
            land |= m
years = [f"{y}-01-01" for y in range(S, E + 1)]
cfg = Config(delta_per_decade=0.3)
gs = cell_stats(gc.values, gc.time, cfg)
ps = cell_stats(agg.astype("float32"), years, cfg)
ge, pe = gs["effect"].reshape(land.shape), ps["effect"].reshape(land.shape)
ok = land & np.isfinite(ge) & np.isfinite(pe)
cw = np.cos(np.deg2rad(glat))[:, None] * np.ones(land.shape)
d = (pe - ge)[ok]
same_sign = float((np.sign(pe[ok]) == np.sign(ge[ok])).mean())
report["land_map_2deg"] = {
    "cells": int(ok.sum()),
    "slope_correlation": round(float(np.corrcoef(pe[ok], ge[ok])[0, 1]), 3),
    "same_sign_share": round(same_sign, 3),
    "power_minus_gistemp_mean": round(float(np.average(d, weights=cw[ok])), 3),
    "power_minus_gistemp_p10_p90": [round(float(np.quantile(d, 0.1)), 3), round(float(np.quantile(d, 0.9)), 3)],
    "land_mean_trend_power": round(float(np.average(pe[ok], weights=cw[ok])), 3),
    "land_mean_trend_gistemp": round(float(np.average(ge[ok], weights=cw[ok])), 3),
    "ocean_mean_trend_power_t2m": round(float(np.nanmean(np.where(~land, pe, np.nan)[np.isfinite(ge) & ~land])), 3),
    "ocean_mean_trend_gistemp_sst": round(float(np.nanmean(np.where(~land, ge, np.nan)[np.isfinite(ge) & ~land])), 3),
}
for name, (a, b) in {"arctic_66N": (66, 90), "tropics": (-23, 23), "mid_north_23_66": (23, 66), "south_lt_m23": (-90, -23)}.items():
    s = ok & (glat[:, None] >= a) & (glat[:, None] <= b)
    if s.any():
        report["land_map_2deg"][f"{name}_power_vs_gistemp"] = [round(float(np.average(pe[s], weights=cw[s])), 3),
                                                              round(float(np.average(ge[s], weights=cw[s])), 3)]
np.save(OUT / "land_mask_2deg.npy", land)
np.save(OUT / "power_slope_2deg.npy", pe)
np.save(OUT / "gistemp_slope_2deg.npy", ge)
report["seconds"] = round(time.time() - t0, 1)
report["gistemp_sha256"] = g.sha256
(OUT / "report.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
