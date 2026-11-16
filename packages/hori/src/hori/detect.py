"""Step 6: detectability. Minimum detectable effect (MDE) with the factor MEASURED for our consensus rule.

MDE_ideal (80 % power, alpha 5 %, per decade) = 10 * 2.8016 * se_ideal, se_ideal = sigma * sqrt(12/(n(n^2-1)) * (1+r)/(1-r)).
The real rule is less powerful than the ideal test, so the ideal value is multiplied by a factor measured by
simulation (sim/mde_consensus.py). The table was measured with the TRUE autocorrelation; in use only r-hat is known
(an approximation, flagged when r-hat > 0.5).
"""
from __future__ import annotations

import math

import numpy as np

K80 = 1.959964 + 0.841621                       # z(0.975) + z(0.80)
_NS = np.array([15.0, 23.0, 40.0])
_PHIS = np.array([0.0, 0.3, 0.5])
_FACTOR = np.array([[1.49, 1.49, 1.73],         # n = 15
                    [1.31, 1.27, 1.41],         # n = 23
                    [1.22, 1.19, 1.22]])        # n = 40
# Same measurement for the rule with a fourth voter (the three tests above + MK-LM), extended to n = 45 (sim/mde_consensus_mklm.py).
# The long-memory vote costs most when the noise is white (it assumes more memory than there is).
_NS_LM = np.array([15.0, 23.0, 40.0, 45.0])
_FACTOR_LM = np.array([[1.65, 1.56, 1.74],      # n = 15
                       [1.55, 1.33, 1.39],      # n = 23
                       [1.52, 1.23, 1.20],      # n = 40
                       [1.58, 1.24, 1.22]])     # n = 45
# HORI 1.2 rule (three tests + e-BH at the reference bar e >= 50; sim/mde_consensus_v12.py).
_FACTOR_EBH = np.array([[1.82, 1.65, 1.77],
                        [1.74, 1.63, 1.63],
                        [1.68, 1.59, 1.60],
                        [1.64, 1.58, 1.58]])     # n = 15, 23, 40, 45
YEARS_CAP = 255.0                               # sentinel: "more than 60 years"


def mde_factor(n: int, r: np.ndarray, rule: str = "v10") -> np.ndarray:
    """Measured MDE inflation factor, interpolated linearly in n and in r (edges are clamped).

    rule: "v10" three tests (HORI 1.0) · "ebh" three tests + e-BH (HORI 1.2, the default verdict) · "lm" with the MK-LM vote."""
    ns, table = {"v10": (_NS, _FACTOR), "lm": (_NS_LM, _FACTOR_LM), "ebh": (_NS_LM, _FACTOR_EBH)}[rule]
    n = float(np.clip(n, ns[0], ns[-1]))
    row = np.array([np.interp(n, ns, table[:, k]) for k in range(len(_PHIS))])
    return np.interp(np.clip(r, 0.0, 0.5), _PHIS, row)


def mde_per_decade(sigma: np.ndarray, r: np.ndarray, n: int, rule: str = "v10") -> np.ndarray:
    se = sigma * np.sqrt(12.0 / (n * (n * n - 1.0)) * (1 + r) / (1 - r))
    return 10.0 * K80 * se * mde_factor(n, r, rule)


def years_more(mde: np.ndarray, delta: np.ndarray, n: int) -> np.ndarray:
    """Extra years needed to be able to rule out changes >= delta. MDE shrinks as n^(-3/2).

    ALWAYS computed from delta (a size of interest), never from the observed effect (that would be 'post-hoc power').
    """
    with np.errstate(divide="ignore", invalid="ignore"):
        n_needed = n * (mde / delta) ** (2.0 / 3.0)
    extra = np.where(mde <= delta, 0.0, np.ceil(n_needed - n))
    return np.where(~np.isfinite(extra) | (extra > 60), YEARS_CAP, extra)
