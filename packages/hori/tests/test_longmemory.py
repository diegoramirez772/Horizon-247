"""L2b: variance of Mann-Kendall under fGn(H) and the «robusto a memoria larga» marker."""
import unittest

import numpy as np

from hori.api import Config, Cube, run_layer
from hori.longmemory import fgn_acf, memory_scale, mk_variance
from test_hori import ar1


class TestMkVariance(unittest.TestCase):
    def test_white_noise_reproduces_the_classical_variance_exactly(self):
        for n in (5, 15, 24, 45):
            self.assertAlmostEqual(mk_variance(n, 0.5), n * (n - 1) * (2 * n + 5) / 18, places=6)

    def test_variance_grows_with_memory_and_scale_shrinks(self):
        v = [mk_variance(30, h) for h in (0.5, 0.6, 0.7, 0.8, 0.9)]
        self.assertTrue(all(a < b for a, b in zip(v, v[1:])))
        self.assertAlmostEqual(memory_scale(30, 0.5), 1.0, places=9)
        self.assertLess(memory_scale(30, 0.7), memory_scale(30, 0.6))
        self.assertLess(memory_scale(30, 0.7), 1.0)

    def test_matches_a_monte_carlo_of_s(self):
        n, H, M = 20, 0.8, 20000
        R = np.array([fgn_acf(H, n)[np.abs(a - np.arange(n))] for a in range(n)])
        Y = np.random.default_rng(3).standard_normal((M, n)) @ np.linalg.cholesky(R + 1e-12 * np.eye(n)).T
        S = np.zeros(M)
        for i in range(n - 1):
            S += np.sign(Y[:, i + 1:] - Y[:, [i]]).sum(axis=1)
        self.assertAlmostEqual(float(S.var() / mk_variance(n, H)), 1.0, delta=0.05)     # exact formula vs simulation


class TestRobustMarker(unittest.TestCase):
    def run_cells(self, vals, n):
        v = vals.reshape(n, 20, 20).astype("float32")
        t = [f"{2001 + k}-01-01" for k in range(n)]
        return run_layer(Cube(v, np.isfinite(v), np.array(t), np.linspace(30, 20.5, 20), np.linspace(-110, -98.125, 20),
                              {"variable": {"name": "T", "unit": "C"}, "dataset": {"kind": "observation"},
                               "native_resolution_deg": 0.5}), Config(delta_per_decade=0.3))

    def test_robust_is_a_subset_of_probado_and_strong_signals_keep_it(self):
        rng = np.random.default_rng(1)
        n = 40
        a = ar1(rng, 400, n, 0.3) + np.linspace(0, 4, n)[None, :]            # strong trend, mild AR(1)
        res = self.run_cells(a.T, n)
        P, R = res.verdict == 1, res.robust_mem == 1
        self.assertFalse((R & ~P).any())
        self.assertGreater(P.mean(), 0.9)
        self.assertGreater(R.sum() / P.sum(), 0.9)
        self.assertEqual(res.manifest["summary"]["probado_robusto_memoria"], int(R.sum()))

    def test_marginal_trends_lose_the_marker_before_the_verdict(self):
        rng = np.random.default_rng(2)
        n = 24
        a = ar1(rng, 400, n, 0.3) + np.linspace(0, 1.5, n)[None, :]        # signal near the detection limit
        res = self.run_cells(a.T, n)
        P, R = res.verdict == 1, res.robust_mem == 1
        self.assertGreater(P.sum(), 30)
        self.assertLess(R.sum(), P.sum())                                    # some PROBADO do not survive fGn(0.7)


if __name__ == "__main__":
    unittest.main()
