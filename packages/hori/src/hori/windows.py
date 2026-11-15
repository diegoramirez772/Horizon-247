"""Steps 8-9: expanding windows = the evidence «time machine» (D1), events (L5) and priority (L6).

HORI is re-run «as if it were» each past year, using only the years available then (same rule, FDR inside each
window). From the stack of verdicts [windows, cells] everything else is derived, with no extra statistics:
  emergence_year   first year from which the cell is PROBADO and stays so until today;
  reversals        how many times a PROBADO was later withdrawn -> a false-alarm rate measured on REAL data;
  events           what changed between the previous window and the current one (CRUZO, SE_DEBILITO...);
  priority         a fixed, explainable order (events > proven by strength > about to emerge > rest).

Honesty: the windows are nested, not independent tests («evolution of the evidence»); and this is a backtest
with TODAY's version of the data, not what was actually published in each year.
"""
from __future__ import annotations

import multiprocessing as mp
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass

import numpy as np

from .config import Config
from .fdr import bh_adjust
from .verdict import CANDIDATA, INSUFICIENTE, NO_CONCLUYENTE, PROBADO, decide

EV_NONE, EV_NUEVO, EV_SE_DEBILITO, EV_CRUZO, EV_CAMBIO_SIGNO = 0, 1, 2, 3, 4      # higher code wins
EVENT_CODES = {0: "NINGUNO", 1: "NUEVO", 2: "SE_DEBILITO", 3: "CRUZO", 4: "CAMBIO_SIGNO"}
TIER_EVENTO, TIER_PROBADO, TIER_POR_EMERGER, TIER_RESTO = 0, 1, 2, 3
TIER_CODES = {0: "EVENTO", 1: "PROBADO", 2: "POR_EMERGER", 3: "RESTO"}
SOON_YEARS = 5.0                                                                 # «about to emerge» horizon
_JOB: dict = {}                                                                  # shared with forked workers


def window_verdicts(annual: np.ndarray, years: list, cfg: Config, batch: int = 2048):
    """One window: annual [n, cells] -> (verdict u8, effect, mde, years_more), one FDR family for all the cells."""
    from .api import cell_stats                                                  # late import: api re-exports this module
    time = [f"{int(y)}-01-01" for y in years]
    keys = ("p_cons", "nsig", "effect", "mde", "delta", "years_more", "usable")
    parts = {k: [] for k in keys}
    for a in range(0, annual.shape[1], batch):
        st = cell_stats(annual[:, a:a + batch, None], time, cfg)
        for k in keys:
            parts[k].append(st[k])
    o = {k: np.concatenate(v) for k, v in parts.items()}
    with np.errstate(invalid="ignore"):
        v = decide(o["usable"], bh_adjust(o["p_cons"]), o["nsig"], o["mde"], o["delta"], cfg.fdr_q, len(cfg.methods))
    return v, o["effect"].astype(np.float32), o["mde"].astype(np.float32), o["years_more"].astype(np.float32)


def _job(k: int):
    return window_verdicts(_JOB["annual"][:k], _JOB["years"][:k], _JOB["cfg"], _JOB["batch"])


@dataclass
class Timeline:
    ends: list                  # last year of each window
    verdict: np.ndarray         # [W, cells] u8
    effect: np.ndarray          # [W, cells] f32, per decade
    mde: np.ndarray             # [cells] f32, last window
    years_more: np.ndarray      # [cells] f32, last window
    derived: dict               # see summarize()


def run_timeline(annual: np.ndarray, years: list, config: Config | None = None, *, min_n: int = 15, workers: int = 1,
                 batch: int = 2048, progress=None) -> Timeline:
    """annual [n_years, cells] (already annual, e.g. hori.api.to_annual) -> one HORI run per expanding window.

    Windows are independent jobs, so `workers` > 1 runs them in forked processes (same numbers, any order).
    """
    cfg = config or Config()
    annual = np.asarray(annual, dtype=float)
    n = annual.shape[0]
    if n != len(years) or n < min_n:
        raise ValueError(f"need >= {min_n} years and one year label per row (got {n} rows, {len(years)} labels)")
    ks = list(range(min_n, n + 1))
    _JOB.update(annual=annual, years=list(years), cfg=cfg, batch=batch)
    try:
        if workers > 1:
            with ProcessPoolExecutor(workers, mp_context=mp.get_context("fork")) as ex:
                res = []
                for r in ex.map(_job, ks):
                    res.append(r)
                    if progress:
                        progress(len(res), len(ks))
        else:
            res = []
            for k in ks:
                res.append(_job(k))
                if progress:
                    progress(len(res), len(ks))
    finally:
        _JOB.clear()
    ends = [int(years[k - 1]) for k in ks]
    verdict = np.stack([r[0] for r in res])
    effect = np.stack([r[1] for r in res])
    return Timeline(ends, verdict, effect, res[-1][2], res[-1][3], summarize(ends, verdict, effect, res[-1][2], res[-1][3]))


