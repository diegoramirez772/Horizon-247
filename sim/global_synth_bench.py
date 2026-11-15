"""H2 compute-only benchmark: a synthetic planet (361 x 576 cells, AR(1) monthly noise), no network.

    PYTHONPATH=packages/hori/src python3 sim/global_synth_bench.py [years]
"""
import resource
import sys
import time

import numpy as np

from hori.api import Config, run_grid

years = int(sys.argv[1]) if len(sys.argv) > 1 else 24
NY, NX, C = 361, 576, 30
T = 12 * years
lat = np.linspace(90, -90, NY)
lon = -180 + 0.625 * np.arange(NX)
time_axis = [f"{2001 + k // 12}-{k % 12 + 1:02d}-01" for k in range(T)]
meta = {"id": "synthetic_planet", "variable": {"name": "T", "unit": "C"}, "dataset": {"kind": "simulated"},
        "native_resolution_deg": 0.5, "notes": []}


def blocks():
    rng = np.random.default_rng(247)
    for y0 in range(0, NY, C):
        for x0 in range(0, NX, C):
            by, bx = min(C, NY - y0), min(C, NX - x0)
            e = rng.standard_normal((T, by, bx)).astype("float32")
            for t in range(1, T):
                e[t] = 0.3 * e[t - 1] + 0.95 * e[t]
            yield y0, x0, e + 0.002 * np.arange(T, dtype="float32")[:, None, None] * (x0 < 288)


t0 = time.time()
res = run_grid(blocks(), lat, lon, time_axis, meta, Config(delta_per_decade=0.3))
el = time.time() - t0
print(f"synthetic planet, {years} years: {res.verdict.size} cells in {el:.1f} s, "
      f"peak RSS {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024:.0f} MB")
print("  ", {k: v for k, v in res.manifest["summary"].items() if v})
