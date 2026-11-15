"""Z0 check with MANY chunks: fetch + decode every chunk of one POWER variable, report time, size and sanity.

    PYTHONPATH=packages/zon/src python3 sim/zarr_global_fetch.py T2M
"""
import sys
import time

import numpy as np

from zon.fetch.power_zarr import PowerZarr

var = sys.argv[1] if len(sys.argv) > 1 else "T2M"
z = PowerZarr(workers=int(sys.argv[2]) if len(sys.argv) > 2 else 8)
ny, nx = z.n_chunks(var)
coords = [(r, c) for r in range(ny) for c in range(nx)]
at = z.attrs(var)
t0 = time.time()
months, cells, nan, lo, hi, k = set(), 0, 0, np.inf, -np.inf, 0
for b in z.iter_blocks(var, coords):                     # streamed: RAM ~ prefetch window, not 260 chunks
    k += 1
    months.add(b.months[-1])
    cells += b.values.shape[1] * b.values.shape[2]
    nan += int(np.isnan(b.values).sum())
    lo, hi = min(lo, float(np.nanmin(b.values))), max(hi, float(np.nanmax(b.values)))
    print(f"{k}/{len(coords)} {time.time() - t0:.0f}s", file=sys.stderr, flush=True)
el = time.time() - t0
s = z.prov.summary()
blocks = range(k)
print(f"{var}: {len(blocks)} chunks, {cells} cells, last months {sorted(months)}, {el:.1f} s "
      f"({s['from_network']} from network, {s['from_cache']} cached), NaN {nan}, range [{lo:.2f}, {hi:.2f}] "
      f"vs valid [{at.get('valid_min')}, {at.get('valid_max')}]")
