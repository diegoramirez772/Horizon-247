"""Calibrate the swarm with REAL citizen reports: CoCoRaHS Condition Monitoring (USA, 2016-2026) against NASA POWER rain.

    PYTHONPATH=packages/zon/src:packages/hori/src python3 -I sim/swarm_validation_cocorahs.py
Data: data/cocorahs/cm_all.csv (public CSV of the CoCoRaHS condition-monitoring map; volunteers pick a scale from
«Severely Dry» to «Severely Wet» and write what they see). Instrument: NASA POWER PRECTOTCORR (cache, offline), rain
accumulated over the 3 months ending in the report's month, as a robust z against the same months of previous years.
Questions answered with numbers (docs/MODEL_CARD.md 3.16):
  1. How often does ONE citizen report agree with the satellite record? (and how often by pure chance?)
  2. Does agreement grow with the number of INDEPENDENT reporters in the same place and month? -> the swarm thresholds
  3. How good is the keyword classifier (no language model) at reading «dry / wet» from the free text?
Chance level: the same reports paired with the same cell and calendar month of ANOTHER year (keeps place and season).
"""
import csv
import json
import struct
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

from hori.api import accumulated_z, classify_report
from zon.fetch.power_zarr import PowerZarr

csv.field_size_limit(10 ** 8)
SCALE = {"Severely Dry": -3, "Moderately Dry": -2, "Mildly Dry": -1, "Near Normal": 0, "Mildly Wet": 1, "Moderately Wet": 2, "Severely Wet": 3}
THR = 1.0                                                                # «the instrument sees it»: |z| >= 1 in the same sense
SOURCE = "imerg" if "imerg" in sys.argv[1:] else "power"                 # second, independent rain source (satellite)

z = PowerZarr(offline=True)
months, lat, lon = z.axes
mpos = {m: i for i, m in enumerate(months)}
_, cy, cx = z.zarray("PRECTOTCORR")["chunks"]
reps = []
for r in csv.DictReader(open("data/cocorahs/cm_all.csv", encoding="utf-8", errors="replace")):
    if not r["the_geom"] or r["scalebar"] not in SCALE or r["reportdate"][:7] not in mpos or r["reportdate"] < "2016":
        continue
    b = bytes.fromhex(r["the_geom"])
    x, y = struct.unpack("<dd", b[9:25])
    iy, ix = int(round((y - lat[0]) / (lat[1] - lat[0]))), int(round((x - lon[0]) / (lon[1] - lon[0]))) % len(lon)
    reps.append({"station": r["stationnumber"], "date": r["reportdate"], "m": mpos[r["reportdate"][:7]], "iy": iy, "ix": ix,
                 "lat": y, "lon": x, "scale": SCALE[r["scalebar"]], "text": r["description"] or ""})
print(f"reportes usables: {len(reps):,} de {len({r['station'] for r in reps}):,} estaciones (personas)")

