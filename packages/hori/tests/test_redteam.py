"""Red team: trap series built to fool a trend detector. Each test states what HORI must NOT claim.

Two traps are NOT solved and are guarded as *measured limits* (so nobody can quietly make them worse):
a version-change step and a random walk both still produce false PROBADO; what HORI guarantees today is that
a good part of them carry the `quiebre_posible` / `autocorrelacion_alta` warning (rates printed). See the model card.
"""
import unittest

import numpy as np

from hori.api import Config, Cube, run_layer
from test_hori import ar1

Y, X, N = 20, 20, 24
M = Y * X
CFG = Config(delta_per_decade=0.3)
ANNUAL = [f"{2001 + k}-01-01" for k in range(N)]
MONTHLY = [f"{2001 + k // 12}-{k % 12 + 1:02d}-01" for k in range(12 * N)]


def run(vals, time):
    v = vals.reshape(len(time), Y, X).astype("float32")
    res = run_layer(Cube(v, np.isfinite(v), np.array(time), np.linspace(30, 20.5, Y), np.linspace(-110, -98.125, X),
                         {"variable": {"name": "T", "unit": "C"}, "dataset": {"kind": "observation"},
                          "native_resolution_deg": 0.5}), CFG)
    P = res.verdict == 1
    return res, P, int(P.sum()), int((P & ((res.flags & (128 | 64)) > 0)).sum())


class TestRedTeam(unittest.TestCase):
    def setUp(self):
        self.rng = np.random.default_rng(99)

    def test_one_extreme_final_year_is_not_a_trend(self):
        a = ar1(self.rng, M, N, 0.3)
        a[:, -1] += 5.0
        self.assertLessEqual(run(a.T, ANNUAL)[2], 0.02 * M)

    def test_strong_seasonality_without_trend(self):
        t = np.arange(12 * N)
        v = 10 * np.sin(2 * np.pi * t / 12)[:, None] + self.rng.standard_normal((12 * N, M))
        self.assertLessEqual(run(v, MONTHLY)[2], 0.02 * M)

    def test_missing_years_at_the_end_are_refused_not_extrapolated(self):
        a = ar1(self.rng, M, N, 0.3).T
        a[-4:] = np.nan
        res, _, n_p, _ = run(a, ANNUAL)
        self.assertEqual((n_p, int((res.verdict == 0).sum())), (0, M))

    def test_highly_correlated_null_map_stays_empty(self):
        a = 0.5 * ar1(self.rng, M, N, 0.3) + self.rng.standard_normal(N)[None, :]
        self.assertLessEqual(run(a.T, ANNUAL)[2], 0.02 * M)

    def test_strong_persistence_without_trend(self):
        self.assertLessEqual(run(ar1(self.rng, M, N, 0.8).T, ANNUAL)[2], 0.05 * M)

    def test_LIMIT_version_change_step_is_read_as_trend_but_mostly_flagged(self):
        a = ar1(self.rng, M, N, 0.3)
        a[:, 12:] += 3.0
        _, _, n_p, warned = run(a.T, ANNUAL)
        print(f"\n[red team] 3-sigma step: false PROBADO {n_p}/{M}, with a warning flag {warned} ({warned / max(n_p, 1):.0%})")
        self.assertGreater(warned / max(n_p, 1), 0.40)

    def test_LIMIT_random_walk_is_partly_read_as_trend_but_mostly_flagged(self):
        a = np.cumsum(self.rng.standard_normal((M, N)), axis=1)
        _, _, n_p, warned = run(a.T, ANNUAL)
        print(f"\n[red team] random walk: false PROBADO {n_p}/{M} ({n_p / M:.0%}), with a warning flag {warned} "
              f"({warned / max(n_p, 1):.0%})")
        self.assertLess(n_p / M, 0.30)                              # NOT solved: long memory (phase H8)


if __name__ == "__main__":
    unittest.main()
