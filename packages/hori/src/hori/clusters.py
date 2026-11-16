"""Significant REGIONS (HORI 1.3): does a contiguous group of cells change together more than this map's own noise can?

A cell-by-cell verdict throws away one piece of information: a real regional change covers neighbouring cells with
the same sign. This module tests the REGION instead of the cell (cluster-mass test, Bullmore et al. 1999; Maris &
Oostenveld 2007), with the null measured on the map itself:

  1. per cell, z = OLS slope / its AR(1) standard error (the OLS-AR1 statistic of stats.py);
  2. clusters = 4-connected cells (longitude wraps on a global map) with z > z0, and separately z < -z0;
     mass = sum of (|z| - z0) over the cluster;
  3. null = the same map with the trend destroyed: the line is removed from every cell and the Fourier phases are
     randomized with THE SAME phase in every cell (Theiler et al. 1992), which keeps each cell's spectrum and the
     correlation between cells. The largest cluster mass of each surrogate map gives the null of «the biggest region
     that noise alone produces HERE»;
  4. a cluster is significant when its mass exceeds the (1 - alpha) quantile of that null: the chance of ANY false
     region in the map is alpha (family-wise), under the surrogate null.

What the claim is, and is not: «this region, as a whole, is changing». It does NOT say every cell inside changes,
and the border of a region is not sharp. The surrogate null removes the line first; the power that the line takes
from white noise is given back exactly, but slow natural variability beyond that is still under-represented (the
same limit as the cell verdict; measured in sim/cluster_search_v13.py).
z0 = 3 is the measured choice (sim/cluster_search_v13.py, planet's own noise, 12 maps per noise model): of 175
regions declared, none lacked a cell with real change; z0 = 2 merges noise into huge regions and finds less.
A region's cells are NOT each a PROBADO: inside the declared regions 1 % to 9 % of the cells had no change (worst map 45 %).
NumPy only; deterministic for a given seed.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .stats import bias_corrected, lag1


def z_map(Y: np.ndarray) -> np.ndarray:
    """OLS slope / AR(1) standard error for each row of Y [cells, n] (no missing values)."""
    n = Y.shape[1]
    tc = np.arange(n, dtype=float) - (n - 1) / 2.0
    sxx = float(tc @ tc)
    yc = Y - Y.mean(axis=1, keepdims=True)
    b = yc @ tc / sxx
    res = yc - b[:, None] * tc
    r = bias_corrected(lag1(res), n)
    se = np.sqrt((res ** 2).sum(axis=1) / (n - 2) / sxx * (1 + r) / (1 - r))
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(se > 0, b / se, 0.0)


def label(mask: np.ndarray, wrap: bool) -> tuple[np.ndarray, int]:
    """4-connected components of a boolean [ny, nx] map (columns wrap when `wrap`). Returns (labels 0 = none, count)."""
    ny, nx = mask.shape
    lab = np.zeros((ny, nx), dtype=np.int32)
    k = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]:
            continue
        k += 1
        lab[y0, x0] = k
        stack = [(y0, x0)]
        while stack:
            y, x = stack.pop()
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if xx < 0 or xx >= nx:
                    if not wrap:
                        continue
                    xx %= nx
                if 0 <= yy < ny and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = k
                    stack.append((yy, xx))
    return lab, k


def _masses(z2d: np.ndarray, z0: float, wrap: bool):
    """Clusters of both signs: (labels with negative ids for falling clusters, {id: mass})."""
    out = np.zeros(z2d.shape, dtype=np.int32)
    masses = {}
    for sign in (1, -1):
        lab, k = label(sign * z2d > z0, wrap)
        if k:
            m = np.bincount(lab.ravel(), weights=np.where(lab > 0, sign * z2d - z0, 0.0).ravel(), minlength=k + 1)
            base = max((abs(i) for i in masses), default=0)
            for i in range(1, k + 1):
                masses[sign * (base + i)] = float(m[i])
            out[lab > 0] = sign * (base + lab[lab > 0])
    return out, masses


@dataclass
class Regions:
    labels: np.ndarray            # [ny, nx] int32: 0 = no region, > 0 rising region id, < 0 falling region id (significant only)
    regions: list = field(default_factory=list)   # [{id, sign, cells, mass, p, z_mean}] sorted by mass, significant only
    threshold_mass: float = float("nan")          # the (1 - alpha) quantile of the null of the largest mass
    candidates: int = 0                           # clusters found before the test
    params: dict = field(default_factory=dict)


def significant_regions(series: np.ndarray, usable: np.ndarray | None = None, *, wrap: bool = False, z0: float = 3.0,
                        alpha: float = 0.05, surrogates: int = 200, seed: int = 247) -> Regions:
    """series [n, ny, nx] annual values (complete where `usable`) -> the regions that change together beyond noise."""
    series = np.asarray(series, dtype=float)
    n, ny, nx = series.shape
    X = series.reshape(n, -1)
    ok = np.isfinite(X).all(axis=0) if usable is None else np.asarray(usable, dtype=bool).ravel() & np.isfinite(X).all(axis=0)
    params = {"z0": z0, "alpha": alpha, "surrogates": surrogates, "seed": seed, "wrap": bool(wrap), "connectivity": 4,
              "null": "same-phase Fourier surrogates of the line residuals", "error": "family-wise over regions"}
    empty = Regions(np.zeros((ny, nx), dtype=np.int32), [], float("nan"), 0, params)
    if ok.sum() < 4 or n < 10:
        return empty
    Y = X[:, ok].T                                                   # [cells_ok, n]
    z = np.zeros(ny * nx)
    z[ok] = z_map(Y)
    lab, masses = _masses(z.reshape(ny, nx), z0, wrap)
    if not masses:
        return empty
    tc = np.arange(n, dtype=float) - (n - 1) / 2.0
    yc = Y - Y.mean(axis=1, keepdims=True)
    res = yc - (yc @ tc / float(tc @ tc))[:, None] * tc
    spec = np.fft.rfft(res, axis=1)                                  # [cells_ok, K]
    # Removing the line also removes noise: for white noise the residual keeps 1 - |FFT(t)_k|^2 / (n Sxx) of the power
    # at frequency k (70 % at the lowest one, where a line lives). Give it back, or the null is too quiet.
    kept = 1.0 - np.abs(np.fft.rfft(tc)) ** 2 / (n * float(tc @ tc))
    spec = spec / np.sqrt(np.clip(kept, 0.25, 1.0))[None, :]
    rng = np.random.default_rng(seed)
    null = np.zeros(surrogates)
    zs = np.zeros(ny * nx)
    for b in range(surrogates):
        ph = np.exp(1j * rng.uniform(0, 2 * np.pi, size=spec.shape[1]))
        ph[0] = 1.0
        if n % 2 == 0:
            ph[-1] = np.sign(np.cos(rng.uniform(0, 2 * np.pi)))
        zs[ok] = z_map(np.fft.irfft(spec * ph[None, :], n=n, axis=1))
        _, mb = _masses(zs.reshape(ny, nx), z0, wrap)
        null[b] = max(mb.values(), default=0.0)
    thr = float(np.quantile(null, 1.0 - alpha))
    out = np.zeros((ny, nx), dtype=np.int32)
    regions = []
    for i, m in sorted(masses.items(), key=lambda kv: -kv[1]):
        p = (1.0 + float((null >= m).sum())) / (surrogates + 1.0)
        if p <= alpha:
            sel = lab == i
            rid = (len(regions) + 1) * (1 if i > 0 else -1)
            out[sel] = rid
            regions.append({"id": rid, "sign": 1 if i > 0 else -1, "cells": int(sel.sum()), "mass": round(m, 3),
                            "p": round(p, 5), "z_mean": round(float(z.reshape(ny, nx)[sel].mean()), 3)})
    return Regions(out, regions, thr, len(masses), params)
