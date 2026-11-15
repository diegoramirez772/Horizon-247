"""Planet time machine: annual cube (from the chunk cache) -> expanding windows -> events, priority, reversal rates.

    PYTHONPATH=packages/zon/src:packages/hori/src python3 sim/planet_timeline.py T2M 1981 2025 [workers]
"""
import json
import resource
import sys
import time
from pathlib import Path

import numpy as np

from zon.fetch.power_zarr import PowerZarr
from zon.planet import annual_planet, build_timeline

var, start, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
workers = int(sys.argv[4]) if len(sys.argv) > 4 else 2
npz = Path("data/planet") / f"{var.lower()}_annual_{start}-{end}.npz"
t0 = time.time()
if not npz.exists():
    annual_planet(var, start, end, "data", store=PowerZarr(offline=True))
    print(f"annual cube: {npz} ({npz.stat().st_size / 1e6:.0f} MB) in {time.time() - t0:.0f} s", flush=True)
t0 = time.time()
out = f"data/bundles/earth/timeline_{var.lower()}_{start}-{end}"
st = build_timeline(npz, out, workers=workers, progress=lambda i, n: print(f"window {i}/{n} {time.time() - t0:.0f}s", flush=True))
final = st.pop("final_verdict")
print(f"timeline in {time.time() - t0:.0f} s, peak RSS (parent) {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024:.0f} MB")
print(json.dumps(st, ensure_ascii=False, indent=1))
ref = Path(f"data/bundles/earth/global_{var.lower()}_{start}-{end}/verdict.u8")
if ref.exists():
    r = np.fromfile(ref, "u1")
    print(f"last window vs global bundle: {int((r == final).sum())}/{r.size} verdicts equal")
