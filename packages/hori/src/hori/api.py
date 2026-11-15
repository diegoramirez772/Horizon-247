"""Public, stable API of HORI. ZON and any other client must use ONLY this module.

    result = run_layer(Cube.from_npz("cube.npz"), Config())
    write_bundle(result, "bundles/earth/<id>")
"""
from __future__ import annotations

import hashlib
import itertools
import json
import warnings
import os
import platform
import time
from pathlib import Path

import numpy as np

from . import __version__
from .aggregate import prepare, to_annual
from .config import Config
from .cube import Cube
from .detect import YEARS_CAP, mde_per_decade, years_more
from .evalue import combine_mean, ebh, mixture_e
from .fdr import bh_adjust
from .identity import PROFILES_VERSION, Entity, IdentityError, Profile, auto_entity, check_pair, infer_profile
from .quality import detect_breaks
from .result import LayerResult
from .stats import Z_CRIT, analyze, p_two
from .verdict import (CODES, FLAG_BITS, F_QUIEBRE_POSIBLE, NO_CONCLUYENTE, F_AUTOCORR_ALTA, F_COBERTURA_BAJA, F_DEPENDE_METODO, F_RECONSTRUCCION,
                      F_RESOLUCION_GRUESA, F_SIMULADO, decide)

__all__ = ["Config", "Cube", "Entity", "IdentityError", "LayerResult", "Profile", "cell_stats", "infer_profile", "auto_entity", "run_grid",
           "run_timeline", "summarize", "to_annual", "Timeline", "EVENT_CODES", "TIER_CODES",
           "run_layer", "write_bundle"]
CONTRACT = "0.4"
METHODS = ["MK-VC", "TFPW-WS", "OLS-AR1"]
CALIBRATION_NOTE = ("Measured by simulation (AR(1) Gaussian noise, n=23): false alarms 5.2% (phi=0.3) and 6.8% (phi=0.5); "
                    "power 92% / 78% at 2 sigma per decade. Illustrates, does not prove, behaviour on real data. See sim/.")


def input_sha256(cube: Cube) -> str:
    """Hash of exactly what HORI reads (values, axes, variable): same input -> same hash, whatever the download time."""
    h = hashlib.sha256()
    for a in (np.ascontiguousarray(cube.values, dtype="<f4"), np.asarray(cube.time).astype(str),
              np.asarray(cube.lat, dtype="<f8"), np.asarray(cube.lon, dtype="<f8")):
        h.update(a.tobytes())
    h.update(json.dumps(cube.meta.get("variable", {}), sort_keys=True).encode())
    return h.hexdigest()


def _r(x) -> float:
    return round(float(x), 4)


def _created_at() -> str:
    """Wall clock, unless SOURCE_DATE_EPOCH is set (reproducible builds: byte-identical bundles)."""
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(epoch) if epoch else None))


def _resolve(meta: dict, config: Config | None, entity: Entity | None, profile: Profile | str | None, sample=None,
             time=None, lat=None, lon=None, place: dict | None = None, in_sha: str = ""):
    """L0: build the profile (profile="auto" infers it) and the entity card (created for this query if not given),
    check the pair, and return the config actually used and where delta came from."""
    cfg = config or Config()
    if isinstance(profile, str):
        if profile != "auto":
            raise IdentityError(f"profile must be a Profile or 'auto' (hand-written profiles are gone), got {profile!r}")
        profile = infer_profile(meta.get("variable", {}), sample, time, body=meta.get("body", "earth"),
                                delta_sigma=cfg.delta_sigma_per_decade)
    if profile is None:
        if entity is not None:
            raise IdentityError("an entity needs a profile (use profile='auto')")
        return cfg, ("config" if cfg.delta_per_decade is not None else "sigma"), None, None
    if entity is None:
        entity = auto_entity(meta, lat, lon, place=place, input_sha256=in_sha)
    check_pair(entity, profile, meta.get("variable", {}).get("name", ""), meta.get("dataset", {}).get("kind"))
    cfg, delta_source = profile.apply(cfg)
    return cfg, delta_source, profile, entity


