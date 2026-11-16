"""Coverage of the 95 % interval of the effect on the planet's own noise (same surrogates as null_planet.py), for the
AR(1) interval of HORI 1.0 and for intervals widened for long memory (fGn(H)). Paired: every interval on the same series.

    PYTHONPATH=packages/hori/src python3 sim/ci_coverage_v12.py STRIDE REPS DETREND(1|0) [npz] [delta]
"""
import sys

import numpy as np

from hori.longmemory import memory_scale
from hori.stats import Z_CRIT, analyze

stride, reps, detrend = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
NPZ = sys.argv[4] if len(sys.argv) > 4 else "../horizon247/data/planet/t2m_annual_1981-2025.npz"
DELTA = float(sys.argv[5]) if len(sys.argv) > 5 else 0.3
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
acc: dict = {}
for rep in range(reps):
    ph = np.exp(1j * rng.uniform(0, 2 * np.pi, size=(spec.shape[0], 1)))
    ph[0] = 1.0
    if n % 2 == 0:
        ph[-1] = np.sign(np.cos(rng.uniform(0, 2 * np.pi)))
    S = np.fft.irfft(spec * ph, n=n, axis=0)
    mask = np.kron(rng.random((-(-ny // 8), -(-nx // 8))) < 0.2, np.ones((8, 8), bool))[:ny, :nx].ravel()
    truth = np.where(mask, DELTA, 0.0)
    S[:, mask] += np.outer(tc / 10.0, np.full(mask.sum(), DELTA))
    Y = S.T[ok]
    eff, half, r = np.empty(len(Y)), np.empty(len(Y)), np.empty(len(Y))
    for c in range(0, len(Y), 2048):
        a = analyze(Y[c:c + 2048])
        eff[c:c + 2048], half[c:c + 2048], r[c:c + 2048] = a["sen"] * 10, Z_CRIT * a["se_ols"] * 10, a["r1"]
    ar = np.sqrt((1 + r) / (1 - r))
    for name, H in (("AR(1) (HORI 1.0)", None), ("max(AR(1), fGn 0.7)", 0.7), ("max(AR(1), fGn 0.8)", 0.8), ("max(AR(1), fGn 0.9)", 0.9)):
        h = half if H is None else half * np.maximum(1.0, (1.0 / memory_scale(n, H)) / ar)
        acc.setdefault(name, []).append((float((np.abs(eff - truth[ok]) <= h).mean()), float(np.median(h))))
print(f"stride={stride} reps={reps} {'optimista' if detrend else 'pesimista'} n={n}")
for k, v in acc.items():
    v = np.array(v)
    print(f"{k:22s} cobertura {v[:, 0].mean() * 100:5.1f} % (peor {v[:, 0].min() * 100:5.1f} %)   semiancho mediano {v[:, 1].mean():.3f}")
