"""Paired search of verdict rules on the planet's own noise (same surrogates as null_planet.py, every rule on the
SAME realizations). Prints, per rule: false discovery proportion (mean, worst) and power on the injected cells.

    PYTHONPATH=packages/hori/src python3 sim/rule_search_v12.py STRIDE REPS DETREND(1|0) [npz] [delta]
"""
import sys

import numpy as np

from hori.evalue import ebh, mixture_e
from hori.fdr import bh_adjust
from hori.stats import analyze, p_two

stride, reps, detrend = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
NPZ = sys.argv[4] if len(sys.argv) > 4 else "../horizon247/data/planet/t2m_annual_1981-2025.npz"
DELTA = float(sys.argv[5]) if len(sys.argv) > 5 else 0.3
Q, ALPHA, H = 0.10, 0.05, 0.7
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


def rules(Y: np.ndarray) -> dict:
    cells = Y.shape[0]
    keys = ("z_vc", "z_ws", "z_ols", "z_lm", "se_ols")
    s = {k: np.empty(cells) for k in keys}
    for c in range(0, cells, 2048):
        a = analyze(Y[c:c + 2048], memory_hurst=H)
        for k in keys:
            s[k][c:c + 2048] = a[k]
    z3, z4 = [s["z_vc"], s["z_ws"], s["z_ols"]], [s["z_vc"], s["z_ws"], s["z_ols"], s["z_lm"]]
    nanify = lambda a: np.where(ok, a, np.nan)

    def bh_rule(zl):
        p = nanify(np.maximum.reduce([p_two(z) for z in zl]))
        return ok & (bh_adjust(p) <= Q) & (p <= ALPHA)

    out = {"HORI 1.0 (3 votos + BH)": bh_rule(z3), "HORI 1.1 (4 votos + BH)": bh_rule(z4)}
    for name, mult in (("tau=delta", 1.0), ("tau=delta/2", 0.5), ("tau=2delta", 2.0)):
        tau = mult * DELTA / (10.0 * s["se_ols"])
        e3 = np.mean([mixture_e(z, tau) for z in z3], 0)
        e4 = np.mean([mixture_e(z, tau) for z in z4], 0)
        out[f"e-BH 3 ({name})"] = ebh(nanify(e3), Q)
        out[f"e-BH 4 ({name})"] = ebh(nanify(e4), Q)
        if mult == 1.0:
            out["1.1 Y e-BH 4"] = out["HORI 1.1 (4 votos + BH)"] & out[f"e-BH 4 ({name})"]
            out["1.0 Y e-BH 4"] = out["HORI 1.0 (3 votos + BH)"] & out[f"e-BH 4 ({name})"]
            out["1.0 Y e-BH 3"] = out["HORI 1.0 (3 votos + BH)"] & out[f"e-BH 3 ({name})"]
            out["1.1 O e-BH 4"] = out["HORI 1.1 (4 votos + BH)"] | out[f"e-BH 4 ({name})"]
    return out


acc: dict = {}
for rep in range(reps):
    K = spec.shape[0]
    ph = np.exp(1j * rng.uniform(0, 2 * np.pi, size=(K, 1)))
    ph[0] = 1.0
    if n % 2 == 0:
        ph[-1] = np.sign(np.cos(rng.uniform(0, 2 * np.pi)))
    S = np.fft.irfft(spec * ph, n=n, axis=0)
    mask = np.kron(rng.random((-(-ny // 8), -(-nx // 8))) < 0.2, np.ones((8, 8), bool))[:ny, :nx].ravel()
    S[:, mask] += np.outer(tc / 10.0, np.full(mask.sum(), DELTA))
    for k, d in rules(S.T.copy()).items():
        acc.setdefault(k, []).append((d[ok & ~mask].sum() / max(d.sum(), 1), float(d[ok & mask].mean())))
    print("rep", rep + 1, file=sys.stderr, flush=True)
print(f"stride={stride} reps={reps} {'optimista' if detrend else 'pesimista'} celdas={int(ok.sum())} delta={DELTA}")
print(f"{'regla':28s} FDR media   peor    potencia")
for k, v in acc.items():
    v = np.array(v)
    print(f"{k:28s} {v[:, 0].mean() * 100:6.1f} %  {v[:, 0].max() * 100:5.1f} %  {v[:, 1].mean() * 100:6.1f} %")