cells = sorted({(r["iy"], r["ix"]) for r in reps})
col = {c: k for k, c in enumerate(cells)}
X = np.full((len(months), len(cells)), np.nan)
by_chunk = defaultdict(list)
for c in cells:
    by_chunk[(c[0] // cy, c[1] // cx)].append(c)
if SOURCE == "power":
    for (rw, cl), cs in by_chunk.items():
        blk = z.read_block("PRECTOTCORR", rw, cl)
        for c in cs:
            X[: blk.values.shape[0], col[c]] = blk.values[:, c[0] - rw * cy, c[1] - cl * cx]
else:                                                                    # IMERG 1-degree cube, the cell that contains the report
    dd = np.load("data/imerg/imerg_monthly_1deg_2001-2025.npz", allow_pickle=False)
    im, rain = [str(m) for m in dd["months"]], dd["rain"]                 # load the cube ONCE (an npz re-reads on every access)
    rows = [k for k, m in enumerate(im) if m in mpos]
    tgt = [mpos[im[k]] for k in rows]
    iy = np.array([int(np.clip((90 - lat[c[0]]) // 1, 0, 179)) for c in cells])
    ix = np.array([int(np.clip((lon[c[1]] + 180) // 1, 0, 359)) for c in cells])
    X[tgt] = rain[rows][:, iy, ix]
Z = accumulated_z(X, 12, 3)
print(f"celdas POWER: {len(cells):,}; meses {months[0]}..{months[-1]}")

rng = np.random.default_rng(247)
def inst(r, shift_years=0):
    m = r["m"] + 12 * shift_years
    return Z[m, col[(r["iy"], r["ix"])]] if 0 <= m < len(months) else np.nan

zi = np.array([inst(r) for r in reps])
zn = np.array([inst(r, int(rng.choice([-5, -4, -3, 3, 4, 5]))) for r in reps])
sc = np.array([r["scale"] for r in reps])
ok, okn = np.isfinite(zi), np.isfinite(zn)

def rank_corr(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])

out = {"source": SOURCE, "n_reports": int(ok.sum()), "stations": len({r["station"] for r in reps}), "threshold_z": THR}
out["spearman_scale_vs_z"] = round(rank_corr(sc[ok], zi[ok]), 3)
out["spearman_chance"] = round(rank_corr(sc[okn], zn[okn]), 3)
single = {}
for name, sel, sgn in (("dry", sc < 0, -1), ("wet", sc > 0, 1), ("severely_dry", sc == -3, -1), ("severely_wet", sc == 3, 1),
                       ("mildly_dry", sc == -1, -1), ("mildly_wet", sc == 1, 1)):
    a, n_ = sel & ok, sel & okn
    single[name] = {"reports": int(a.sum()), "agree": round(float((sgn * zi[a] >= THR).mean()), 3),
                    "chance": round(float((sgn * zn[n_] >= THR).mean()), 3), "contradict": round(float((sgn * zi[a] <= -THR).mean()), 3)}
out["single_report"] = single

# the swarm: same 1-degree box, same month, same sense; k = independent reporters
groups = defaultdict(set)
gz, gzn = {}, {}
for r, a, b in zip(reps, zi, zn):
    if r["scale"] == 0 or not np.isfinite(a):
        continue
    key = (int(np.floor(r["lat"])), int(np.floor(r["lon"])), r["m"], 1 if r["scale"] > 0 else -1)
    groups[key].add(r["station"])
    gz.setdefault(key, []).append(a)
    gzn.setdefault(key, []).append(b)
by_k = defaultdict(lambda: [0, 0, 0, 0])
for key, st in groups.items():
    k = len(st)
    kb = "1" if k == 1 else "2" if k == 2 else "3-4" if k <= 4 else "5-9" if k <= 9 else "10+"
    sgn = key[3]
    a = np.nanmedian(gz[key])
    bn = np.nanmedian(gzn[key]) if np.isfinite(gzn[key]).any() else np.nan
    by_k[kb][0] += 1
    by_k[kb][1] += int(sgn * a >= THR)
    if np.isfinite(bn):
        by_k[kb][2] += 1
        by_k[kb][3] += int(sgn * bn >= THR)
out["swarm_by_independent_reporters"] = {k: {"signals": v[0], "agree": round(v[1] / v[0], 3), "chance": round(v[3] / max(v[2], 1), 3)}
                                         for k, v in sorted(by_k.items(), key=lambda kv: ["1", "2", "3-4", "5-9", "10+"].index(kv[0]))}

# the keyword classifier on the free text vs the scale the person picked
hit = cover = right = 0
for r in reps:
    if r["scale"] == 0:
        continue
    th, dirs = classify_report(r["text"])
    d = dirs.get("agua")
    hit += 1
    if d:
        cover += 1
        right += int((d == "bajo") == (r["scale"] < 0))
out["keyword_classifier"] = {"reports_with_dry_or_wet_scale": hit, "coverage": round(cover / hit, 3), "accuracy_when_it_reads": round(right / max(cover, 1), 3)}
Path("data/calibration").mkdir(parents=True, exist_ok=True)
Path(f"data/calibration/swarm_cocorahs{'_imerg' if SOURCE == 'imerg' else ''}.json").write_text(json.dumps(out, indent=1))
print(json.dumps(out, indent=1, ensure_ascii=False))
