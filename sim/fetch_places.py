"""Download the local place index sources once (no account): Natural Earth 10m admin-0/admin-1 + GeoNames cities15000.

    PYTHONPATH=packages/zon/src python3 sim/fetch_places.py          # -> data/places/
Licences: Natural Earth = public domain; GeoNames = CC BY 4.0 (attribution in the UI and NOTICE).
"""
import hashlib
import json
import time
import zipfile
from pathlib import Path

from zon.net.http import PoliteHTTP

OUT = Path("data/places")
SRC = {
    "ne_10m_admin_0_countries.zip": "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip",
    "ne_10m_admin_1_states_provinces.zip": "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip",
    "cities15000.zip": "https://download.geonames.org/export/dump/cities15000.zip",
}
OUT.mkdir(parents=True, exist_ok=True)
http = PoliteHTTP(timeout=300)
prov = {}
for name, url in SRC.items():
    z = OUT / name
    if not z.exists():
        t = time.time()
        z.write_bytes(http.get(url).body)
        print(f"{name}: {z.stat().st_size / 1e6:.1f} MB in {time.time() - t:.0f} s")
    prov[name] = {"url": url, "sha256": hashlib.sha256(z.read_bytes()).hexdigest(), "bytes": z.stat().st_size}
    with zipfile.ZipFile(z) as zf:                       # data only; names are checked, nothing is executed
        for m in zf.namelist():
            if "/" not in m and not m.startswith(".") and m.rsplit(".", 1)[-1] in ("shp", "dbf", "shx", "prj", "cpg", "txt"):
                zf.extract(m, OUT)
(OUT / "provenance.json").write_text(json.dumps(prov, indent=2))
print("ok", sorted(p.name for p in OUT.iterdir()))
