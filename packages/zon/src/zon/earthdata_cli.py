"""`zon earthdata ...` (kept apart so the main CLI does not import NumPy-heavy code for other commands)."""
from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

from . import earthdata as ed
from .fetch.earthdata_recipes import RECIPES


def _recipe(name: str) -> ed.Recipe:
    if name in RECIPES:
        return RECIPES[name]
    return ed.Recipe(**json.loads(Path(name).read_text(encoding="utf-8")))


def run(a) -> None:
    if a.action == "recipes":
        print(json.dumps({k: asdict(r) for k, r in RECIPES.items()}, indent=1, ensure_ascii=False))
    elif a.action == "search":
        gs = ed.granules(a.short_name, a.version, a.start, a.end)
        print(json.dumps({"collection": ed.collection(a.short_name, a.version), "granules": len(gs),
                          "first": gs[0].__dict__ if gs else None, "last": gs[-1].__dict__ if gs else None}, indent=1))
    elif a.action == "cube":
        r = _recipe(a.recipe)
        work = Path(a.out) / r.id
        prog = lambda i, n, t: print(f"\r{r.id}: {i}/{n} {t}", end="", file=sys.stderr, flush=True)
        cube, ev = ed.build_cube(r, work / "granules", workers=a.workers, progress=prog, limit=a.limit)
        npz = cube.write_npz(work / f"{cube.meta['id']}.npz")
        (work / "evidence.json").write_text(json.dumps(ev, indent=1, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({"cube": str(npz), "months": len(cube.time), "granules": len(ev["granules"]),
                          "cube_sha256": ev["cube_sha256"], "evidence": str(work / "evidence.json")}, indent=1), file=sys.stderr)
    elif a.action == "reproduce":
        ev = json.loads(Path(a.evidence).read_text(encoding="utf-8"))
        rep = ed.reproduce(ev, a.k)
        print(json.dumps(rep, indent=1))
        sys.exit(0 if rep["matches"] == rep["checked"] else 1)