def cell_stats(values: np.ndarray, time, cfg: Config) -> dict:
    """Steps 1-6 for a block [T, Y, X]: everything per cell that does NOT depend on the other cells (no FDR yet).

    Cells are flattened row-major (north -> south, west -> east). Vectorized over cells; memory ~ cells x n.
    """
    annual, years, anomaly = to_annual(values, time, cfg.min_months)
    n = len(years)
    Z = annual.reshape(n, -1).T.astype(float)
    cells = Z.shape[0]
    series, nvalid, usable, filled = prepare(Z, cfg.min_years, cfg.min_valid_fraction, cfg.max_interior_gap_years)
    nan = lambda: np.full(cells, np.nan)
    st = {k: nan() for k in ("effect", "ci_lo", "ci_hi", "sigma", "r1", "p_cons", "mde", "years_more", "delta", "e_cons")}
    st.update(nsig=np.zeros(cells, dtype=np.uint8), naive=np.zeros(cells, dtype=np.uint8), usable=usable,
              filled=filled, nvalid=nvalid, series=series, years=years, anomaly=anomaly,
              break_flag=np.zeros(cells, dtype=bool), break_year=nan())
    if usable.any():
        s = analyze(series[usable], cfg.tfpw_ws_iterations)
        ps = {"MK-VC": p_two(s["z_vc"]), "TFPW-WS": p_two(s["z_ws"]), "OLS-AR1": p_two(s["z_ols"])}
        used = [ps[m] for m in cfg.methods]
        eff = s["sen"] * 10.0
        half = Z_CRIT * s["se_ols"] * 10.0
        st["effect"][usable], st["ci_lo"][usable], st["ci_hi"][usable] = eff, eff - half, eff + half
        st["sigma"][usable], st["r1"][usable] = s["sigma"], s["r1"]
        st["p_cons"][usable] = np.maximum.reduce(used)
        st["nsig"][usable] = sum((p <= cfg.alpha).astype(int) for p in used).astype(np.uint8)
        st["naive"][usable] = (np.abs(s["z_naive"]) > Z_CRIT).astype(np.uint8)
        st["mde"][usable] = mde_per_decade(s["sigma"], s["r1"], n)
        st["delta"][usable] = cfg.delta_per_decade if cfg.delta_per_decade is not None else cfg.delta_sigma_per_decade * s["sigma"]
        st["years_more"][usable] = years_more(st["mde"][usable], st["delta"][usable], n)
        zs = {"MK-VC": s["z_vc"], "TFPW-WS": s["z_ws"], "OLS-AR1": s["z_ols"]}
        with np.errstate(divide="ignore", invalid="ignore"):
            tau = st["delta"][usable] / (10.0 * s["se_ols"])                # delta in z units, fixed before the effect
        st["e_cons"][usable] = combine_mean([mixture_e(zs[m], tau) for m in cfg.methods])   # parallel; does not decide
        bflag, where, _ = detect_breaks(series[usable])                   # L1: possible step (flag only, verdict untouched)
        st["break_flag"][usable] = bflag
        st["break_year"][usable] = np.where(where >= 0, np.asarray(years, dtype=float)[np.clip(where, 0, n - 1)], np.nan)
    return st


