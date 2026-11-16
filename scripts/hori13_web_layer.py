"""Recompute one web layer that carries its own annual series with the current HORI (1.3: e-BH in the verdict, robust
interval, significant regions) and refresh its entry in index.json. The series is the bundle's own: no download.

    PYTHONPATH=packages/hori/src python3 scripts/hori13_web_layer.py apps/web/public/bundles earth/global_t2m_2deg_1981-2025
"""
import hashlib
import json
import sys
import tempfile
from pathlib import Path

import numpy as np

from hori.api import Config, add_regions, run_grid, write_bundle

root, rel = Path(sys.argv[1]), sys.argv[2]
B = root / rel
old = json.loads((B / "manifest.json").read_text())
g, years = old["grid"], old["series"]["years"]
ny, nx, n = g["nlat"], g["nlon"], len(years)
series = np.fromfile(B / "series.f32", "<f4").reshape(ny * nx, n).T.reshape(n, ny, nx).astype(float)
lat = g["lat0"] + g["dlat"] * np.arange(ny)
lon = g["lon0"] + g["dlon"] * np.arange(nx)
meta = {"id": old["id"], "profile": old["profile"], "dataset": old["dataset"], "notes": old.get("warnings", []),
        "variable": {"name": old["variable"]["name"], "unit": old["variable"]["unit"]},
        "native_resolution_deg": g.get("native_resolution_deg", abs(g["dlat"]))}
p = old["params"]
cfg = Config(alpha=p["alpha"], fdr_q=p["fdr_q"], delta_per_decade=p["delta_per_decade"], min_years=p["min_valid_years"])
res = run_grid([(0, 0, series)], lat, lon, [f"{y}-01-01" for y in years], meta, cfg, keep_series=True)
R = add_regions(res, series, wrap=abs(nx * g["dlon"] - 360.0) < 1e-6)
res.manifest["params"]["delta_source"] = p.get("delta_source", "config")
with tempfile.TemporaryDirectory() as d:
    out = write_bundle(res, d, old["title"]["es"], old["title"]["en"])
    new = json.loads((out / "manifest.json").read_text())
    for k in set(old) - set(new):                              # entity card, profile spec...: computed upstream, kept
        new[k] = old[k]
    for f in out.iterdir():
        if f.name not in ("manifest.json", "series.f32"):      # the series is the input: untouched
            (B / f.name).write_bytes(f.read_bytes())
    (B / "manifest.json").write_text(json.dumps(new, ensure_ascii=False, indent=2), encoding="utf-8")
idx_path = root / "index.json"
idx = json.loads(idx_path.read_text())
for e in idx:
    if e.get("path") == rel:
        e["files"] = {f.name: {"bytes": f.stat().st_size, "sha256": hashlib.sha256(f.read_bytes()).hexdigest()}
                      for f in sorted(B.iterdir()) if f.is_file()}
        e["bytes"] = sum(v["bytes"] for v in e["files"].values())
idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
print("antes", old["summary"]["probado"], "PROBADO ->", new["summary"], "| regiones", new["regions"]["count"], "celdas", new["regions"]["cells"])
