"""Orchestrates one layer: fetch -> normalize -> hori.api.run_layer -> hori.api.write_bundle -> build_info.json.

Also keeps the web's bundles/index.json and bundles/regions.json up to date (adds or replaces only this layer).
"""
from __future__ import annotations
import json
import shutil
import time
from pathlib import Path

import numpy as np
import yaml

from hori import api as hori  # ZON uses HORI ONLY through hori.api

from . import __version__, regions as region_defs
from .fetch import gistemp, gpcp
from .provenance import now_utc

REPO = Path(__file__).resolve().parents[4]
LAYERS_DIR = Path(__file__).resolve().parent / "layers"
DEFAULT_DATA = REPO / "data"
DEFAULT_BUNDLES = REPO / "apps" / "web" / "public" / "bundles"


def layer_configs() -> dict[str, Path]:
    out = {}
    for p in sorted(LAYERS_DIR.glob("*.yaml")):
        with open(p, encoding="utf-8") as f:
            out[yaml.safe_load(f)["id"]] = p
    return out


def load_layer(layer_id: str) -> dict:
    cfgs = layer_configs()
    if layer_id not in cfgs:
        raise SystemExit(f"No existe la capa '{layer_id}'. Capas: {', '.join(cfgs)}")
    with open(cfgs[layer_id], encoding="utf-8") as f:
        return yaml.safe_load(f)


def make_cube(layer: dict, data_dir: Path, local_file: str | None, simulated_test: bool, log=print) -> hori.Cube:
    src = layer["source"]
    w = layer["window"]
    sources = {"gistemp": gistemp, "gpcp": gpcp}
    if src not in sources:
        raise SystemExit(f"La fuente '{src}' todavía no está hecha en ZON (hay: {', '.join(sources)}).")
    mod = sources[src]
    nc, prov = mod.fetch(str(data_dir / "raw" / src), local_file, log)
    log(f"Leyendo {nc} ({w['start']}-{w['end']})")
    raw = mod.read(nc, int(w["start"]), int(w["end"]))
    dataset = {**mod.DATASET, **prov}
    notes = [f"Último mes en el archivo usado: {raw['last_month']}."]
    if simulated_test:
        dataset = {**dataset, "name": f"PRUEBA SIMULADA con forma de {dataset['name']}", "provider": "prueba local",
                   "kind": "simulated", "url": ""}
        notes.insert(0, "Archivo de prueba con números inventados: NO son datos de la NASA.")
    meta = {
        "id": layer["id"], "profile": layer.get("profile", "earth"),
        "title": layer.get("title", {"es": layer["id"], "en": layer["id"]}),
        "variable": layer["variable"], "dataset": dataset,
        "native_resolution_deg": layer.get("grid", {}).get("native_resolution_deg"),
        "effective_resolution_note": layer.get("effective_resolution_note"),
        "aggregation": {"from": "monthly", "to": "annual"},
        "window": {"start": int(w["start"]), "end": int(w["end"]), "step": w.get("step", "annual")},
        "notes": notes,
    }
    values = raw["values"]
    return hori.Cube(values=values, valid=np.isfinite(values), time=raw["time"], lat=raw["lat"], lon=raw["lon"], meta=meta)


def build(layer_id: str, data_dir: str | None = None, bundles_dir: str | None = None,
          local_file: str | None = None, no_windows: bool = False, simulated_test: bool = False, log=print) -> dict:
    t0 = time.time()
    layer = load_layer(layer_id)
    data = Path(data_dir) if data_dir else DEFAULT_DATA
    bundles = Path(bundles_dir) if bundles_dir else DEFAULT_BUNDLES

    cube = make_cube(layer, data, local_file, simulated_test, log)
    cubes = data / "cubes"
    cubes.mkdir(parents=True, exist_ok=True)
    cube.to_npz(str(cubes / f"{layer_id}.npz"))

    cfg = hori.load_config()
    if no_windows:
        cfg.windows_expanding = False
    regs = region_defs.get(layer.get("regions"))
    log(f"HORI: analizando {cube.values.shape[1] * cube.values.shape[2]} celdas…")
    result = hori.run_layer(cube, cfg, regs)

    profile = layer.get("profile", "earth")
    out = bundles / profile / layer_id
    if out.exists():
        shutil.rmtree(out)                      # no stale windows/ from an older run
    hori.write_bundle(result, str(out))
    info = {"zon": __version__, "layer": layer_id, "created_at": now_utc(), "seconds": round(time.time() - t0, 1),
            "dataset": cube.meta["dataset"], "summary": result.manifest["summary"]}
    with open(out / "build_info.json", "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)

    _update_index(bundles, result.manifest, f"{profile}/{layer_id}/")
    _update_regions(bundles, result.regions, not cube.meta["dataset"]["kind"] == "simulated")
    log(f"Listo en {info['seconds']} s → {out}")
    log("Resumen: " + json.dumps(result.manifest["summary"], ensure_ascii=False))
    return info


def _update_index(bundles: Path, m: dict, path: str) -> None:
    p = bundles / "index.json"
    index = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    entry = {"id": m["id"], "profile": m["profile"], "title": m["title"], "variable": m["variable"]["name"],
             "window": {"start": m["window"]["start"], "end": m["window"]["end"], "n": m["window"]["n"]}, "path": path}
    index = [e for e in index if e.get("id") != m["id"]] + [entry]
    p.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _update_regions(bundles: Path, entries: list, real: bool) -> None:
    if not entries:
        return
    p = bundles / "regions.json"
    regions = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    by_id = {r["id"]: r for r in regions}
    for e in entries:
        r = by_id.get(e["id"])
        if r is None:
            r = {"id": e["id"], "name": e["name"], "layers": {}}
            regions.append(r)
            by_id[e["id"]] = r
        if real:
            r["name"] = e["name"]               # a real layer replaces a "(simulado)" name
        if e.get("bbox"):
            r["bbox"] = e["bbox"]
        if e.get("source"):
            r["source"] = e["source"]
        r.setdefault("layers", {})[e["layer"]] = e["data"]
    p.write_text(json.dumps(regions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
