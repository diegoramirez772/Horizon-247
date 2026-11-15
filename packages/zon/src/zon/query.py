"""Z8: «write any place» -> verdicts. Text -> place (local index) -> cells -> only the chunks that touch it -> HORI.

Two answers per query (doc 05 §4):
  cells     the per-cell map inside the place (one FDR family = the place's cells);
  regional  ONE series for the place (cos(lat)-weighted mean of the monthly values) tested by the same HORI rule.
The regional verdict is the claim about the place; the share of PROBADO cells is context only (with spatial
correlation, many significant cells do not prove a regional change — field significance is phase H5).
"""
from __future__ import annotations

import numpy as np

from .fetch.power_zarr import PowerZarr
from .places import Place, PlaceError, PlaceIndex, cell_mask, regional_series


def place_rings(place: Place, step: tuple[float, float] = (0.5, 0.625)) -> list[np.ndarray]:
    """Polygon of the place; a city (point) becomes the box of the cell that contains it."""
    if place.rings:
        return place.rings
    la, lo = place.point
    h, w = step[0] / 2, step[1] / 2
    return [np.array([[lo - w, la - h], [lo - w, la + h], [lo + w, la + h], [lo + w, la - h], [lo - w, la - h]])]


def query_place(text: str, var: str, start: int, end: int, *, index: PlaceIndex, store: PowerZarr | None = None,
                config=None, pick: int = 0) -> dict:
    """Returns {"place", "alternatives", "cells": LayerResult, "regional": LayerResult, "mask", "chunks"}."""
    from hori.api import Cube, run_layer                                   # public API only

    hits = index.search(text)
    if not hits:
        raise PlaceError(f"no place called {text!r} in the local index")
    place = hits[pick]
    z = store or PowerZarr()
    months, lat, lon = z.axes
    rings = place_rings(place, z.grid_step())
    mask, notes = cell_mask(rings, lat, lon)                               # on the full grid (lat ascending)
    iy, ix = np.nonzero(mask.any(axis=1))[0], np.nonzero(mask.any(axis=0))[0]
    bbox = (float(lat[iy[0]]), float(lon[ix[0]]), float(lat[iy[-1]]), float(lon[ix[-1]]))
    cube = z.region_cube(var, bbox, start, end)                            # lat north -> south inside the bbox
    sub = mask[iy[0]:iy[-1] + 1, ix[0]:ix[-1] + 1][::-1]                   # same orientation as the cube
    values = np.where(sub[None], cube.values, np.nan).astype("float32")    # cells outside the polygon -> missing
    ep = place.to_entity_place()
    meta = {**cube.meta, "notes": list(cube.meta.get("notes", [])) + notes,
            "place": {"query": text, "kind": place.kind, "n_cells": int(sub.sum())}}
    cells = run_layer(Cube(values, np.isfinite(values), np.array(cube.time), cube.lat, cube.lon, meta), config,
                      profile="auto", place=ep)
    series, info = regional_series(cube.values, cube.lat, sub)
    rmeta = {**meta, "id": f"{meta['id']}_regional", "native_resolution_deg": 0.0,
             "regional": {**info, "rule": "cos(lat)-weighted mean of monthly values; a month needs >= 80 % of the weight"}}
    rv = series.astype("float32")[:, None, None]
    regional = run_layer(Cube(rv, np.isfinite(rv), np.array(cube.time), np.array([float(np.mean(cube.lat))]),
                              np.array([float(np.mean(cube.lon))]), rmeta), config, profile="auto",
                         place={**ep, "id": ep["id"] + "-regional"})
    regional.manifest["entity"]["kind"] = "region_mean"
    return {"place": place, "alternatives": hits[1:], "cells": cells, "regional": regional, "mask": sub,
            "chunks": cube.meta["chunks"], "notes": notes}


def place_series(text: str, var: str, start: int, end: int, *, index: PlaceIndex, store: PowerZarr | None = None,
                 pick: int = 0) -> dict:
    """The MONTHLY regional series of a place (cos(lat)-weighted), for monitors: {"place", "months", "values", "info", "meta"}.

    Trailing months without data (the store reserves future months) are dropped, never invented."""
    hits = index.search(text)
    if not hits:
        raise PlaceError(f"no place called {text!r} in the local index")
    place = hits[pick]
    z = store or PowerZarr()
    months, lat, lon = z.axes
    mask, notes = cell_mask(place_rings(place, z.grid_step()), lat, lon)
    iy, ix = np.nonzero(mask.any(axis=1))[0], np.nonzero(mask.any(axis=0))[0]
    cube = z.region_cube(var, (float(lat[iy[0]]), float(lon[ix[0]]), float(lat[iy[-1]]), float(lon[ix[-1]])), start, end)
    sub = mask[iy[0]:iy[-1] + 1, ix[0]:ix[-1] + 1][::-1]
    series, info = regional_series(cube.values, cube.lat, sub)
    last = int(np.nonzero(np.isfinite(series))[0][-1]) + 1 if np.isfinite(series).any() else 0
    return {"place": place, "months": [t[:7] for t in cube.time[:last]], "values": series[:last], "info": {**info, "notes": notes},
            "meta": cube.meta}
