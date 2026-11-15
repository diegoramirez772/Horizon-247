"""Build the IMERG monthly 1-degree rain cube (2001-2025). Needs EARTHDATA_TOKEN. Resumable.
    PYTHONPATH=packages/zon/src .venv/bin/python sim/imerg_fetch.py
"""
import time
from zon.fetch.imerg import build_cube
t = time.time()
p = build_cube("2001-01-01T00:00:00Z", "2025-12-31T23:59:59Z", "data/imerg/imerg_monthly_1deg_2001-2025.npz", "data/imerg/work",
               progress=lambda i, n, m: print(f"{i}/{n} {m} {time.time() - t:.0f}s", flush=True))
print("listo:", p, f"{time.time() - t:.0f}s")