def _finish(st: dict, meta: dict, cfg: Config, delta_source: str, entity, profile, grid: dict, in_sha: str,
            keep_series: bool = True) -> LayerResult:
    """Steps 5 and 7 over ALL cells at once (BH across the whole map, then verdicts and flags) + the manifest."""
    usable, nsig, r1 = st["usable"], st["nsig"], st["r1"]
    years, n, cells = st["years"], len(st["years"]), usable.shape[0]
    q = bh_adjust(st["p_cons"])
    with np.errstate(invalid="ignore"):
        verdict = decide(usable, q, nsig, st["mde"], st["delta"], cfg.fdr_q, len(cfg.methods))
    flags = np.zeros(cells, dtype=np.uint8)
    flags[usable & (nsig >= 1) & (nsig < len(cfg.methods))] |= F_DEPENDE_METODO
    flags[st["filled"]] |= F_COBERTURA_BAJA
    with np.errstate(invalid="ignore"):
        flags[usable & (r1 > 0.5)] |= F_AUTOCORR_ALTA
    flags[usable & st["break_flag"]] |= F_QUIEBRE_POSIBLE
    ds = meta.get("dataset", {})
    if float(meta.get("native_resolution_deg", 0) or 0) >= cfg.coarse_resolution_deg:
        flags[usable] |= F_RESOLUCION_GRUESA
    if ds.get("kind") == "reconstruction":
        flags[usable] |= F_RECONSTRUCCION
    if ds.get("kind") == "simulated":
        flags[usable] |= F_SIMULADO

    simulated = ds.get("kind") == "simulated"
    var = meta.get("variable", {})
    ebh_sig = ebh(st["e_cons"], cfg.fdr_q)
    summary = {"cells_valid": int(usable.sum()), "naive_marked": int(st["naive"].sum()),
               "ebh_discoveries": int(ebh_sig.sum()), "bh_discoveries": int((usable & (q <= cfg.fdr_q)).sum()),
               "quiebre_posible": int((usable & st["break_flag"]).sum()),
               **{CODES[c].lower(): int((verdict == c).sum()) for c in CODES}}
    detectability = _detectability(usable, st["mde"], st["delta"], st["years_more"], verdict, n)
    manifest = {
        "contract": CONTRACT, "id": meta.get("id", "layer"), "profile": meta.get("profile", "earth"),
        "variable": {"name": var.get("name", ""), "unit": var.get("unit", ""), "unit_per_decade": f"{var.get('unit', '')}/década"},
        "entity": {"kind": "region_cell", "body": "earth", "count": cells, "valid": int(usable.sum())},
        "grid": grid,
        "dataset": ds,
        "window": {"start": years[0], "end": years[-1], "n": n, "step": "annual",
                   "aggregation": f"mean of monthly anomalies; >= {cfg.min_months}/12 months per year" if st["anomaly"] else "annual input"},
        "params": {"alpha": cfg.alpha, "fdr_q": cfg.fdr_q, "delta_sigma_per_decade": cfg.delta_sigma_per_decade,
                   "delta_per_decade": cfg.delta_per_decade, "delta_source": delta_source, "min_valid_years": cfg.min_years,
                   "min_months": cfg.min_months},
        "detectability": detectability,
        "methods": list(cfg.methods), "verdict_codes": {str(k): v for k, v in CODES.items()},
        "flag_bits": {str(k): v for k, v in FLAG_BITS.items()}, "summary": summary,
        "calibration": {"note": CALIBRATION_NOTE if tuple(cfg.methods) == tuple(METHODS) else
                        "NOT calibrated: this method set was not simulated; treat PROBADO as provisional."},
        "honesty": {"data_real": not simulated, "simulated": simulated,
                    "label_es": "Datos simulados" if simulated else f"Datos reales: {ds.get('name', 'NASA')}",
                    "label_en": "Simulated data" if simulated else f"Real data: {ds.get('name', 'NASA')}"},
        "warnings": list(meta.get("notes", [])),
        "build": {"hori": __version__, "python": platform.python_version(), "numpy": np.__version__, "seed": cfg.seed,
                  "input_sha256": in_sha, "created_at": _created_at()},
    }
    if entity is not None:                                  # contract 0.4, additive: legacy keys keep their meaning
        manifest["entity"].update({"id": entity.id, "type": entity.type, "name": entity.name, "status": entity.status,
                                   "version": entity.version, "source": entity.source, "geometry": entity.geometry,
                                   "relations": list(entity.relations)})
        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            measured = {"sigma_median": _r(np.nanmedian(st["sigma"][usable])) if usable.any() else None,
                        "r1_median": _r(np.nanmedian(r1[usable])) if usable.any() else None,
                        "mde_median": _r(np.nanmedian(st["mde"][usable])) if usable.any() else None,
                        "delta_used_median": _r(np.nanmedian(st["delta"][usable])) if usable.any() else None}
        decisions = list(profile.decisions) + [
            f"Tras correr: σ interanual mediana {measured['sigma_median']}, φ̂ mediana {measured['r1_median']}, "
            f"MDE mediano {measured['mde_median']} {var.get('unit', '')}/década frente a δ {measured['delta_used_median']}."]
        manifest["profile_spec"] = {**profile.to_dict(), "decisions": decisions, "measured": measured,
                                    "catalog_version": PROFILES_VERSION}
        if entity.status != "real":
            manifest["honesty"]["entity_status"] = entity.status
    series = st["series"] if keep_series else None
    return LayerResult(st["effect"], st["ci_lo"], st["ci_hi"], st["sigma"], r1, st["p_cons"], q, st["mde"],
                       st["years_more"], verdict, flags, st["nvalid"].astype(np.uint8), nsig, st["naive"], series, years,
                       manifest, delta=st["delta"], break_year=st["break_year"], e_cons=st["e_cons"],
                       ebh_sig=ebh_sig.astype(np.uint8))


def _detectability(usable, mde, delta, years_more, verdict, n) -> dict:
    """D2 «what is not known yet»: where a change of size delta could already have been seen, and how many years
    are missing elsewhere. Computed from delta (a size of interest), never from the observed effect."""
    u = usable & np.isfinite(mde) & np.isfinite(delta)
    if not u.any():
        return {"cells": 0}
    ok = mde[u] <= delta[u]
    ym = years_more[u][~ok]
    finite = ym[ym < YEARS_CAP]
    q = (lambda a, k: float(np.quantile(a, k)) if a.size else None)
    return {"cells": int(u.sum()), "n_years": n, "share_detectable_now": _r(ok.mean()),
            "share_needs_more_than_60_years": _r((ym >= YEARS_CAP).sum() / u.sum()),
            "years_more_p50": q(finite, 0.5), "years_more_p90": q(finite, 0.9),
            "not_yet_knowable": int((verdict[u] == NO_CONCLUYENTE).sum()),
            "note": "MDE <= delta: a change of size delta would have been detected with >= 80 % power (noise model)."}


