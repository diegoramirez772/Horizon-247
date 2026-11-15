"""NSIDC-0051 monthly sea ice 1979-2025 -> extent per hemisphere (JSON) + 1 degree concentration cube + evidence.

    PYTHONPATH=packages/zon/src:packages/hori/src python3 sim/seaice_fetch.py data/earthdata/sea_ice
"""
import json
import sys
from pathlib import Path

from zon.fetch.seaice import build

out = Path(sys.argv[1] if len(sys.argv) > 1 else "data/earthdata/sea_ice")
ext, cube, ev = build(out, "1979-01-01", "2025-12-31", workers=4,
                      progress=lambda i, n, m: print(f"{i}/{n} {m}", file=sys.stderr, flush=True) if i % 50 == 0 else None)
(out / "extent.json").write_text(json.dumps(ext, indent=0))
(out / "evidence.json").write_text(json.dumps(ev, indent=1, ensure_ascii=False))
cube.write_npz(out / f"{cube.meta['id']}.npz")
print("ok", len(cube.time), "months", file=sys.stderr)
