"""Sea ice extent computed by ZON from NASA NSIDC-0051 vs the NSIDC Sea Ice Index (G02135 v4), and HORI's verdict.

    cd <data root> && PYTHONPATH=<repo>/packages/zon/src:<repo>/packages/hori/src python3 <repo>/sim/seaice_validation.py

What it checks: OUR processing (projection areas, 15 % threshold, pole hole) against NSIDC's official monthly
extent. It is NOT an independent satellite: G02135 is built from the same passive-microwave record (with its own
masks), so agreement validates the pipeline, not the instrument. Then HORI is run on the September (Arctic minimum)
and February/September series of both and the multi-source rule is applied.
"""
import csv
import io
import json
import urllib.request
from pathlib import Path

import numpy as np

from hori.api import Config, Cube, run_layer
from hori.multisource import combine_sources
from hori.verdict import CODES

URL = "https://noaadata.apps.nsidc.org/NOAA/G02135/{h}/monthly/data/{H}_{m:02d}_extent_v4.0.csv"
OUT = Path("data/validation")


def sii(hemi: str, month: int) -> dict:
    h = {"N": "north", "S": "south"}[hemi]
    body = urllib.request.urlopen(URL.format(h=h, H=hemi, m=month), timeout=60).read().decode()
    rows = list(csv.reader(io.StringIO(body)))
    out = {}
    for r in rows[1:]:
        try:
            v = float(r[4])
        except (ValueError, IndexError):
            continue
        if v > 0:                                        # -9999 = missing month in the index
            out[int(r[0])] = v
    return out


def hori_series(years, values, label):
    v = np.array(values, dtype="float32")[:, None, None]
    r = run_layer(Cube(v, np.isfinite(v), np.array([f"{y}-01-01" for y in years]), np.array([80.0]), np.array([0.0]),
                       {"variable": {"name": "SEA_ICE_EXTENT", "unit": "million km2"}, "native_resolution_deg": 0.0,
                        "dataset": {"name": label}}), Config(delta_per_decade=0.3))
    return {"source": label, "verdict": CODES[int(r.verdict[0])], "effect": round(float(r.effect[0]), 3),
            "ci": [round(float(r.ci_lo[0]), 3), round(float(r.ci_hi[0]), 3)], "e": float(r.e_cons[0]),
            "mde": round(float(r.mde[0]), 3)}


def main():
    ext = json.loads(Path("data/earthdata/sea_ice/extent.json").read_text())
    report = {"what": "ZON extent from NSIDC-0051 v2 vs NSIDC Sea Ice Index G02135 v4 (same microwave record)",
              "delta": "0.3 million km2 per decade (team working value)", "months": {}}
    for hemi in ("N", "S"):
        for m in range(1, 13):
            ours = {int(k[:4]): v / 1e6 for k, v in ext[hemi].items() if v and int(k[5:7]) == m}
            ref = sii(hemi, m)
            yrs = sorted(set(ours) & set(ref))
            a, b = np.array([ours[y] for y in yrs]), np.array([ref[y] for y in yrs])
            row = {"years": len(yrs), "bias_mkm2": round(float(np.mean(a - b)), 3), "bias_pct": round(float(100 * np.mean(a / b - 1)), 2),
                   "corr": round(float(np.corrcoef(a, b)[0, 1]), 4),
                   "corr_detrended": round(float(np.corrcoef(a - np.polyval(np.polyfit(yrs, a, 1), yrs),
                                                             b - np.polyval(np.polyfit(yrs, b, 1), yrs))[0, 1]), 4)}
            if (hemi, m) in (("N", 9), ("N", 3), ("S", 2), ("S", 9)):
                full = [y for y in range(1979, 2026) if y in ours and y in ref]
                if full == list(range(full[0], full[-1] + 1)):
                    po = hori_series(full, [ours[y] for y in full], "zon_nsidc0051")
                    pr = hori_series(full, [ref[y] for y in full], "nsidc_g02135")
                    base = np.mean([ref[y] for y in range(1981, 2011)])
                    row["hori"] = {"ours": po, "sea_ice_index": pr, "multisource": combine_sources([po, pr])["label"],
                                   "pct_per_decade_vs_1981_2010_ours": round(100 * po["effect"] / base, 1),
                                   "pct_per_decade_vs_1981_2010_index": round(100 * pr["effect"] / base, 1)}
                else:
                    row["hori"] = {"skipped": "gap in the years (1987-88 has missing months)", "years": full}
            report["months"][f"{hemi}{m:02d}"] = row
            print(hemi, m, {k: v for k, v in row.items() if k != "hori"}, row.get("hori", ""), flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "seaice_validation.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
