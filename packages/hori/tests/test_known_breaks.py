"""L1b: do flagged breaks pile up at the product's documented version changes? (diagnostic, never changes a verdict)"""
import unittest

import numpy as np

from hori.api import Config, Cube, run_layer
from test_hori import ar1

N, Y, X = 30, 20, 20


def run(vals, known):
    v = vals.reshape(N, Y, X).astype("float32")
    t = [f"{2001 + k}-01-01" for k in range(N)]
    ds = {"kind": "reanalysis", **({"known_breaks": {"years": known, "source": "test"}} if known else {})}
    return run_layer(Cube(v, np.isfinite(v), np.array(t), np.linspace(30, 20.5, Y), np.linspace(-110, -98.125, X),
                          {"variable": {"name": "T", "unit": "C"}, "dataset": ds, "native_resolution_deg": 0.5}),
                     Config(delta_per_decade=0.3))


class TestKnownBreaks(unittest.TestCase):
    def test_steps_at_a_documented_change_are_reported_as_piling_up_there(self):
        rng = np.random.default_rng(4)
        a = ar1(rng, Y * X, N, 0.3)
        a[:, 15:] += 3.0                                              # step to a new regime in 2016
        q = run(a.T, [2016, 2011]).manifest["quality"]["known_breaks"]
        self.assertGreater(q["flagged_cells"], 100)
        self.assertGreater(q["share_within_1_year"], 0.8)
        self.assertLess(q["expected_if_uniform"], 0.4)

    def test_no_known_breaks_means_no_block_and_verdicts_are_unchanged(self):
        rng = np.random.default_rng(5)
        a = (ar1(rng, Y * X, N, 0.3) + np.linspace(0, 2, N)).T
        with_kb, without = run(a, [2011]), run(a, None)
        self.assertNotIn("quality", without.manifest)
        self.assertTrue(np.array_equal(with_kb.verdict, without.verdict))


if __name__ == "__main__":
    unittest.main()
