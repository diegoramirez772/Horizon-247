"""H2 benchmark: HORI over the WHOLE planet (POWER Zarr, chunk by chunk), time + peak RAM, and the Durango golden check.

    PYTHONPATH=packages/zon/src:packages/hori/src python3 sim/global_bench.py T2M 2001 2024 [--offline]
"""
import json
import resource
import sys
import time
from pathlib import Path

import numpy as np

from hori.api import Config, Cube, run_grid, run_layer, write_bundle
from zon.fetch.power_zarr import PowerZarr

var, start, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
z = PowerZarr(offline="--offline" in sys.argv)
gen, lat, lon, time_axis = z.grid_blocks(var, start, end)
at = z.attrs(var)
meta = {"id": f"powerzarr_{var}_global_{start}-{end}", "profile": "earth",
        "variable": {"name": var, "unit": at.get("units", ""), "long_name": at.get("long_name", ""),
                     "definition": at.get("definition", ""), "valid_min": at.get("valid_min"),
                     "valid_max": at.get("valid_max"), "cell_methods": at.get("cell_methods", "")},
        "dataset": {"name": "NASA POWER ARD (MERRA-2), Zarr on AWS", "kind": "reanalysis", "url": z.url, "time_standard": "LST"},
        "native_resolution_deg": 0.5, "native_resolution_lon_deg": 0.625, "notes": []}
cfg = Config()                                       # delta comes from the inferred profile
t0 = time.time()
res = run_grid(gen, lat, lon, time_axis, meta, cfg, profile="auto", sample=z.sample_values(var, start, end),
               progress=lambda i: print(f"\r{i} blocks", end="", file=sys.stderr))
el = time.time() - t0
print(file=sys.stderr)
peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
s = res.manifest["summary"]
print(f"{var} {start}-{end}: {res.verdict.size} cells in {el:.1f} s ({res.verdict.size / el:,.0f} cells/s), peak RSS {peak_mb:.0f} MB")
print("  verdicts:", {k: v for k, v in s.items()})
out = write_bundle(res, f"data/bundles/earth/global_{var.lower()}_{start}-{end}")
size = sum(f.stat().st_size for f in out.iterdir())
print(f"  bundle {out} = {size / 1e6:.1f} MB")

# golden: the 72 Durango cells inside the global grid vs the committed example (same per-cell numbers expected)
gold = Path("contract/examples/earth") / f"power_{var.lower()}_dgo_{start}-{end}"
if gold.is_dir():
    g = json.loads((gold / "manifest.json").read_text())["grid"]
    iy = [int(np.argmin(abs(lat - (g["lat0"] + k * g["dlat"])))) for k in range(g["nlat"])]
    ix = [int(np.argmin(abs(lon - (g["lon0"] + k * g["dlon"])))) for k in range(g["nlon"])]
    idx = (np.array(iy)[:, None] * len(lon) + np.array(ix)[None, :]).ravel()
    for name in ("effect", "p_cons", "mde", "sigma", "r1", "nsig_methods"):
        dt = "<f4" if name != "nsig_methods" else "u1"
        ref = np.fromfile(gold / f"{name}.{'u8' if dt == 'u1' else 'f32'}", dtype=dt)
        got = getattr(res, name)[idx].astype(dt)
        print(f"  golden {name}: identical={np.array_equal(ref, got)}")
    ref_v = np.fromfile(gold / "verdict.u8", dtype="u1")
    got_v = res.verdict[idx]
    chg = [(int(a), int(b)) for a, b in zip(ref_v, got_v) if a != b]
    print(f"  golden verdict: {72 - len(chg)}/72 equal; changes (Durango-only FDR -> planet FDR): {chg}")
