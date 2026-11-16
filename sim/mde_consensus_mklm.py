"""MDE (80 % power) of the rule with four voters: MK-VC, TFPW-WS, OLS-AR1 and MK-LM (Mann-Kendall with the
variance of fGn(H = 0.7)) — against the ideal MDE, in sigma per decade. Same design as mde_consensus.py, extended to n = 45.

    PYTHONPATH=packages/hori/src python3 sim/mde_consensus_mklm.py > sim/results_mde_consensus_mklm.txt
"""
import math

import numpy as np

from hori.longmemory import memory_scale
from hori.stats import Z_CRIT, analyze

K80 = 1.959964 + 0.841621
M, H = 4000, 0.7
rng = np.random.default_rng(247)


def gen(n: int, phi: float, slope: float) -> np.ndarray:
    """AR(1) Gaussian noise with unit INNOVATION-free marginal variance, plus a line of `slope` per step."""
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
        z = np.minimum.reduce([np.abs(s["z_vc"]), np.abs(s["z_ws"]), np.abs(s["z_ols"]),
                               np.abs(s["z_naive"]) * memory_scale(n, H)])
        hit += int((z > Z_CRIT).sum())
    return hit / M


print("MDE (80 % de potencia) de la regla de HORI 1.1 (4 votos) vs MDE ideal — σ por década")
print(f"{'n':>3} {'phi':>4} | {'ideal':>6} {'regla':>9} {'factor':>7}")
for n in (15, 23, 40, 45):
    for phi in (0.0, 0.3, 0.5):
        ideal = 10 * K80 * math.sqrt(12 / (n * (n * n - 1)) * (1 + phi) / (1 - phi))
        lo, hi = 0.05, 10.0
        for _ in range(9):
            mid = (lo + hi) / 2
            if power(n, phi, mid) < 0.8:
                lo = mid
            else:
                hi = mid
        e = (lo + hi) / 2
        print(f"{n:>3} {phi:>4} | {ideal:>6.2f} {e:>9.2f} {e / ideal:>7.2f}", flush=True)
