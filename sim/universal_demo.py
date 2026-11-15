"""One core, three kinds of entity: a region of the Earth, a region of Mars and a SIMULATED astronaut, all as MONITORS with
anomaly detection and alerts that have a lifecycle and an audit trail (the idea's functions 1, 2, 3, 5).

    PYTHONPATH=packages/zon/src:packages/hori/src python3 sim/universal_demo.py [out_dir]
"""
import shutil
import sys
from pathlib import Path

import numpy as np

from hori.api import Entity
from zon.fetch.mars_dust import load_mars_dust
from zon.fetch.power_zarr import PowerZarr
from zon.monitors import Monitor, MonitorStore
from zon.places import PlaceIndex
from zon.query import place_series
from zon.sim.astronaut import simulate_astronaut

out = Path(sys.argv[1] if len(sys.argv) > 1 else "data/monitors_demo")
shutil.rmtree(out, ignore_errors=True)
store = MonitorStore(out)

# 1) Earth: Washington state, monthly T2M 1981-2026 (NASA POWER, real)
P = "data/places/"
idx = PlaceIndex.from_natural_earth(P + "ne_10m_admin_0_countries.shp", P + "ne_10m_admin_1_states_provinces.shp")
s = place_series("Washington", "T2M", 1981, 2026, index=idx, store=PowerZarr(offline=True))
ent = Entity("earth-washington", "region", "earth", s["place"].name, "real", source={"name": "Natural Earth + NASA POWER (MERRA-2)"})
store.add_monitor(Monitor("mon-earth-washington-t2m", ent.to_dict(), {"name": "T2M", "unit": "°C"}, 12, "mensual"))
store.ingest("mon-earth-washington-t2m", s["months"], s["values"])

# 2) Mars: global-mean column dust optical depth, daily, Martian years 24-36 (NASA/LMD reconstruction, real)
m = load_mars_dust("data/mars")
ent = Entity("mars-global-dust", "planet_region", "mars", {"es": "Marte, global", "en": "Mars, global"}, "real",
             source={"name": "Montabone et al. (LMD), kriged maps", "licence": "CC BY-SA 3.0"})
store.add_monitor(Monitor("mon-mars-dust", ent.to_dict(), {"name": "cdod610", "unit": "CDOD"}, 669, "diaria (sol)"))
store.ingest("mon-mars-dust", m["daily_labels"], m["daily_global"])

# 3) A SIMULATED astronaut, three signals every 10 minutes
a = simulate_astronaut()
ent = Entity("human-astro-sim-01", "person", "human", {"es": "Astronauta simulado 01", "en": "Simulated astronaut 01"}, "simulada",
             source={"name": "generador determinista (semilla 247)"})
for name, sig in a["signals"].items():
    mid = f"mon-astro-{name.split('_')[0]}"
    store.add_monitor(Monitor(mid, ent.to_dict(), {"name": name, "unit": sig["unit"]}, a["period"], "10 min",
                              {"min_sigma": sig["resolution"]} if sig["resolution"] else {}))
    store.ingest(mid, a["times"], sig["values"])

print(f"{'monitor':26s} {'entidad':22s} {'estado':9s} alertas")
for mid, mon in store.monitors().items():
    al = store.alerts(mid)
    kinds = {}
    for x in al:
        kinds[x["type"]] = kinds.get(x["type"], 0) + 1
    print(f"{mid:26s} {mon.entity['id']:22s} {mon.entity['status']:9s} {len(al):3d}  {kinds}")
print("\nMarte: lo más fuerte →", max((x for x in store.alerts('mon-mars-dust')), key=lambda x: abs(x['evidence'].get('peak_z', x['evidence'].get('mean_z', 0))))["evidence"]["t_start"])
al = store.alerts("mon-astro-hr")
top = sorted(al, key=lambda x: -abs(x["evidence"].get("peak_z", 0)))[0]
store.transition(top["id"], "reconocida", actor="carolina", note="la miro el equipo")
store.transition(top["id"], "derivada", actor="carolina", note="a Diego para revisar el sensor")
store.transition(top["id"], "cerrada", actor="diego", note="pico de un solo muestreo: ruido del sensor")
ok, n = store.verify_audit()
print(f"\nciclo de vida de la alerta {top['id']}: {[h['from'] + '→' + h['to'] + ' (' + h['actor'] + ')' for h in store.alerts(state='cerrada')[0]['history']]}")
print(f"bitácora auditable: {n} registros, cadena SHA-256 {'íntegra' if ok else 'ROTA'}  → {out}")