def run_layer(cube: Cube, config: Config | None = None, *, entity: Entity | None = None,
              profile: Profile | str | None = None, place: dict | None = None) -> LayerResult:
    """cube -> findings per cell (effect, tests, FDR, MDE, verdict, flags). See docs/SPEC.md sections 2-5.

    With profile="auto" (L0) HORI infers the profile from the metadata and the data and creates the entity card for
    this query (`place` = {"name": {...}, "geometry": ..., "source": ...} if the caller knows the place). The pair is
    checked (body, variable, real vs simulated) and the profile's delta applies unless `config` sets one explicitly.
    Without a profile the layer runs as before (contract 0.1 fields).
    """
    in_sha = input_sha256(cube)
    cfg, delta_source, profile, entity = _resolve(cube.meta, config, entity, profile, cube.values, cube.time,
                                                  cube.lat, cube.lon, place, in_sha)
    st = cell_stats(cube.values, cube.time, cfg)
    lat, lon = np.asarray(cube.lat, dtype=float), np.asarray(cube.lon, dtype=float)
    dlat = float(lat[1] - lat[0]) if len(lat) > 1 else -float(cube.meta.get("native_resolution_deg", 1.0))
    dlon = float(lon[1] - lon[0]) if len(lon) > 1 else float(cube.meta.get("native_resolution_lon_deg", 1.0))
    grid = {"type": "latlon", "nlat": int(cube.values.shape[1]), "nlon": int(cube.values.shape[2]), "lat0": float(lat[0]),
            "dlat": dlat, "lon0": float(lon[0]), "dlon": dlon,
            "native_resolution_deg": float(cube.meta.get("native_resolution_deg", abs(dlat)))}
    return _finish(st, cube.meta, cfg, delta_source, entity, profile, grid, in_sha)


