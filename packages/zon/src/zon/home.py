"""The web's start screen, «Mis monitores» (design doc «Modos de profundidad… v2» §5): for every followed place × variable,
the regional finding of HORI, since when it is knowable, what changed with the last window, the recent monthly anomalies
and the entity state (six answers, priority P0-P4). Writes `home.json` (contract §15).

Every number and every priority comes from hori.api; ZON only fetches, slices and packs. The web composes the three
reading levels (Simple / Normal / Experto) from these numbers and never recomputes a verdict.

    PYTHONPATH=packages/zon/src:packages/hori/src python3 -m zon.cli home --place Durango --var T2M --out apps/web/public/bundles
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

from hori.api import (EVENT_CODES, Config, Cube, anomaly_events, detect_anomalies, entity_state, physical_class,  # public API only
                      run_layer, run_timeline)

from .fetch.power_zarr import PowerZarr
from .places import PlaceIndex, cell_mask, regional_series
from .query import place_rings

HOME_CONTRACT = "0.9"
VERDICT_NAMES = {0: "INSUFICIENTE", 1: "PROBADO", 2: "CANDIDATA", 3: "NO_CONCLUYENTE", 4: "SIN_CAMBIO_MAYOR_QUE_DELTA"}
FLAG_NAMES = {1: "depende_del_metodo", 2: "cambio_de_version", 4: "cobertura_baja", 8: "resolucion_gruesa",
              16: "reconstruccion", 32: "simulado", 64: "autocorrelacion_alta", 128: "quiebre_posible"}
# Data-quality anomaly types go to the «Calidad de los datos» tray, never to «Cambios» (doc v2 §5.3).
QUALITY_TYPES = {"sin_datos", "congelado", "fuera_de_rango"}
# Variable names a person reads (the store only has codes). Short, with the article the plain sentence needs.
LABELS = {
    "T2M": {"es": "la temperatura", "en": "temperature"},
    "PRECTOTCORR": {"es": "la lluvia", "en": "rainfall"},
    "T2M_MAX": {"es": "la temperatura máxima", "en": "maximum temperature"},
    "T2M_MIN": {"es": "la temperatura mínima", "en": "minimum temperature"},
    "RH2M": {"es": "la humedad", "en": "humidity"},
}
KM_PER_DEG = 111.32


def _f(x, nd: int = 4):
    x = float(x)
    return round(x, nd) if np.isfinite(x) else None


def _version(v) -> str | None:
    """POWER writes a sentence ("POWER data version 10.0.0 uses…"): keep the number, or the text if there is none."""
    m = re.search(r"\d+\.\d+(?:\.\d+)?", str(v or ""))
    return f"v{m.group(0)}" if m else (str(v) if v else None)


def _flag_names(bits: int) -> list[str]:
    return [name for bit, name in FLAG_NAMES.items() if bits & bit]


def _place_cube(text: str, var: str, start: int, end: int, index: PlaceIndex, store: PowerZarr, pick: int = 0):
    """Monthly regional series of a place (same rule as zon.query.place_series) + the place and its grid facts."""
    hits = index.search(text)
    if not hits:
        raise LookupError(f"no place called {text!r} in the local index")
    place = hits[pick]
    months, lat, lon = store.axes
    mask, notes = cell_mask(place_rings(place, store.grid_step()), lat, lon)
    iy, ix = np.nonzero(mask.any(axis=1))[0], np.nonzero(mask.any(axis=0))[0]
    cube = store.region_cube(var, (float(lat[iy[0]]), float(lon[ix[0]]), float(lat[iy[-1]]), float(lon[ix[-1]])), start, end)
    sub = mask[iy[0]:iy[-1] + 1, ix[0]:ix[-1] + 1][::-1]
    series, info = regional_series(cube.values, cube.lat, sub)
    last = int(np.nonzero(np.isfinite(series))[0][-1]) + 1 if np.isfinite(series).any() else 0
    return place, cube, series[:last], list(cube.time[:last]), {**info, "n_cells": int(sub.sum()), "notes": notes,
                                                                 "alternatives": [h.name for h in hits[1:4]]}


def _trend(series, times, meta, cube, place, var: str, min_n: int) -> dict:
    """Regional verdict over the whole window (only full years), then the same rule over growing windows."""
    by_year: dict[str, int] = {}
    for t in times:
        by_year[t[:4]] = by_year.get(t[:4], 0) + 1
    full = [y for y in sorted(by_year) if by_year[y] == 12]                                 # a trend window ends on a complete year
    keep = [i for i, t in enumerate(times) if t[:4] in set(full)]
    ts, xs = [times[i] for i in keep], np.asarray(series, dtype="float32")[keep]
    rv = xs[:, None, None]
    ep = place.to_entity_place()
    rmeta = {**meta, "id": f"{meta['id']}_{place.name['en'].lower().replace(' ', '-')}_regional", "native_resolution_deg": 0.0,
             "regional": {"rule": "cos(lat)-weighted mean of monthly values; a month needs >= 80 % of the weight"}}
    res = run_layer(Cube(rv, np.isfinite(rv), np.array(ts), np.array([float(np.mean(cube.lat))]),
                         np.array([float(np.mean(cube.lon))]), rmeta), None, profile="auto",
                    place={**ep, "id": ep["id"] + "-regional"})
    p = res.manifest["params"]
    v = int(res.verdict[0])
    finding = {
        "verdict": v, "verdict_name": VERDICT_NAMES[v], "effect": _f(res.effect[0]), "ci": [_f(res.ci_lo[0]), _f(res.ci_hi[0])],
        "mde": _f(res.mde[0]), "delta": _f(res.delta[0]) if res.delta is not None else _f(p.get("delta_per_decade") or np.nan),
        "delta_source": p.get("delta_source"), "years_more": _f(res.years_more[0], 1), "flags": int(res.flags[0]),
        "flag_names": _flag_names(int(res.flags[0])), "p": _f(res.p_cons[0], 6), "q": _f(res.q_cons[0], 6), "n_sig": int(res.nsig_methods[0]),
        "sigma": _f(res.sigma[0]), "r1": _f(res.r1[0], 3), "n": int(res.manifest["window"]["n"]),
        "window": {"start": int(res.years[0]), "end": int(res.years[-1])},
        "break_year": _f(res.break_year[0], 0) if res.break_year is not None else None,
        "e_value": _f(res.e_cons[0], 3) if res.e_cons is not None else None,
        "ebh": bool(res.ebh_sig[0]) if res.ebh_sig is not None else None,
    }
    annual = res.series[0] if res.series is not None else None
    out = {"finding": finding, "series": {"years": [int(y) for y in res.years],
                                          "values": [_f(x) for x in annual] if annual is not None else []},
           "manifest": {k: res.manifest.get(k) for k in ("dataset", "params", "methods", "calibration", "build", "profile_spec")}}
    # Since when is it knowable (machine of time): the same rule on growing windows of the same annual series.
    if annual is not None and len(res.years) >= min_n:
        cfg = Config(delta_per_decade=finding["delta"]) if finding["delta"] is not None else Config()
        tl = run_timeline(np.asarray(annual, dtype=float)[:, None], [int(y) for y in res.years], cfg, min_n=min_n)
        d = tl.derived
        ev = int(d["event"][0])
        out["timeline"] = {
            "ends": tl.ends, "verdict": [int(x) for x in tl.verdict[:, 0]], "effect": [_f(x) for x in tl.effect[:, 0]],
            "emergence_year": _f(d["emergence_year"][0], 0),
            "first_probado": _f(d["first_probado_year"][0], 0),
            "withdrawals": int(d["reversals"][0]),
            "event": EVENT_CODES.get(ev, str(ev)),
            # the last growing window IS the full window: if they disagree something is wrong, and the page says so
            "consistent": int(tl.verdict[-1, 0]) == v,
        }
    return out


def _event(monitor: str, kind: str, key: str, tray: str, date: str, data: dict) -> dict:
    return {"id": f"{monitor}:{kind}:{key}", "monitor": monitor, "type": kind, "tray": tray, "date": date, **data}


def build_place(text: str, variables: list[str], start: int, end: int, *, index: PlaceIndex, store: PowerZarr,
                recent_months: int = 6, min_n: int = 15, pick: int = 0, now: str | None = None) -> dict:
    """One place: a monitor per variable + the entity state assembled by HORI over all of them."""
    monitors, events, trends, anomalies, sources = [], [], [], [], []
    place, recent_from = None, None
    for var in variables:
        place, cube, series, times, info = _place_cube(text, var, start, end, index, store, pick)
        if not times:
            continue
        meta = cube.meta
        unit = meta.get("variable", {}).get("unit", "")
        mid = f"mon-{place.to_entity_place()['id']}-{var.lower()}"
        tr = _trend(series, times, meta, cube, place, var, min_n)
        f = tr["finding"]
        # Monthly anomalies over the whole record (the monitor's detector), only the recent ones reach the state.
        params = {"transform": "sqrt"} if physical_class(meta.get("variable", {})) == "flujo_de_agua" else {}
        an = anomaly_events(detect_anomalies(np.asarray(series, dtype=float), 12, **params), [t[:7] for t in times], unit)
        rf = [t[:7] for t in times][-recent_months]
        recent_from = rf if recent_from is None else min(recent_from, rf)
        recent = [a for a in an if str(a["t_end"]) >= rf]
        label = LABELS.get(var, {"es": meta.get("variable", {}).get("name", var), "en": var})
        res_deg = float(meta.get("native_resolution_deg", 0.5) or 0.5)
        ds = meta.get("dataset", {})
        tl = tr.get("timeline") or {}
        mon = {
            "id": mid, "entity_id": place.to_entity_place()["id"], "variable": {"name": var, "unit": unit,
                                                                               "unit_per_decade": f"{unit}/década", "label": label},
            "finding": f, "series": tr["series"], "timeline": tl or None,
            "anomalies": [{**{k: a[k] for k in a if k in ("type", "t_start", "t_end", "severity", "peak_z", "mean_z", "n")},
                           "recent": str(a["t_end"]) >= rf} for a in an[-12:]],
            "data": {"last_month": times[-1][:7], "first_month": times[0][:7], "source": ds.get("name", "NASA POWER"),
                     "provider": ds.get("provider", "NASA"), "version": _version(ds.get("version")), "url": ds.get("url"),
                     "licence": ds.get("licence"), "data_real": ds.get("kind") != "simulated",
                     "n_cells": info["n_cells"], "resolution_deg": res_deg, "cell_km": round(res_deg * KM_PER_DEG),
                     "computed_at": tr["manifest"]["build"].get("created_at"), "input_sha256": tr["manifest"]["build"].get("input_sha256")},
            "method": {"methods": tr["manifest"]["methods"], "fdr_q": tr["manifest"]["params"]["fdr_q"],
                       "alpha": tr["manifest"]["params"]["alpha"], "calibration": tr["manifest"]["calibration"]["note"],
                       "family": "this place (1 regional series)"},
        }
        monitors.append(mon)
        sources.append({"name": ds.get("name"), "version": ds.get("version"), "url": ds.get("url")})
        t = {"variable": label["es"], "unit": unit, "verdict": f["verdict_name"], "effect": f["effect"] or 0.0,
             "ci": [f["ci"][0] or 0.0, f["ci"][1] or 0.0], "mde": f["mde"] or 0.0, "delta": f["delta"] or 0.0,
             "years_more": f["years_more"], "flags": f["flag_names"]}
        if tl.get("event") and tl["event"] not in ("NINGUNO", 0):
            t["event"] = str(tl["event"])
        trends.append(t)
        anomalies += [{**a, "variable": label["es"]} for a in recent]
        # Events, each with a stable id (the web's «since your last visit» cursor keys on it).
        if tl.get("emergence_year"):
            events.append(_event(mid, "EMERGENCIA", str(int(tl["emergence_year"])), "evidencia", str(int(tl["emergence_year"])),
                                 {"year": int(tl["emergence_year"]), "from": "NO_PROBADO", "to": "PROBADO"}))
        if t.get("event"):
            events.append(_event(mid, t["event"], str(f["window"]["end"]), "evidencia", str(f["window"]["end"]),
                                 {"year": f["window"]["end"]}))
        for a in recent:
            tray = "calidad" if a["type"] in QUALITY_TYPES else "evidencia"
            events.append(_event(mid, f"ANOMALIA_{a['type'].upper()}", str(a["t_start"]), tray, str(a["t_end"]),
                                 {k: a[k] for k in a if k in ("t_start", "t_end", "severity", "peak_z", "mean_z")}))
        if f["flags"] & 2:
            events.append(_event(mid, "CAMBIO_DE_VERSION", str(f["window"]["end"]), "calidad", str(f["window"]["end"]), {}))
    if place is None:
        raise LookupError(f"no data for {text!r}")
    ep = place.to_entity_place()
    entity = {"id": ep["id"], "type": "region", "body": "earth", "name": ep["name"], "status": "real",
              "source": {"name": "Natural Earth + NASA POWER (MERRA-2)"}}
    state = entity_state(entity, trends=trends, anomalies=anomalies, now=now, recent_from=recent_from, sources=sources)
    return {"entity": {**entity, "kind": place.kind, "alternatives": info["alternatives"], "geometry_note": info["notes"]},
            "monitors": monitors, "events": events, "state": _jsonable(state)}


def _jsonable(x):
    if isinstance(x, dict):
        return {k: _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_jsonable(v) for v in x]
    if isinstance(x, (np.floating, float)):
        return _f(x)
    if isinstance(x, np.integer):
        return int(x)
    return x


def build_home(places: list[str], variables: list[str], start: int, end: int, *, index: PlaceIndex, store: PowerZarr | None = None,
               out_dir: str | Path | None = None, now: str | None = None, **kw) -> dict:
    """All followed places -> home.json (contract §15). Ordered by HORI's priority, then by name; nothing is re-ranked."""
    z = store or PowerZarr(offline=True)
    entities = [build_place(p, variables, start, end, index=index, store=z, now=now, **kw) for p in places]
    rank = lambda e: (min([int(i["tier"]) for i in e["state"]["priority"]] or [9]), e["entity"]["name"]["es"])
    entities.sort(key=rank)
    doc = {"contract": HOME_CONTRACT, "kind": "home", "entities": entities,
           "events": sorted([ev for e in entities for ev in e["events"]], key=lambda x: (x["date"], x["id"]), reverse=True),
           "honesty": {"es": "Cada número y cada prioridad salen de HORI. Promedios regionales de celdas de ~50 km: no describen una calle. "
                             "Una anomalía es una desviación estadística, no prueba de peligro. Sin consejos.",
                       "en": "Every number and every priority comes from HORI. Regional means of ~50 km cells: they do not describe a street. "
                             "An anomaly is a statistical deviation, not evidence of danger. No advice."},
           "calibration": {"source": "docs/MODEL_CARD.md §3.1 and §3.9",
                           "fdr_probado_real_null": {"optimistic": 0.059, "pessimistic": 0.238},
                           "fdr_ebh_real_null": {"optimistic": 0.011, "pessimistic": 0.093},
                           "power_at_delta": {"optimistic": 0.697, "pessimistic": 0.462},
                           "sim_false_alarms": {"phi_0.3": 0.052, "phi_0.5": 0.068}, "sim_power_2sigma": {"phi_0.3": 0.92, "phi_0.5": 0.78},
                           "note": "Mapa del planeta (T2M 1981–2025, 30 realizaciones con nulo real). Una consulta regional es una familia de 1: su FDR no se midió aparte."}}
    if out_dir is not None:
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "home.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return doc
