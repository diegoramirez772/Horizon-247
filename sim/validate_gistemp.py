"""Validation of HORI's VERDICTS against an independent NASA source: GISTEMP v4 (stations + ships) vs POWER/MERRA-2.

    cd <data root> && PYTHONPATH=<repo>/packages/zon/src:<repo>/packages/hori/src python3 <repo>/sim/validate_gistemp.py

The earlier crosscheck (crosscheck_gistemp.py) compared slopes. This runs the WHOLE rule (three tests, FDR over the
land map, MDE, verdict) on both sources on the same 2-degree land cells and measures:
  - replication: of the cells PROBADO with POWER, how many are PROBADO with GISTEMP in the same direction (and back)
  - contradictions: PROBADO in both with opposite signs
  - verdict agreement: confusion matrix and Cohen's kappa over the 4 verdicts
  - regions (latitude bands, hemispheres, all land): HORI on the area-mean series of each source + the multi-source rule
Windows declared before looking: 1981-2025 (45 years) and 2001-2025 (25 years).
Land = GISTEMP cell centre inside a Natural Earth country (mask saved by crosscheck_gistemp.py). Ocean is excluded on
purpose: GISTEMP is sea SURFACE temperature there, POWER is air at 2 m. GISTEMP cells are not independent (1200 km).
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

from hori.api import Config, Cube, run_layer
from hori.multisource import combine_sources
from hori.verdict import CODES
from zon.fetch.gistemp import Gistemp

OUT = Path("data/validation")
OUT.mkdir(parents=True, exist_ok=True)
DELTA = 0.3                                   # same delta as the temperature class (°C/decade)
REGIONS = {"tierra_global": (-90, 90), "hemisferio_norte": (0, 90), "hemisferio_sur": (-90, 0), "artico_66N": (66, 90),
           "latitudes_medias_norte_23_66": (23, 66), "tropicos_23S_23N": (-23, 23), "sur_de_23S": (-90, -23)}


def power_to_2deg(pann, plat, plon, glat, glon):
    yi = np.array([int(np.argmin(np.abs(glat - la))) for la in plat])
    xi = np.array([int(np.argmin(np.abs(((glon - lo) + 180) % 360 - 180))) for lo in plon])
    w = np.cos(np.deg2rad(plat))
    agg = np.zeros((pann.shape[0], len(glat), len(glon)))
    wsum = np.zeros((len(glat), len(glon)))
    for r in range(len(plat)):
        np.add.at(agg[:, yi[r]], (slice(None), xi), np.nan_to_num(pann[:, r, :]) * w[r])
        np.add.at(wsum[yi[r]], xi, w[r])
    return agg / np.where(wsum > 0, wsum, np.nan)


def layer(values, years, lat, lon, name):
    t = np.array([f"{y}-01-01" for y in years])
    v = values.astype("float32")
    return run_layer(Cube(v, np.isfinite(v), t, lat, lon, {"variable": {"name": "T2M", "unit": "C"}, "native_resolution_deg": 2.0,
                                                         "dataset": {"name": name}}), Config(delta_per_decade=DELTA))


def kappa(a, b, labels):
    m = np.array([[np.sum((a == i) & (b == j)) for j in labels] for i in labels], float)
    n = m.sum()
    po = np.trace(m) / n
    pe = (m.sum(1) * m.sum(0)).sum() / n ** 2
    return m.astype(int).tolist(), round(float((po - pe) / (1 - pe)), 3), round(float(po), 3)


def area_mean(values, lat, mask):
    w = np.cos(np.deg2rad(lat))[:, None] * mask
    v = np.where(mask[None], values, np.nan)
    ok = np.isfinite(v)
    return np.nansum(v * w, axis=(1, 2)) / np.sum(w * ok, axis=(1, 2))


def main():
    t0 = time.time()
    g = Gistemp(local_file="data/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz")
    land = np.load("data/crosscheck/land_mask_2deg.npy")
    pz = np.load("data/planet/t2m_annual_1981-2025.npz")
    report = {"source_a": "NASA POWER (MERRA-2 reanalysis), annual anomalies", "source_b": "NASA GISTEMP v4 (GHCNv4 + ERSSTv5)",
              "grid": "GISTEMP 2 degrees, land only", "delta_per_decade": DELTA, "windows": {}}
    for S, E in ((1981, 2025), (2001, 2025)):
        gc = g.region_cube(None, S, E)
        glat, glon = gc.lat, gc.lon
        from hori.api import to_annual
        gann, gyears, _ = to_annual(gc.values, gc.time, 9)
        yrs = pz["years"].tolist()
        sel = [yrs.index(y) for y in range(S, E + 1)]
        pann = power_to_2deg(pz["annual"][sel], pz["lat"], pz["lon"], glat, glon)
        gann = np.where(land[None], gann, np.nan)
        pann = np.where(land[None], pann, np.nan)
        years = list(range(S, E + 1))
        rp, rg = layer(pann, years, glat, glon, "POWER"), layer(gann, years, glat, glon, "GISTEMP")
        vp, vg = rp.verdict.reshape(land.shape)[land], rg.verdict.reshape(land.shape)[land]
        ep, eg = rp.effect.reshape(land.shape)[land], rg.effect.reshape(land.shape)[land]
        both = (vp != 0) & (vg != 0)
        pp, pg = (vp == 1) & both, (vg == 1) & both
        rep_pg = pp & pg & (np.sign(ep) == np.sign(eg))
        contra = pp & pg & (np.sign(ep) != np.sign(eg))
        labels = [1, 2, 3, 4]
        conf, k, po = kappa(vp[both], vg[both], labels)
        win = {"cells_compared": int(both.sum()),
               "probado_power": int(pp.sum()), "probado_gistemp": int(pg.sum()),
               "replication_power_in_gistemp": round(float(rep_pg.sum() / max(1, pp.sum())), 3),
               "replication_gistemp_in_power": round(float(rep_pg.sum() / max(1, pg.sum())), 3),
               "probado_in_both_opposite_sign": int(contra.sum()),
               "sign_agreement_all_cells": round(float((np.sign(ep[both]) == np.sign(eg[both])).mean()), 3),
               "slope_correlation": round(float(np.corrcoef(ep[both], eg[both])[0, 1]), 3),
               "verdict_labels": [CODES[i] for i in labels], "confusion_power_rows_gistemp_cols": conf,
               "verdict_agreement": po, "cohen_kappa": k,
               "power_probado_where_gistemp": {CODES[i]: int((pp & (vg == i)).sum()) for i in labels}}
        regions = {}
        for name, (a, b) in REGIONS.items():
            m = land & (glat[:, None] >= a) & (glat[:, None] <= b)
            rs = {}
            for src, ann in (("power", pann), ("gistemp", gann)):
                s = area_mean(ann, glat, m)[:, None, None]
                r = layer(s, years, np.array([float(np.mean([a, b]))]), np.array([0.0]), src)
                rs[src] = {"source": src, "verdict": CODES[int(r.verdict[0])], "effect": round(float(r.effect[0]), 3),
                           "ci": [round(float(r.ci_lo[0]), 3), round(float(r.ci_hi[0]), 3)], "e": float(r.e_cons[0])}
            ms = combine_sources([rs["power"], rs["gistemp"]])
            regions[name] = {"cells": int(m.sum()), "power": rs["power"], "gistemp": rs["gistemp"],
                             "multisource": ms["label"], "magnitudes_compatible": ms.get("magnitudes_compatible")}
        win["regions"] = regions
        report["windows"][f"{S}-{E}"] = win
        print(S, E, json.dumps({k: v for k, v in win.items() if k != "regions"}), flush=True)
    report["gistemp_sha256"] = g.sha256
    report["seconds"] = round(time.time() - t0, 1)
    (OUT / "gistemp_validation.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps(report["windows"]["1981-2025"]["regions"], indent=1, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
