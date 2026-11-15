"""L1 breaks: sup-F (line vs line + step) with classic tests as support. Rates are MEASURED and guarded here."""
import unittest

import numpy as np

from hori.api import Config, run_layer
from hori.quality import critical_values, detect_breaks
from test_hori import ar1, make_cube

N, M = 40, 4000


def rate(Y):
    return float(detect_breaks(Y)[0].mean())


class TestBreaks(unittest.TestCase):
    def test_critical_values_are_deterministic(self):
        self.assertEqual(critical_values(30), critical_values(30))
        self.assertEqual(len(critical_values(24)), 5)

    def test_a_clean_trend_is_not_a_break_and_a_step_is(self):
        t = np.arange(N, dtype=float)
        rng = np.random.default_rng(1)
        noise = 0.2 * rng.standard_normal((1, N))
        self.assertFalse(detect_breaks(0.1 * t[None] + noise)[0][0])
        step = noise.copy()
        step[0, 25:] += 3.0
        flag, where, support = detect_breaks(step)
        self.assertTrue(flag[0] and support[0] >= 1)
        self.assertLessEqual(abs(int(where[0]) - 25), 1)

    def test_measured_false_flags_and_catch_rates(self):
        rng = np.random.default_rng(7)
        false0 = rate(ar1(rng, M, N, 0.0))
        false3 = rate(ar1(rng, M, N, 0.3))
        trend = rate(ar1(rng, M, N, 0.3, slope_per_decade=1.0))
        Y = ar1(rng, M, N, 0.3); Y[:, 20:] += 1.0
        catch1 = rate(Y)
        Y = ar1(rng, M, N, 0.3); Y[:, 20:] += 2.0
        catch2 = rate(Y)
        Y = ar1(rng, M, N, 0.3); Y[:, 20:] += 3.0
        catch3 = rate(Y)
        print(f"\n[breaks n={N}] false phi=0: {false0:.3f} | phi=0.3: {false3:.3f} | with trend: {trend:.3f} | "
              f"catch 1/2/3 sigma: {catch1:.2f} {catch2:.2f} {catch3:.2f}")
        self.assertLess(false0, 0.03)
        self.assertLess(false3, 0.08)
        self.assertLess(trend, 0.08)                               # a clear linear trend is rarely called a break
        self.assertGreater(catch3, 0.70)
        self.assertGreater(catch2, 0.35)
        self.assertGreater(catch2, catch1)

    def test_flag_reaches_the_bundle_without_touching_the_verdict(self):
        cube = make_cube(np.random.default_rng(3), [], y=2, x=2)
        base = run_layer(cube, Config())
        cube.values[12:, 0, 0] += 12.0                             # a very big step in one cell
        res = run_layer(cube, Config())
        self.assertTrue(res.flags[0] & 128)
        self.assertEqual(float(res.break_year[0]), 2013.0)
        self.assertEqual(res.manifest["summary"]["quiebre_posible"], int(((res.flags & 128) > 0).sum()))
        self.assertIn("128", res.manifest["flag_bits"])


if __name__ == "__main__":
    unittest.main()
