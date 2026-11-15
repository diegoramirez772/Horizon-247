"""Vertical 2 — Mars: the SAME HORI core on a different body (column dust optical depth, Montabone et al.).

    PYTHONPATH=packages/zon/src:packages/hori/src python3 sim/mars_demo.py
(1) trend per cell over the Martian years (run_layer, profile inferred, body = mars);
(2) anomalies in the daily global-mean series (detect_anomalies, period = 669 sols): does it see the 2018 global dust storm (MY34)?
"""
import json

import numpy as np

from hori.api import Config, Cube, anomaly_events, detect_anomalies, run_layer, write_bundle
from hori.verdict import CODES
from zon.fetch.mars_dust import load_mars_dust

d = load_mars_dust("data/mars")
a, yrs = d["annual"], d["years"]
cube = Cube(a.astype("float32"), np.isfinite(a), np.array([f"{y:04d}-01-01" for y in yrs]), d["lat"], d["lon"], d["meta"])
res = run_layer(cube, Config(), profile="auto")
m = res.manifest
print(f"Mars {yrs[0]}-{yrs[-1]} ({len(yrs)} años marcianos), {res.verdict.size} celdas, entidad {m['entity']['id']} ({m['entity']['body']}, {m['entity']['status']})")
print("perfil:", m["profile_spec"]["id"], "| δ:", m["params"]["delta_source"], round(m["params"]["delta_per_decade"] or 0, 4) if m["params"]["delta_per_decade"] else "= 2σ por celda")
print("veredictos:", {CODES[k]: int((res.verdict == k).sum()) for k in np.unique(res.verdict)})
print("banderas (reconstrucción=16):", int(((res.flags & 16) > 0).sum()), "celdas | calibración:", m["calibration"]["note"][:60])
w = np.cos(np.deg2rad(d["lat"]))[:, None] * np.ones((1, len(d["lon"])))
eff = res.effect.reshape(len(d["lat"]), -1)
print(f"tendencia media del planeta (área): {np.nansum(eff * w) / w.sum():+.4f} CDOD por 10 años marcianos")
write_bundle(res, "data/bundles/mars/dust_cdod610_MY24-MY36")
x, lab = d["daily_global"], d["daily_labels"]
r = detect_anomalies(x, 669)
ev = anomaly_events(r, lab, "CDOD")
print(f"\nanomalías en la serie diaria global ({len(x)} soles; se juzga desde el sol {r.warmup}, {lab[r.warmup]}):")
for e in ev:
    print(f"  {e['type']:12s} {e['t_start']} → {e['t_end']}  {e.get('peak_z', e.get('mean_z'))}σ {e['direction']} [{e['severity']}]")
