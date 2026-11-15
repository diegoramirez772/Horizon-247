"""The swarm + the six answers for ONE entity (Durango), with the REAL NASA record and SIMULATED citizen reports.

    PYTHONPATH=packages/zon/src:packages/hori/src python3 sim/swarm_demo.py [out_dir]
Scene (reports are SIMULATED and marked so; the instrument is real): spring 2011, northern Mexico drought. Neighbours report
the river drying, fish dying, the dam low; a verified scientist attaches a flow measurement; someone reports a dark sky;
one photo is reused by two accounts; a far-away report talks about cold. HORI groups, scores and checks against POWER.
Instrument rule = the one calibrated on real citizen reports (sim/swarm_validation_cocorahs.py): «agua» is seen when the
3-month accumulated rain is >= 1 sigma below the same months of previous years, in the months the reports cover.
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

from hori.api import Entity, accumulated_z, anomaly_events, detect_anomalies, entity_state, run_layer, Cube
from zon.fetch.power_zarr import PowerZarr
from zon.monitors import Monitor, MonitorStore
from zon.places import PlaceIndex
from zon.query import place_series, query_place
from zon.swarm import SwarmStore

out = Path(sys.argv[1] if len(sys.argv) > 1 else "data/swarm_demo")
shutil.rmtree(out, ignore_errors=True)
P = "data/places/"
idx = PlaceIndex.from_natural_earth(P + "ne_10m_admin_0_countries.shp", P + "ne_10m_admin_1_states_provinces.shp")
z = PowerZarr(offline=True)
NOW, FROM = "2011-06", "2011-03"                       # «as if HORI ran in June 2011»: only data up to then

series = {v: place_series("Durango", v, 1981, 2011, index=idx, store=z) for v in ("T2M", "PRECTOTCORR")}
for v in series:                                       # cut at NOW (causal: no future)
    k = series[v]["months"].index(NOW) + 1
    series[v]["months"], series[v]["values"] = series[v]["months"][:k], series[v]["values"][:k]
place = series["T2M"]["place"]
ent = Entity("earth-durango", "region", "earth", place.name, "real", source={"name": "Natural Earth + NASA POWER (MERRA-2)"}).to_dict()

# instrument check for the swarm
accz = accumulated_z(series["PRECTOTCORR"]["values"], 12, 3)   # same rule as the CoCoRaHS calibration
def instrument(theme, var, lat, lon, t0, t1):
    if var != "PRECTOTCORR":
        return None
    ms = series["PRECTOTCORR"]["months"]
    sel = [i for i, m in enumerate(ms) if t0[:7] <= m <= t1[:7] and np.isfinite(accz[i])]
    if not sel:
        return None
    i = min(sel, key=lambda k: accz[k])
    zz = float(accz[i])
    return {"seen": abs(zz) >= 1.0, "direction": "bajo" if zz < 0 else "alto",
            "detail": f"lluvia acumulada de 3 meses a {ms[i]}: {zz:+.1f}σ frente a los mismos meses de años previos (NASA POWER)"}

# simulated reports
tmp = Path(tempfile.mkdtemp())
for name, data in (("rio.jpg", b"foto-rio"), ("peces.jpg", b"foto-peces"), ("presa.jpg", b"foto-presa"), ("caudal.csv", b"fecha,caudal\n...")):
    (tmp / name).write_bytes(data)
from zon.signing import TrustRegistry, attest, public_key
uni_key = bytes(range(32))                              # a SIMULATED institution key (demo only)
trust = TrustRegistry()
trust.add("uni-demo", public_key(uni_key), "Universidad local (SIMULADA)", "institucion")
sw = SwarmStore(out / "swarm", clock=lambda: "2011-06-20T00:00:00Z", trust=trust)
R = [
    ({"reporter": {"id": "u-01", "type": "persona"}, "lat": 24.03, "lon": -104.65, "time": "2011-05-02T09:00", "text": "El río Tunal ya se secó"}, ["rio.jpg"]),
    ({"reporter": {"id": "u-02", "type": "persona"}, "lat": 24.05, "lon": -104.60, "time": "2011-05-06T18:30", "text": "Los peces del río se están muriendo"}, ["peces.jpg"]),
    ({"reporter": {"id": "u-03", "type": "persona"}, "lat": 24.10, "lon": -104.70, "time": "2011-05-10T12:00", "text": "No llueve y la presa está muy baja, el agua casi seca"}, ["presa.jpg"]),
    ({"reporter": {"id": "u-04", "type": "cientifico"}, "attestation": attest(uni_key, "uni-demo", "u-04", "cientifico", "2012-01-01"),
      "lat": 24.02, "lon": -104.66, "time": "2011-05-15T08:00", "text": "Medición: el caudal del río bajó 80 %, el río está casi seco"}, ["caudal.csv"]),
    ({"reporter": {"id": "u-05", "type": "persona"}, "lat": 24.04, "lon": -104.62, "time": "2011-05-12T19:00", "text": "El cielo está muy oscuro, hay mucho polvo"}, []),
    ({"reporter": {"id": "u-06", "type": "persona"}, "lat": 24.04, "lon": -104.61, "time": "2011-05-20T10:00", "text": "El río está seco"}, ["rio.jpg"]),
    ({"reporter": {"id": "u-07", "type": "persona"}, "lat": 25.50, "lon": -103.40, "time": "2011-05-21T07:00", "text": "Hace mucho frío"}, []),
]
for rep, files in R:
    sw.add_report({**rep, "simulated": True}, evidence=[tmp / f for f in files])
sigs = sw.signals(instrument=instrument)

# monitors (real NASA data) + swarm alerts on the same entity
ms = MonitorStore(out / "monitors", clock=lambda: "2011-06-20T00:00:00Z")
anoms = []
for v, unit in (("T2M", "°C"), ("PRECTOTCORR", "mm/día")):
    mid = f"mon-durango-{v.lower()}"
    ms.add_monitor(Monitor(mid, ent, {"name": v, "unit": unit}, 12, "mensual", {"valid_range": (-60, 60) if v == "T2M" else (0, 500)}))
    ms.ingest(mid, series[v]["months"], series[v]["values"])
    res = detect_anomalies(series[v]["values"], 12, valid_range=(-60, 60) if v == "T2M" else (0, 500))
    anoms += [{**e, "variable": v} for e in anomaly_events(res, series[v]["months"], unit)]
ms.open_swarm_alerts("mon-durango-prectotcorr", sigs)

trends = []
for v in ("T2M", "PRECTOTCORR"):
    q = query_place("Durango", v, 1981, 2010, index=idx, store=z)["regional"]
    from hori.verdict import CODES
    trends.append({"variable": v, "unit": q.manifest["variable"]["unit"], "verdict": CODES[int(q.verdict[0])], "effect": float(q.effect[0]),
                   "ci": [float(q.ci_lo[0]), float(q.ci_hi[0])], "mde": float(q.mde[0]), "delta": float(q.delta[0]),
                   "years_more": float(q.years_more[0]), "flags": [k for b, k in ((128, "quiebre_posible"), (64, "autocorrelacion_alta")) if int(q.flags[0]) & b]})

st = entity_state(ent, trends=trends, anomalies=anoms, swarm=sigs, alerts=ms.alerts(), recent_from=FROM,
                  sources=["NASA POWER (MERRA-2), real", "Reportes ciudadanos SIMULADOS (enjambre)"])
(out / "state.json").write_text(json.dumps(st, ensure_ascii=False, indent=1, default=str))
print("1 · Qué observamos:", st["entity"]["name"]["es"], f"({st['entity']['body']}, {st['entity']['status']})")
print("2 · Identidad:", st["identity"]["note"])
print("3 · Qué ocurre:", st["status"], "→", st["headline"]["es"])
print("4 · Qué cambió:", len(st["changes"]), "hallazgos   5 · Requiere atención:", len(st["attention"]))
print("6 · Seguimiento:", st["follow_up"])
print("\nPrioridad única:")
for it in [i for i in st["priority"] if i["tier"] <= 3]:
    print(f"  [{it['priority']}] {it['text_es']}")
print(f"  (+{sum(1 for i in st['priority'] if i['tier'] == 4)} informativos P4: anomalías viejas y reportes aislados)")
print("\nLo que no sabemos:")
for u in st["unknowns"]:
    print("  -", u)
print("\nSeñales del enjambre:")
for s in sigs:
    print(f"  {s['theme']:11s} {s['level']:28s} índice {s['score']:.2f}  reportantes {s['independent_reporters']}  avisos {s['flags']}")
print("cadena de reportes íntegra:", sw.verify(), "| bitácora de alertas íntegra:", ms.verify_audit())
