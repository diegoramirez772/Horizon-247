"""L4 e-values, computed IN PARALLEL to the p-value verdict (they do not decide anything yet).

An e-value E >= 0 has expectation <= 1 when there is no effect; E >= 1/alpha is evidence at level alpha (Markov).
Why HORI carries them:
  * the arithmetic MEAN of e-values is again an e-value under ANY dependence (linearity of expectation), so the
    three trend tests are combined with a guarantee instead of an empirical rule;
  * e-BH (Wang & Ramdas 2022) controls the false discovery rate under ANY dependence between cells, which is the
    honest setting for a map whose neighbours are correlated (plain BH needs positive dependence).
Two constructions:
  p_to_e      calibrator of Vovk & Wang (2021), f(p) = (1 - p + p ln p) / (p (ln p)^2): valid for ANY valid p,
              but inefficient (it ignores what the alternative looks like);
  mixture_e   likelihood ratio of N(theta, 1) vs N(0, 1) for a test statistic z, averaged over theta ~ N(0, tau^2):
              E = (1 + tau^2)^(-1/2) exp(tau^2 z^2 / (2 (1 + tau^2))). E[E] = 1 exactly when z ~ N(0, 1).
              tau is fixed BEFORE looking at the effect: the size of interest delta in z units (delta / se), so the
              e-value bets on «a change of size about delta», the same delta the verdict uses.
HORI uses the mixture (measured to be more powerful; see sim/evalue_planet.py). The guarantee is as good as
«z ~ N(0, 1) under no trend», which is asymptotic and assumes the AR(1) correction is right: e-values remove the
DEPENDENCE assumptions between cells and tests, not the noise model. e-BH stays a parallel «robust core» until
its power is acceptable on the real planet (it is not yet: see the model card).
"""
from __future__ import annotations

import numpy as np

_P_FLOOR = 1e-300


def p_to_e(p: np.ndarray) -> np.ndarray:
    """Vovk-Wang calibrator. p = 1 -> 1/2 (the limit), p -> 0 -> infinity; NaN stays NaN."""
    p = np.clip(np.asarray(p, dtype=float), _P_FLOOR, 1.0)
    lp = np.log(p)
    with np.errstate(invalid="ignore", divide="ignore"):
        e = (1.0 - p + p * lp) / (p * lp * lp)
    return np.where(p > 1.0 - 1e-6, 0.5, e)                    # 0/0 at p = 1; the series gives 1/2 - (1-p)/6 ...


def combine_mean(es: list[np.ndarray]) -> np.ndarray:
    """Mean of e-values: valid under arbitrary dependence between the tests."""
    return np.mean(np.stack(es), axis=0)


def ebh(e: np.ndarray, q: float) -> np.ndarray:
    """e-BH: reject the k* largest e-values, k* = max{k : e_(k) >= m / (q k)}. NaN entries are not tested."""
    e = np.asarray(e, dtype=float)
    ok = np.isfinite(e) | np.isposinf(e)
    out = np.zeros(e.shape, dtype=bool)
    idx = np.where(ok)[0]
    m = idx.size
    if m == 0:
        return out
    order = idx[np.argsort(-e[idx], kind="stable")]
    passed = e[order] >= m / (q * np.arange(1, m + 1))
    if passed.any():
        out[order[: int(np.nonzero(passed)[0][-1]) + 1]] = True
    return out


TAU_RANGE = (0.5, 20.0)


def mixture_e(z: np.ndarray, tau: np.ndarray) -> np.ndarray:
    """Gaussian-mixture likelihood-ratio e-value for a statistic that is N(0, 1) under the null (two-sided)."""
    z = np.asarray(z, dtype=float)
    t2 = np.clip(np.asarray(tau, dtype=float), *TAU_RANGE) ** 2
    with np.errstate(over="ignore", invalid="ignore"):
        return np.exp(np.minimum(t2 * z * z / (2.0 * (1.0 + t2)), 700.0)) / np.sqrt(1.0 + t2)