def summarize(ends: list, verdict: np.ndarray, effect: np.ndarray, mde: np.ndarray, years_more: np.ndarray) -> dict:
    """Everything derived from the verdict stack. Pure array logic, no statistics."""
    W, cells = verdict.shape
    ends_a = np.asarray(ends, dtype=np.float32)
    P = verdict == PROBADO
    ever, final = P.any(axis=0), P[-1]
    # emergence: start of the PROBADO run that reaches the last window
    trailing = np.where(P.all(axis=0), W, np.argmax(~P[::-1], axis=0))           # length of the final run
    emergence = np.where(final, ends_a[np.clip(W - trailing, 0, W - 1)], np.nan).astype(np.float32)
    first = np.where(ever, ends_a[np.argmax(P, axis=0)], np.nan).astype(np.float32)
    withdrawn = P[:-1] & ~P[1:] if W > 1 else np.zeros((0, cells), bool)
    reversals = withdrawn.sum(axis=0).astype(np.uint8)
    sgn = np.sign(np.where(P, effect, 0.0))
    sign_flip = (sgn > 0).any(axis=0) & (sgn < 0).any(axis=0)                    # proven up AND proven down: the grave error

    event = np.zeros(cells, dtype=np.uint8)
    if W > 1:
        pv, cv, pe, ce = verdict[-2], verdict[-1], effect[-2], effect[-1]
        marked = lambda v: (v == PROBADO) | (v == CANDIDATA)
        event[(pv == INSUFICIENTE) & (cv != INSUFICIENTE)] = EV_NUEVO
        event[(pv == PROBADO) & (cv != PROBADO)] = EV_SE_DEBILITO
        event[(pv != PROBADO) & (cv == PROBADO)] = EV_CRUZO
        with np.errstate(invalid="ignore"):
            event[marked(pv) & marked(cv) & (np.sign(pe) * np.sign(ce) < 0)] = EV_CAMBIO_SIGNO

    cv = verdict[-1]
    with np.errstate(invalid="ignore", divide="ignore"):
        strength = np.nan_to_num(np.abs(effect[-1]) / mde, nan=0.0, posinf=0.0).astype(np.float32)
        soon = (cv == CANDIDATA) | ((cv == NO_CONCLUYENTE) & (years_more <= SOON_YEARS))
    tier = np.full(cells, TIER_RESTO, dtype=np.uint8)
    tier[soon] = TIER_POR_EMERGER
    tier[cv == PROBADO] = TIER_PROBADO
    tier[event != EV_NONE] = TIER_EVENTO
    order = np.lexsort((np.arange(cells), -strength, tier))                      # stable and deterministic

    n_ever = int(ever.sum())
    p_steps = int(P[:-1].sum()) if W > 1 else 0
    stats = {
        "windows": W, "first_end": int(ends[0]), "last_end": int(ends[-1]), "cells": int(cells),
        "ever_probado": n_ever, "probado_now": int(final.sum()),
        "withdrawn_share": round(float((ever & ~final).sum() / n_ever), 4) if n_ever else None,
        "step_reversal_rate": round(float(withdrawn.sum() / p_steps), 5) if p_steps else None,
        "sign_reversal_share": round(float(sign_flip.sum() / n_ever), 5) if n_ever else None,
        "events": {EVENT_CODES[c]: int((event == c).sum()) for c in EVENT_CODES if c},
        "tiers": {TIER_CODES[c]: int((tier == c).sum()) for c in TIER_CODES},
        "definitions": {
            "withdrawn_share": "of the cells that were PROBADO in some window, share that is NOT PROBADO today",
            "step_reversal_rate": "PROBADO -> not PROBADO transitions per PROBADO cell-year",
            "sign_reversal_share": "cells PROBADO with one sign in one window and with the opposite sign in another",
            "caveat": "nested windows on today's data version: a backtest, not independent tests nor the data of each year"},
    }
    return {"emergence_year": emergence, "first_probado_year": first, "reversals": reversals, "sign_flip": sign_flip,
            "event": event, "tier": tier, "strength": strength, "order": order, "stats": stats}
