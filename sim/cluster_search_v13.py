"""HORI 1.3: significant REGIONS (hori.clusters) against the cell verdict of HORI 1.2, on the planet's own noise.
Same surrogates and injection as null_planet.py; every rule on the same realizations.

    PYTHONPATH=packages/hori/src python3 sim/cluster_search_v13.py STRIDE REPS DETREND(1|0) [npz] [delta] [surrogates]
"""
import sys

import numpy as np

from hori.clusters import significant_regions
from hori.evalue import ebh, mixture_e
from hori.fdr import bh_adjust
from hori.stats import analyze, p_two

stride, reps, detrend = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
NPZ = sys.argv[4] if len(sys.argv) > 4 else "../horizon247/data/planet/t2m_annual_1981-2025.npz"
DELTA = float(sys.argv[5]) if len(sys.argv) > 5 else 0.3
B = int(sys.argv[6]) if len(sys.argv) > 6 else 200
annual = np.load(NPZ, allow_pickle=False)["annual"][:, ::stride, ::stride]
n, ny, nx = annual.shape
X = annual.reshape(n, -1).astype(float)
ok = np.isfinite(X).all(0)
tc = np.arange(n, dtype=float) - (n - 1) / 2
Xc = np.where(ok, X, 0.0)
Xc = Xc - Xc.mean(0)
base = Xc - np.outer(tc, (tc @ Xc) / (tc @ tc)) if detrend else Xc
spec = np.fft.rfft(base, axis=0)
rng = np.random.default_rng(1)
acc = {}


def add(name, d, mask, extra=None):
    acc.setdefault(name, []).append((d[ok & ~mask].sum() / max(d.sum(), 1), float(d[ok & mask].mean())) + (extra or (np.nan, np.nan)))


for rep in range(reps):
    ph = np.exp(1j * rng.uniform(0, 2 * np.pi, size=(spec.shape[0], 1)))
    ph[0] = 1.0
    if n % 2 == 0:
        ph[-1] = np.sign(np.cos(rng.uniform(0, 2 * np.pi)))
    S = np.fft.irfft(spec * ph, n=n, axis=0)
    mask = np.kron(rng.random((-(-ny // 8), -(-nx // 8))) < 0.2, np.ones((8, 8), bool))[:ny, :nx].ravel()
    S[:, mask] += np.outer(tc / 10.0, np.full(mask.sum(), DELTA))
    Y = S.T
    s = {k: np.empty(len(Y)) for k in ("z_vc", "z_ws", "z_ols", "se_ols")}
    for c in range(0, len(Y), 2048):
        a = analyze(Y[c:c + 2048])
        for k in s:
            s[k][c:c + 2048] = a[k]
    z3 = [s["z_vc"], s["z_ws"], s["z_ols"]]
    p3 = np.where(ok, np.maximum.reduce([p_two(z) for z in z3]), np.nan)
    cons = ok & (bh_adjust(p3) <= 0.10) & (p3 <= 0.05)
    v12 = cons & ebh(np.where(ok, np.mean([mixture_e(z, DELTA / (10.0 * s["se_ols"])) for z in z3], 0), np.nan), 0.10)
    add("HORI 1.0 (celdas)", cons, mask)
    add("HORI 1.2 (celdas)", v12, mask)
    for z0 in (3.0,):
        R = significant_regions(S.reshape(n, ny, nx), ok, wrap=True, z0=z0, surrogates=B, seed=247 + rep)
        d = (R.labels != 0).ravel()
        false_regions = sum(1 for r in R.regions if not mask[(R.labels == r["id"]).ravel()].any())
        add(f"1.3 regiones z0={z0}", d, mask, (len(R.regions), false_regions))
        add(f"1.2 O regiones z0={z0}", d | v12, mask)
        add(f"1.2 dentro de regiones z0={z0}", d & cons, mask)
    print("rep", rep + 1, file=sys.stderr, flush=True)
print(f"stride={stride} reps={reps} {'optimista' if detrend else 'pesimista'} celdas={int(ok.sum())} sustitutos={B}")
print(f"{'regla':32s} celdas falsas (media, peor)  celdas con señal cubiertas   regiones (falsas sin ninguna celda con señal)")
for k, v in acc.items():
    v = np.array(v, dtype=float)
    tail = "" if np.isnan(v[:, 2]).all() else f"   {v[:, 2].sum():.0f} ({v[:, 3].sum():.0f})"
    print(f"{k:32s} {v[:, 0].mean() * 100:6.1f} %  {v[:, 0].max() * 100:5.1f} %        {v[:, 1].mean() * 100:6.1f} %{tail}")
