"""Z7: serve what was COMPUTED to the web as plain static files (no server logic, no network at view time).

    export_for_web("data/bundles", "apps/web/public/bundles")

Copies every bundle directory (manifest.json or timeline.json + arrays) and writes `index.json` next to them with
relative paths, kind, size and the SHA-256 of every file, so the web can verify what it loads and a demo recorded
from this folder works with the laptop offline (rule H10: demo de respaldo).
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path


# Plain names for the variables NASA POWER names in English (the web is Spanish-first)
_TITLES = {
    "T2M": {"es": "Temperatura del aire (2 m)", "en": "Air temperature (2 m)"},
    "PRECTOTCORR": {"es": "Lluvia", "en": "Rainfall"},
    "RH2M": {"es": "Humedad del aire", "en": "Air humidity"},
    "WS2M": {"es": "Viento", "en": "Wind"},
    "CDOD610": {"es": "Polvo en Marte", "en": "Dust on Mars"},
}


def _title(doc: dict, var: dict) -> dict | None:
    t, name = doc.get("title"), str(var.get("name") or "")
    if t and str(t.get("es", "")).upper() != name.upper():      # a real title, not the bare variable code
        return t
    return _TITLES.get(name.upper()) or t


def _entry(rel: str, d: Path) -> dict | None:
    if (d / "timeline.json").exists():
        doc, kind = json.loads((d / "timeline.json").read_text(encoding="utf-8")), "timeline"
    elif (d / "manifest.json").exists():
        doc = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        # a trend layer has no `kind`; the anomaly map says so, and the web must not open it as a trend layer
        kind = "anomaly" if doc.get("kind") == "anomaly_map" else "layer"
    else:
        return None
    var, win = doc.get("variable", {}), doc.get("window", doc.get("windows", {}))
    files = {f.name: {"bytes": f.stat().st_size, "sha256": hashlib.sha256(f.read_bytes()).hexdigest()}
             for f in sorted(d.iterdir()) if f.is_file()}
    end = win.get("end", (win.get("ends") or [None])[-1])
    return {"path": rel, "kind": kind, "id": doc.get("id") or d.name, "profile": doc.get("profile", "earth"),
            "title": _title(doc, var) or {"es": var.get("long_name") or var.get("name"), "en": var.get("long_name") or var.get("name")},
            "variable": var, "unit": var.get("unit"),
            "window": {"start": win.get("start"), "end": end, "n": win.get("n") or (len(win.get("ends", [])) or None)},
            "cells": (doc.get("entity") or {}).get("count") or (doc.get("grid", {}).get("nlat", 0) * doc.get("grid", {}).get("nlon", 0)) or None,
            "data_real": (doc.get("honesty") or {}).get("data_real", True),
            "last_month": (doc.get("dataset") or {}).get("last_month"),
            "has_events": (d / "events.json").exists(), "bytes": sum(v["bytes"] for v in files.values()), "files": files}


def export_for_web(src_root: str | Path, out_dir: str | Path, *, include: list[str] | None = None) -> dict:
    """Copy bundles under src_root (any depth with a manifest/timeline) to out_dir and write index.json. Idempotent."""
    src, out = Path(src_root), Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    entries = []
    for d in sorted({p.parent for p in src.rglob("manifest.json")} | {p.parent for p in src.rglob("timeline.json")}):
        rel = d.relative_to(src).as_posix()
        if include and not any(rel.startswith(i) for i in include):
            continue
        dst = out / rel
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(d, dst)
        e = _entry(rel, dst)
        if e:
            entries.append(e)
    for extra in ("updates.json",):                                   # the update log sits beside the bundles
        for f in src.rglob(extra):
            shutil.copy2(f, out / f.relative_to(src))
    # index.json is the ARRAY the web reads (IndexEntry[]: id, profile, title, variable, window{start,end,n}, path); the extra
    # fields (kind, files with SHA-256, last_month...) are additive and ignored by older readers
    (out / "index.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return {"bundles": len(entries), "bytes": sum(e["bytes"] for e in entries), "out": str(out)}
