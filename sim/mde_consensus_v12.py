"""MDE (80 % power) of the HORI 1.2 rule against the ideal MDE, in sigma per decade (same design as mde_consensus.py).

Rule: the three tests significant at alpha AND the mean mixture e-value above the e-BH bar. The e-BH bar depends on
the map (e >= m / (q k)); the table is measured at a REFERENCE map where 20 % of the cells are discovered, so the bar
is 1 / (q 0.2) = 50. tau = delta / se with delta = the effect being tried: the factor is exact where MDE = delta,
which is where MDE is compared against delta. A map with fewer discoveries has a higher bar (the table is optimistic there).

    PYTHONPATH=packages/hori/src python3 sim/mde_consensus_v12.py > sim/results_mde_consensus_v12.txt
"""
import math

import numpy as np

from hori.evalue import mixture_e
from hori.stats import Z_CRIT, analyze

K80 = 1.959964 + 0.841621
M, BAR = 4000, 1.0 / (0.10 * 0.20)
rng = np.random.default_rng(247)


def gen(n: int, phi: float, slope: float) -> np.ndarray:
    e = rng.standard_normal((M, n + 50))
    x = np.empty_like(e)
    x[:, 0] = e[:, 0]
    for t in range(1, n + 50):
        x[:, t] = phi * x[:, t - 1] + math.sqrt(1 - phi * phi) * e[:, t]
    return x[:, 50:] + slope * np.arange(n)


def power(n: int, phi: float, sd_per_decade: float) -> float:
    Y = gen(n, phi, sd_per_decade / 10.0)
    hit = 0
    for c in range(0, M, 1000):
        s = analyze(Y[c:c + 1000])
        zs = [s["z_vc"], s["z_ws"], s["z_ols"]]
        tau = sd_per_decade / (10.0 * s["se_ols"])
        e = np.mean([mixture_e(z, tau) for z in zs], axis=0)
        hit += int(((np.minimum.reduce([np.abs(z) for z in zs]) > Z_CRIT) & (e >= BAR)).sum())
    return hit / M


print("MDE (80 % de potencia) de la regla de HORI 1.2 (3 votos + e-BH, barra de referencia e >= 50) vs MDE ideal — σ por década")
print(f"{'n':>3} {'phi':>4} | {'ideal':>6} {'regla':>9} {'factor':>7}")
for n in (15, 23, 40, 45):
    for phi in (0.0, 0.3, 0.5):
        ideal = 10 * K80 * math.sqrt(12 / (n * (n * n - 1)) * (1 + phi) / (1 - phi))
        lo, hi = 0.05, 12.0
        for _ in range(9):
            mid = (lo + hi) / 2
            if power(n, phi, mid) < 0.8:
                lo = mid
            else:
                hi = mid
        e = (lo + hi) / 2
        print(f"{n:>3} {phi:>4} | {ideal:>6.2f} {e:>9.2f} {e / ideal:>7.2f}", flush=True)