def run_grid(blocks, lat, lon, time, meta: dict, config: Config | None = None, *, entity: Entity | None = None,
             profile: Profile | str | None = None, place: dict | None = None, keep_series: bool = False,
             progress=None, sample: np.ndarray | None = None) -> LayerResult:
    """A whole grid (e.g. the planet) block by block, with ONE false-discovery family for the full map.

    `blocks` yields (y0, x0, values[T, ny, nx]) with y0/x0 the block's top-left index in the full grid, rows
    north -> south. Only per-cell results are kept (~60 bytes x cells), so RAM is bounded by one block, not the cube.
    Per-cell numbers equal run_layer on the same cells; q-values and verdicts differ ONLY because the FDR family is
    the whole map (more cells tested -> stricter).
    """
    lat, lon = np.asarray(lat, dtype=float), np.asarray(lon, dtype=float)
    blocks = iter(blocks)
    first = next(blocks, None)
    if first is None:
        raise ValueError("no blocks")
    # profile: zeros/bounds measured on `sample` ([T, ...] spread over the grid, given by the caller) or, failing
    # that, on the first block; the card's input hash is the grid's, filled in at the end
    cfg, delta_source, profile, entity = _resolve(meta, config, entity, profile,
                                                  first[2] if sample is None else sample, time, lat, lon, place)
    blocks = itertools.chain([first], blocks)
    ny, nx = len(lat), len(lon)
    cells = ny * nx
    h = hashlib.sha256()
    out, done = None, 0
    for y0, x0, vals in blocks:
        st = cell_stats(vals, time, cfg)
        if out is None:
            n = len(st["years"])
            out = {k: np.full(cells, np.nan) for k in ("effect", "ci_lo", "ci_hi", "sigma", "r1", "p_cons", "mde",
                                                     "years_more", "delta", "e_cons")}
            out.update(break_flag=np.zeros(cells, bool), break_year=np.full(cells, np.nan))
            out.update(nsig=np.zeros(cells, np.uint8), naive=np.zeros(cells, np.uint8), usable=np.zeros(cells, bool),
                       filled=np.zeros(cells, bool), nvalid=np.zeros(cells, np.int64), years=st["years"],
                       anomaly=st["anomaly"], series=np.full((cells, n), np.nan, np.float32) if keep_series else None,
                       seen=np.zeros(cells, bool))
        elif st["years"] != out["years"]:
            raise ValueError("all blocks must share the same time axis")
        by, bx = vals.shape[1], vals.shape[2]
        idx = ((y0 + np.arange(by))[:, None] * nx + (x0 + np.arange(bx))[None, :]).ravel()
        if out["seen"][idx].any():
            raise ValueError(f"block at ({y0}, {x0}) overlaps another block")
        out["seen"][idx] = True
        for k in ("effect", "ci_lo", "ci_hi", "sigma", "r1", "p_cons", "mde", "years_more", "delta", "e_cons", "nsig", "naive",
                  "usable", "filled", "nvalid", "break_flag", "break_year"):
            out[k][idx] = st[k]
        if keep_series:
            out["series"][idx] = st["series"]
        h.update(np.asarray([y0, x0, by, bx], "<i8").tobytes() + np.ascontiguousarray(vals, dtype="<f4").tobytes())
        done += 1
        if progress:
            progress(done)
    if out is None:
        raise ValueError("no blocks")
    if not out.pop("seen").all():
        raise ValueError("blocks do not cover the whole grid")
    for a in (np.asarray(time).astype(str), lat.astype("<f8"), lon.astype("<f8")):
        h.update(a.tobytes())
    h.update(json.dumps(meta.get("variable", {}), sort_keys=True).encode())
    grid = {"type": "latlon", "nlat": ny, "nlon": nx, "lat0": float(lat[0]), "dlat": float(lat[1] - lat[0]),
            "lon0": float(lon[0]), "dlon": float(lon[1] - lon[0]),
            "native_resolution_deg": float(meta.get("native_resolution_deg", abs(float(lat[1] - lat[0]))))}
    in_sha = h.hexdigest()
    if entity is not None and not entity.source.get("input_sha256"):
        entity = Entity.from_dict({**entity.to_dict(), "source": {**entity.source, "input_sha256": in_sha}})
    res = _finish(out, meta, cfg, delta_source, entity, profile, grid, in_sha, keep_series)
    if profile is not None:
        res.manifest["profile_spec"]["decisions"].insert(
            0, "Propiedades de ceros/límites medidas en " + ("una muestra repartida por la malla." if sample is not None
                                                              else "el primer trozo (sin muestra repartida)."))
    return res


def write_bundle(result: LayerResult, out_dir: str, title_es: str | None = None, title_en: str | None = None) -> Path:
    """Write manifest.json + binary arrays (little-endian) following contract/SPEC.md."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    arrays = {"effect": ("f32", result.effect), "ci_lo": ("f32", result.ci_lo), "ci_hi": ("f32", result.ci_hi),
              "sigma": ("f32", result.sigma), "r1": ("f32", result.r1), "p_cons": ("f32", result.p_cons),
              "q_cons": ("f32", result.q_cons), "mde": ("f32", result.mde), "years_more": ("f32", result.years_more),
              "verdict": ("u8", result.verdict), "flags": ("u8", result.flags), "nvalid": ("u8", result.nvalid),
              "nsig_methods": ("u8", result.nsig_methods), "naive_sig": ("u8", result.naive_sig)}
    if result.delta is not None:                              # v0.4, additive (D2)
        arrays["delta"] = ("f32", result.delta)
    if result.e_cons is not None:                             # v0.4, additive (H6): evidence in parallel, not the verdict
        arrays["e_cons"] = ("f32", result.e_cons)
        arrays["ebh_sig"] = ("u8", result.ebh_sig)
    if result.break_year is not None:                         # v0.4, additive (L1): year the possible new regime starts
        arrays["break_year"] = ("f32", result.break_year)
    listing = {}
    for name, (dt, arr) in arrays.items():
        fname = f"{name}.{dt}"
        np.asarray(arr).astype("<f4" if dt == "f32" else "u1").tofile(out / fname)
        listing[name] = {"file": fname, "dtype": dt}
    m = dict(result.manifest)
    var = m["variable"]
    m["title"] = {"es": title_es or var["name"], "en": title_en or var["name"]}
    m["arrays"] = listing
    if result.series is not None:
        result.series.astype("<f4").tofile(out / "series.f32")
        m["series"] = {"file": "series.f32", "dtype": "f32", "shape": ["cells", "n"], "years": result.years}
    else:                                                     # global maps: per-cell series are served elsewhere
        m["series"] = None
        m["years"] = result.years
    (out / "manifest.json").write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


from .windows import EVENT_CODES, TIER_CODES, Timeline, run_timeline, summarize  # noqa: E402  (windows imports api lazily)
