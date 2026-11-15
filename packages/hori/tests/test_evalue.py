"""H6 e-values: calibrator, combination and e-BH (known answers + properties)."""
import math
import unittest

import numpy as np

from hori.api import Config, run_layer
from hori.evalue import combine_mean, ebh, mixture_e, p_to_e
from test_hori import make_cube


class TestEValues(unittest.TestCase):
    def test_calibrator_known_values_and_limits(self):
        self.assertAlmostEqual(float(p_to_e(np.array([0.01]))[0]), (1 - 0.01 + 0.01 * math.log(0.01)) / (0.01 * math.log(0.01) ** 2))
        self.assertAlmostEqual(float(p_to_e(np.array([0.01]))[0]), 4.4510, places=3)
        self.assertEqual(float(p_to_e(np.array([1.0]))[0]), 0.5)
        self.assertTrue(np.isfinite(p_to_e(np.array([0.0]))[0]) and p_to_e(np.array([0.0]))[0] > 1e290)
        self.assertTrue(np.isnan(p_to_e(np.array([np.nan]))[0]))
        p = np.array([1e-8, 1e-4, 0.01, 0.2, 0.9])
        self.assertTrue(np.all(np.diff(p_to_e(p)) < 0))                    # smaller p, more evidence

    def test_calibrator_is_the_integral_of_k_p_to_the_k_minus_1(self):
        k = (np.arange(200000) + 0.5) / 200000
        for p in (1e-5, 0.003, 0.05, 0.5):
            self.assertAlmostEqual(float(p_to_e(np.array([p]))[0]), float(np.mean(k * p ** (k - 1))), places=3)

    def test_expectation_under_the_null_is_at_most_one(self):
        # exact: integral over p of f(p) = integral over k of 1 dk = 1. Numerically on a log grid of p:
        x = np.linspace(-700, 0, 2_000_001)                                # p = e^x, dp = e^x dx
        f = p_to_e(np.exp(x)) * np.exp(x)
        self.assertAlmostEqual(float(((f[1:] + f[:-1]) / 2 * np.diff(x)).sum()), 1.0, places=2)

    def test_mixture_known_value_and_null_expectation(self):
        self.assertAlmostEqual(float(mixture_e(np.array([0.0]), np.array([3.0]))[0]), 1 / np.sqrt(10))
        self.assertAlmostEqual(float(mixture_e(np.array([4.0]), np.array([3.0]))[0]), np.exp(9 * 16 / 20) / np.sqrt(10))
        for tau in (0.5, 3.0, 8.0):                                        # E over z ~ N(0,1) is exactly 1
            z = np.linspace(-1, 1, 800001) * 9 * np.sqrt(1 + tau ** 2)     # integrand = N(0, 1 + tau^2) density
            f = mixture_e(z, np.full(z.shape, tau)) * np.exp(-z * z / 2) / np.sqrt(2 * np.pi)
            self.assertAlmostEqual(float(((f[1:] + f[:-1]) / 2 * np.diff(z)).sum()), 1.0, places=4)

    def test_mixture_beats_the_calibrator_for_moderate_signals(self):
        from hori.stats import p_two
        z = np.array([3.0, 4.0, 5.0])
        self.assertTrue(np.all(mixture_e(z, np.full(3, 3.0)) > p_to_e(p_two(z))))

    def test_mean_and_ebh_known_answer(self):
        self.assertTrue(np.allclose(combine_mean([np.array([2.0, 40.0]), np.array([4.0, 0.0])]), [3.0, 20.0]))
        e = np.array([100.0, 30.0, 12.0, 1.0, np.nan])                     # m = 4, q = 0.1 -> thresholds 40, 20, 13.3, 10
        self.assertEqual(ebh(e, 0.1).tolist(), [True, True, False, False, False])
        self.assertFalse(ebh(np.array([30.0, 15.0, 1.0, 1.0]), 0.1).any())  # 30 < 40 and 15 < 20: nothing

    def test_ebh_is_never_more_liberal_than_bh_on_calibrated_p(self):
        rng = np.random.default_rng(2)
        p = np.concatenate([rng.uniform(size=900), rng.uniform(size=100) * 1e-4])
        from hori.fdr import bh_adjust
        self.assertTrue(np.all(~ebh(p_to_e(p), 0.1) | (bh_adjust(p) <= 0.1)))

    def test_bundle_carries_parallel_evidence_without_changing_verdicts(self):
        res = run_layer(make_cube(np.random.default_rng(2026), [(0, 0), (0, 1), (1, 0), (1, 1)]), Config())
        s = res.manifest["summary"]
        self.assertEqual(s["ebh_discoveries"], int(res.ebh_sig.sum()))
        self.assertLessEqual(s["ebh_discoveries"], s["bh_discoveries"])
        self.assertTrue(np.isfinite(res.e_cons).all())


if __name__ == "__main__":
    unittest.main()
