"""Rain from TWO NASA sources: MERRA-2 (POWER, a reanalysis) vs GPM IMERG (satellite). Same places, same HORI rule.

    PYTHONPATH=packages/zon/src:packages/hori/src python3 sim/imerg_crosscheck.py
Per place, 2001-2025 monthly: correlation of monthly anomalies, the HORI trend of each source, «confirmado por N fuentes»
(hori.multisource), and the 3-month accumulated rain z in May 2011 (the northern-Mexico drought of the swarm demo).
"""
import json
from pathlib import Path

import numpy as np

from hori.api import Config, Cube, accumulated_z, run_layer
from hori.multisource import combine_sources
from hori.verdict import CODES
from zon.fetch.power_zarr import PowerZarr
from zon.places import PlaceIndex, cell_mask, regional_series
from zon.query import place_rings, place_series

d = np.load("data/imerg/imerg_monthly_1deg_2001-2025.npz", allow_pickle=False)
IR, IM, ILAT, ILON = d["rain"].astype(float), [str(m) for m in d["months"]], d["lat"], d["lon"]
P = "data/places/"
idx = PlaceIndex.from_natural_earth(P + "ne_10m_admin_0_countries.shp", P + "ne_10m_admin_1_states_provinces.shp")
z = PowerZarr(offline=True)


def regional_imerg(place):
    rings = place_rings(place, (1.0, 1.0))
    mask, _ = cell_mask(rings, ILAT, ILON)
    s, _ = regional_series(IR, ILAT, mask)
    return s, int(mask.sum())


def hori_trend(months, vals, name):
    v = np.asarray(vals, dtype="float32")[:, None, None]
    meta = {"variable": {"name": "PRECTOTCORR", "unit": "mm/day", "long_name": "precipitation"}, "dataset": {"kind": "satellite", "name": name},
            "native_resolution_deg": 0.0}
    r = run_layer(Cube(v, np.isfinite(v), np.array([m + "-01" for m in months]), np.array([0.0]), np.array([0.0]), meta), Config(), profile="auto")
    return {"source": name, "verdict": CODES[int(r.verdict[0])], "effect": float(r.effect[0]), "ci": [float(r.ci_lo[0]), float(r.ci_hi[0])],
            "e": float(r.e_cons[0])}


def anom(x, months):
    x = np.asarray(x, float).copy()
    mm = np.array([int(m[5:7]) for m in months])
    for k in range(1, 13):
        x[mm == k] -= np.nanmean(x[mm == k])
    return x


out = {}
for name in ("Durango", "Chihuahua", "Sonora", "Jalisco", "Oaxaca", "Texas", "California", "Kansas", "Florida", "Washington"):
    s = place_series(name, "PRECTOTCORR", 2001, 2025, index=idx, store=z)
    pm = s["months"]
    pv = np.asarray(s["values"], float)
    iv, ncell = regional_imerg(s["place"])
    common = [m for m in pm if m in IM]
    a = np.array([pv[pm.index(m)] for m in common])
    b = np.array([iv[IM.index(m)] for m in common])
    ok = np.isfinite(a) & np.isfinite(b)
    r_anom = float(np.corrcoef(anom(a, common)[ok], anom(b, common)[ok])[0, 1])
    ta, tb = hori_trend(common, a, "POWER (MERRA-2)"), hori_trend(common, b, "IMERG (GPM)")
    ms = combine_sources([ta, tb])
    za, zb = accumulated_z(a, 12, 3), accumulated_z(b, 12, 3)
    k = common.index("2011-05") if "2011-05" in common else None
    out[name] = {"months": len(common), "imerg_cells_1deg": ncell, "mean_mm_day": [round(float(np.nanmean(a)), 2), round(float(np.nanmean(b)), 2)],
                 "corr_monthly_anomalies": round(r_anom, 3), "trend_power": {k2: (round(v, 3) if isinstance(v, float) else v) for k2, v in ta.items() if k2 != "e"},
                 "trend_imerg": {k2: (round(v, 3) if isinstance(v, float) else v) for k2, v in tb.items() if k2 != "e"},
                 "multisource": {k2: ms[k2] for k2 in ("label", "confirmed_by")},
                 "z3_2011_05": [round(float(za[k]), 2), round(float(zb[k]), 2)] if k is not None else None}
    o = out[name]
    print(f"{name:11s} r_anom={o['corr_monthly_anomalies']:.2f}  media {o['mean_mm_day']}  POWER {ta['verdict']} {ta['effect']:+.3f}  "
          f"IMERG {tb['verdict']} {tb['effect']:+.3f}  -> {ms['label']}  z3(2011-05) {o['z3_2011_05']}")
Path("data/calibration/imerg_crosscheck.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
