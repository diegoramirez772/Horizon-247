"""HORI 1.3 search: a trend test calibrated on each place's OWN measured spectrum (no AR(1) assumption), paired against
HORI 1.2 on the planet's own noise.

    PYTHONPATH=packages/hori/src python3 sim/spectral_search_v13.py STRIDE REPS DETREND(1|0) [npz] [delta]
"""
import sys

import numpy as np

from hori.evalue import ebh, mixture_e
from hori.fdr import bh_adjust
from hori.stats import Z_CRIT, analyze, p_two

stride, reps, detrend = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
NPZ = sys.argv[4] if len(sys.argv) > 4 else "../horizon247/data/planet/t2m_annual_1981-2025.npz"
DELTA = float(sys.argv[5]) if len(sys.argv) > 5 else 0.3
Q = 0.10
annual = np.load(NPZ, allow_pickle=False)["annual"][:, ::stride, ::stride]
n, ny, nx = annual.shape
X = annual.reshape(n, -1).astype(float)
ok = np.isfinite(X).all(0)
tc = np.arange(n, dtype=float) - (n - 1) / 2
Sxx = float(tc @ tc)
Xc = np.where(ok, X, 0.0)
Xc = Xc - Xc.mean(0)
base = Xc - np.outer(tc, (tc @ Xc) / Sxx) if detrend else Xc
spec = np.fft.rfft(base, axis=0)
rng = np.random.default_rng(1)
W2 = np.abs(np.fft.rfft(tc / Sxx)) ** 2                    # |FFT of the slope weights|^2, per frequency
KK = len(W2)
kk = np.arange(KK, dtype=float)
MULT = np.full(KK, 2.0); MULT[0] = 0.0
if n % 2 == 0:
    MULT[-1] = 1.0


def pooled(a):                                             # 3x3 mean over the map for each leading index, [K, ny, nx]
    a = np.pad(a, ((0, 0), (1, 1), (0, 0)), mode="edge")
    a = np.concatenate([a[:, :, -1:], a, a[:, :, :1]], 2)
    return sum(a[:, i:i + ny, j:j + nx] for i in range(3) for j in range(3)) / 9.0


def slope_var(P):                                          # P [cells, K] periodogram |X_k|^2 -> Var(slope) under random phases
    return (P * (MULT * W2)[None, :]).sum(1) / n ** 2


def powerlaw(P, k0, wide):
    """Fit log P_k = a - beta log k on k = k0..K-1 (3x3 pooled when wide), return the fitted spectrum for k = 1..K-1."""
    Pn = P / P[:, 1:].mean(1, keepdims=True)
    if wide:
        Pn = pooled(np.where(ok[:, None], Pn, np.nan).T.reshape(KK, ny, nx)).reshape(KK, -1).T
    lk = np.log(kk[k0:]); lkc = lk - lk.mean()
    lp = np.log(np.maximum(Pn[:, k0:], 1e-12))
    beta = np.clip(-(lp * lkc).sum(1) / (lkc ** 2).sum(), 0.0, 1.6)          # 0 = white, 1 = 1/f
    shape = np.zeros_like(P); shape[:, 1:] = kk[None, 1:] ** (-beta[:, None])
    # level: keep each cell's own total variance (sum of P over k >= 1), put it on the fitted shape
    return shape * (P[:, 1:].sum(1) / shape[:, 1:].sum(1))[:, None], beta


def rules(Y):
    cells = Y.shape[0]
    keys = ("z_vc", "z_ws", "z_ols", "se_ols", "r1")
    s = {k: np.empty(cells) for k in keys}
    for c in range(0, cells, 2048):
        a = analyze(Y[c:c + 2048])
        for k in keys:
            s[k][c:c + 2048] = a[k]
    nanify = lambda a: np.where(ok, a, np.nan)
    z3 = [s["z_vc"], s["z_ws"], s["z_ols"]]
    tau = DELTA / (10.0 * s["se_ols"])
    p3 = nanify(np.maximum.reduce([p_two(z) for z in z3]))
    cons = ok & (bh_adjust(p3) <= Q) & (p3 <= 0.05)
    out = {"HORI 1.0": cons, "HORI 1.2": cons & ebh(nanify(np.mean([mixture_e(z, tau) for z in z3], 0)), Q)}
    yc = Y - Y.mean(1, keepdims=True)
    b = yc @ tc / Sxx
    res = yc - b[:, None] * tc
    P = np.abs(np.fft.rfft(res, axis=1)) ** 2
    var_ar = (s["se_ols"]) ** 2
    cands = {"espectro crudo": slope_var(P)}
    for k0 in (1, 2, 3):
        for wide in (False, True):
            fit, beta = powerlaw(P, k0, wide)
            cands[f"ley k>={k0}{' 3x3' if wide else ''}"] = slope_var(fit)
            if k0 == 2 and wide:
                out["_beta"] = float(np.nanmedian(beta[ok]))
    for name, v in cands.items():
        for mx in (False, True):
            se = np.sqrt(np.maximum(v, var_ar) if mx else v)
            z = b / se
            e = mixture_e(z, DELTA / (10.0 * se))
            out[f"1.3 {name}{' ∨AR1' if mx else ''}"] = ok & (np.abs(z) > Z_CRIT) & ebh(nanify(e), Q)
    return out


acc, betas = {}, []
for rep in range(reps):
    ph = np.exp(1j * rng.uniform(0, 2 * np.pi, size=(spec.shape[0], 1)))
    ph[0] = 1.0
    if n % 2 == 0:
        ph[-1] = np.sign(np.cos(rng.uniform(0, 2 * np.pi)))
    S = np.fft.irfft(spec * ph, n=n, axis=0)
    mask = np.kron(rng.random((-(-ny // 8), -(-nx // 8))) < 0.2, np.ones((8, 8), bool))[:ny, :nx].ravel()
    S[:, mask] += np.outer(tc / 10.0, np.full(mask.sum(), DELTA))
    r = rules(S.T.copy())
    betas.append(r.pop("_beta"))
    for k, d in r.items():
        acc.setdefault(k, []).append((d[ok & ~mask].sum() / max(d.sum(), 1), float(d[ok & mask].mean())))
    print("rep", rep + 1, file=sys.stderr, flush=True)
print(f"stride={stride} reps={reps} {'optimista' if detrend else 'pesimista'} celdas={int(ok.sum())} beta mediana {np.mean(betas):.2f}")
print(f"{'regla':30s} FDR media   peor    potencia")
for k, v in acc.items():
    v = np.array(v)
    print(f"{k:30s} {v[:, 0].mean() * 100:6.1f} %  {v[:, 0].max() * 100:5.1f} %  {v[:, 1].mean() * 100:6.1f} %")
